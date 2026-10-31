import { spawn } from 'node:child_process';
import { resolvePython } from './pybridge.js';

/**
 * Literature evidence bridge: literature search + citation/retraction verification
 * via the user's installed `literature-evidence-mcp` Python package (>= 0.5.1).
 *
 * Call path: the package exposes directly callable async functions in
 * `literature_evidence_mcp.server` (search_literature, verify_citation,
 * check_retraction, verify_source_quote), so no MCP stdio client is needed.
 * Each call spawns `python -X utf8 -I -c <driver>` with JSON on stdin and a
 * sentinel-prefixed JSON result on stdout. Every failure (missing Python,
 * missing package, network outage, provider rate limit, timeout) resolves to a
 * gentle Turkish message string; execute never lets the process crash.
 */

// Per-process spawn timeout (~60 s) and the shorter inner Python await timeout.
const BRIDGE_TIMEOUT_MS = 60_000;
const PY_INNER_TIMEOUT_S = 55;

// Sentinel markers: server logs go to stderr, but stdout is still parsed defensively.
const OK_MARK = '@@OK@@';
const ERR_MARK = '@@ERR@@';

// Python driver: read JSON request from stdin, dispatch one op, print JSON result.
const PY_DRIVER = `
import asyncio, json, sys

def _main():
    try:
        req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        import literature_evidence_mcp.server as srv
        op = req.get("op")
        if op == "search":
            coro = srv.search_literature(str(req["query"]), int(req.get("limit", 5)))
        elif op == "cite":
            coro = srv.verify_citation(str(req["doi"]), str(req.get("title", "")))
        elif op == "retract":
            coro = srv.check_retraction(str(req["doi"]))
        elif op == "quote":
            coro = srv.verify_source_quote(str(req["pmcid"]), str(req["quote"]))
        else:
            raise ValueError("unknown op: %r" % (op,))
        data = asyncio.run(asyncio.wait_for(coro, timeout=float(req.get("timeout", ${PY_INNER_TIMEOUT_S}))))
        sys.stdout.write("${OK_MARK}" + json.dumps(data, ensure_ascii=False))
    except Exception as exc:
        sys.stdout.write("${ERR_MARK}" + json.dumps(
            {"error": type(exc).__name__ + ": " + str(exc)}, ensure_ascii=False))

_main()
`;

// Spawn the Python bridge once; always resolve (never reject) with a typed result.
function runBridge(op, payload = {}) {
  return new Promise((resolve) => {
    const exe = resolvePython();
    if (!exe) {
      resolve({ ok: false, error: 'Python yorumlayıcısı bulunamadı' });
      return;
    }
    let child;
    try {
      child = spawn(exe, ['-X', 'utf8', '-I', '-c', PY_DRIVER], {
        windowsHide: true,
        timeout: BRIDGE_TIMEOUT_MS,
      });
    } catch (e) {
      resolve({ ok: false, error: `Python süreci başlatılamadı: ${e.message}` });
      return;
    }
    let out = '';
    let done = false;
    const finish = (r) => {
      if (!done) {
        done = true;
        resolve(r);
      }
    };
    child.stdout.on('data', (d) => {
      if (out.length < 4_000_000) out += d.toString('utf8');
    });
    child.stderr.on('data', () => {}); // provider/HTTP logs: drained, unused
    child.on('error', (e) => finish({ ok: false, error: `Python süreci başlatılamadı: ${e.message}` }));
    child.on('close', (code, signal) => {
      if (signal) {
        finish({ ok: false, error: `zaman aşımı (${BRIDGE_TIMEOUT_MS} ms)` });
        return;
      }
      const i = out.indexOf(OK_MARK);
      if (i !== -1) {
        try {
          finish({ ok: true, data: JSON.parse(out.slice(i + OK_MARK.length)) });
          return;
        } catch {}
      }
      const j = out.indexOf(ERR_MARK);
      if (j !== -1) {
        try {
          const parsed = JSON.parse(out.slice(j + ERR_MARK.length));
          finish({ ok: false, error: String(parsed?.error ?? 'bilinmeyen hata') });
          return;
        } catch {}
      }
      finish({ ok: false, error: `beklenmeyen Python çıktısı (çıkış kodu: ${code ?? '?'})` });
    });
    child.stdin.on('error', () => {}); // EPIPE guard: child may exit early
    child.stdin.end(JSON.stringify({ op, timeout: PY_INNER_TIMEOUT_S, ...payload }), 'utf8');
  });
}

// Map any bridge failure to a gentle Turkish message (never throw).
function gentle(errorText) {
  const msg = String(errorText ?? '');
  if (/No module named/i.test(msg) && /literature_evidence_mcp/i.test(msg)) {
    return 'Hata: literature-evidence-mcp Python paketi bulunamadı. Kurulum: "python -m pip install literature-evidence-mcp" (>= 0.5.1). Farklı bir Python kullanılıyorsa SCI_AGENT_PYTHON ortam değişkeniyle yolunu verebilirsiniz.';
  }
  const tail = msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
  return `Hata: literatür sağlayıcısına ulaşılamadı (ağ yok, kota/limit dolu veya geçici servis hatası olabilir). Ayrıntı: ${tail}`;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clampLimit = (v) => Math.min(20, Math.max(1, Math.floor(Number(v) || 5)));

const fmtAuthors = (a) => {
  if (!Array.isArray(a) || !a.length) return 'bilinmiyor';
  return a.length > 3 ? `${a.slice(0, 3).join(', ')} ve diğerleri` : a.join(', ');
};

// One paper -> three source lines (title/year, authors/journal, DOI/sources).
function paperLines(p, i) {
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : '(başlık yok)';
  const year = Number.isFinite(p.year) ? `[${p.year}] ` : '';
  const journal = typeof p.journal === 'string' && p.journal ? ` | Dergi: ${p.journal}` : '';
  const doi = typeof p.doi === 'string' && p.doi ? p.doi : 'yok';
  const sources = Array.isArray(p.sources) && p.sources.length ? p.sources.join(', ') : String(p.source ?? 'bilinmiyor');
  return `${i}. ${year}${title}\n   Yazarlar: ${fmtAuthors(p.authors)}${journal}\n   DOI: ${doi} | Kaynak(lar): ${sources}`;
}

// Compact "openalex=OK(3)" style provider summary; includes per-provider errors.
function providerSummary(providerStatus) {
  if (!providerStatus || typeof providerStatus !== 'object') return '';
  const parts = Object.entries(providerStatus).map(([name, st]) => {
    if (st && st.status === 'OK') return `${name}=OK(${st.count ?? 0})`;
    return `${name}=HATA(${st?.error ?? 'bilinmeyen'})`;
  });
  return parts.length ? `Sağlayıcı durumu: ${parts.join(', ')}` : '';
}

const SEARCH_CAVEAT =
  'Not: Arama kapsamlı (exhaustive) değildir; sıfır sonuç, makalenin var olmadığı anlamına gelmez (sağlayıcı erişilemezliği veya limiti olabilir).';

// Render a citation-verify result dict.
function citeLines(doi, claimedTitle, data) {
  const status = data?.status ?? 'bilinmiyor';
  const xTitle = data?.crossref_title ?? '(alınamadı)';
  const lines = [
    `Atıf eşleşmesi (bibliyografik): ${status}`,
    `  İstenen başlık: ${claimedTitle}`,
    `  Crossref başlığı: ${xTitle}`,
    '  Uyarı: bu yalnızca üstveri (metadata) eşleşmesidir; bilimsel içerik doğrulanmaz.',
  ];
  return [`DOI: ${doi}`, ...lines];
}

// Render a retraction-check result dict (updates present -> loud warning).
function retractLines(data) {
  const status = data?.status ?? 'bilinmiyor';
  const updates = Array.isArray(data?.updates) ? data.updates : [];
  const found =
    updates.length > 0 || /RETRACT|WITHDRAW/i.test(String(status));
  const lines = [
    `Retraksiyon kontrolü: ${status}`,
    found
      ? `  DİKKAT: retraksiyon/düzeltme güncellemesi kaydı bulundu (${updates.length}). ${JSON.stringify(updates).slice(0, 500)}`
      : '  Crossref kayıtlarında retraksiyon/düzeltme güncellemesi bulunamadı.',
    '  Not: Crossref kaydında retraksiyon görünmemesi, makalenin retrakte edilmediğini garanti etmez.',
  ];
  return lines;
}

// Defensive renderer for the quote-verify result; the package reports `matched_spans`.
function quoteLines(data) {
  const lines = [];
  if (data?.status) lines.push(`Durum: ${data.status}`);
  const spans = Array.isArray(data?.matched_spans) ? data.matched_spans : Array.isArray(data?.matches) ? data.matches : [];
  if (spans.length) {
    lines.push(`Eşleşen paragraf sayısı: ${spans.length}`);
    for (const m of spans.slice(0, 3)) {
      const id = typeof m?.span_id === 'string' ? m.span_id : '?';
      const section = typeof m?.section === 'string' && m.section ? ` | Bölüm: ${m.section}` : '';
      const hash = typeof m?.sha256_text === 'string' ? ` | sha256: ${m.sha256_text.slice(0, 16)}…` : '';
      lines.push(`  ${id}${section}${hash}`);
    }
  }
  if (data?.retrieval_truncated === true) {
    lines.push('Dikkat: tam metin alımı kırpıldı; eşleşme listesi eksik olabilir.');
  }
  if (!lines.length) lines.push(JSON.stringify(data, null, 1).slice(0, 800));
  lines.push('Uyarı: bu birebir metin eşleşmesidir; bilimsel geçerlilik hükmi değildir.');
  return lines;
}

export const lit_search = {
  name: 'lit_search',
  description:
    'Açık akademik sağlayıcılarda (OpenAlex, Europe PMC, Crossref) literatür araması yapar; başlık, yazar, yıl, DOI ve kaynak satırlarını döndürür. literature-evidence-mcp paketi gerektirir (ağ kullanır). Sağlayıcı erişilemezse nazik hata metni döner. Not: arama kapsamlı değildir; sıfır sonuç, makalenin var olmadığı anlamına gelmez.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Aranacak metin (başlık, konu veya anahtar kelimeler)' },
      max_results: {
        type: 'number',
        description: 'Kaynak başına en fazla sonuç (1-20, varsayılan 5)',
      },
    },
    required: ['query'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ query, max_results } = {}) {
    const q = str(query);
    if (!q) throw new Error('query gerekli: aranacak metin verin');
    const limit = clampLimit(max_results);
    const r = await runBridge('search', { query: q, limit });
    if (!r.ok) return gentle(r.error);
    const papers = Array.isArray(r.data?.papers) ? r.data.papers : [];
    const out = [`Literatür araması: "${q}" (kaynak başına en fazla ${limit})`];
    const ps = providerSummary(r.data?.provider_status);
    if (ps) out.push(ps);
    if (!papers.length) {
      out.push('Sonuç bulunamadı (0).');
      out.push(SEARCH_CAVEAT);
      return out.join('\n');
    }
    const shown = papers.slice(0, 15);
    out.push(`Sonuçlar (${shown.length}/${papers.length}):`);
    shown.forEach((p, idx) => out.push(paperLines(p ?? {}, idx + 1)));
    if (papers.length > shown.length) out.push(`(ilk ${shown.length} sonuç gösteriliyor)`);
    out.push(SEARCH_CAVEAT);
    return out.join('\n');
  },
};

export const lit_verify = {
  name: 'lit_verify',
  description:
    'Bir makalenin atıf doğrulaması ve retraksiyon (geri çekilme) durumunu kontrol eder. doi + title birlikte verilirse bibliyografik başlık eşleşmesi (Crossref) ve retraksiyon kontrolü yapılır; yalnız doi verilirse retraksiyon kontrolü; yalnız title verilirse paket aramasıyla DOI adayı bulunup retraksiyon kontrolü yapılır (yaklaşıktır). Retraksiyon kaydının bulunmaması, makalenin retrakte edilmediğini garanti etmez. literature-evidence-mcp paketi gerektirir (ağ kullanır); erişilemezse nazik hata metni döner.',
  parameters: {
    type: 'object',
    properties: {
      doi: { type: 'string', description: 'DOI (ör. 10.1038/nature12373); title ile birlikte veya tek başına' },
      title: { type: 'string', description: 'Makale başlığı (bibliyografik eşleşme için; DOI yoksa aday çıkarmak için kullanılır)' },
    },
  },
  needsApproval: false,
  parallel: true,
  async execute({ doi, title } = {}) {
    const d = str(doi);
    const t = str(title);
    if (!d && !t) throw new Error('doi veya title en az biri gerekli');

    if (d && t) {
      const cite = await runBridge('cite', { doi: d, title: t });
      const retr = await runBridge('retract', { doi: d });
      const out = [];
      if (!cite.ok) out.push(`Atıf doğrulama: ${gentle(cite.error)}`);
      else out.push(...citeLines(d, t, cite.data));
      if (!retr.ok) out.push(`Retraksiyon kontrolü: ${gentle(retr.error)}`);
      else out.push(...retractLines(retr.data));
      return out.join('\n');
    }

    if (d) {
      const retr = await runBridge('retract', { doi: d });
      if (!retr.ok) return gentle(retr.error);
      return [`DOI: ${d}`, '(title verilmediği için bibliyografik başlık eşleşmesi atlandı)', ...retractLines(retr.data)].join('\n');
    }

    // Title only: resolve a DOI candidate via the package search, then check it.
    const search = await runBridge('search', { query: t, limit: 3 });
    if (!search.ok) return gentle(search.error);
    const papers = Array.isArray(search.data?.papers) ? search.data.papers : [];
    const top = papers.find((p) => typeof p?.doi === 'string' && p.doi);
    const out = ['DOI verilmedi; aday çıkarmak için paket araması yapıldı.'];
    if (!top) {
      out.push('DOI taşıyan aday bulunamadı; kesin doğrulama için DOI ile tekrar deneyin.');
      out.push(SEARCH_CAVEAT);
      return out.join('\n');
    }
    out.push(`En iyi aday: ${Number.isFinite(top.year) ? `[${top.year}] ` : ''}${top.title ?? '(başlık yok)'} (DOI: ${top.doi})`);
    const retr = await runBridge('retract', { doi: top.doi });
    if (!retr.ok) out.push(`Retraksiyon kontrolü: ${gentle(retr.error)}`);
    else out.push(...retractLines(retr.data));
    out.push('Not: başlık→DOI eşleşmesi yaklaşıktır; kesin doğrulama için DOI’yi açıkça verin.');
    return out.join('\n');
  },
};

export const lit_quote = {
  name: 'lit_quote',
  description:
    'Verilen alıntının (quote) Europe PMC tam metninde birebir bulunup bulunmadığını doğrular; eşleşen paragraf kimliklerini ve bölüm bilgisini döndürür. Paket kısıtı: alıntı doğrulama PMCID iledir (DOI desteklenmez), PMCID girin (ör. PMC8765432). Bu birebir metin eşleşmesidir, bilimsel geçerlilik hükmi değildir. literature-evidence-mcp paketi gerektirir (ağ kullanır); erişilemezse nazik hata metni döner.',
  parameters: {
    type: 'object',
    properties: {
      pmcid: { type: 'string', description: 'Europe PMC/PMC kimliği (ör. PMC8765432)' },
      quote: { type: 'string', description: 'Doğrulanacak birebir alıntı metni' },
    },
    required: ['pmcid', 'quote'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ pmcid, quote } = {}) {
    const pm = str(pmcid);
    const qt = str(quote);
    if (!pm || !qt) throw new Error('pmcid ve quote gerekli (pakette alıntı doğrulama PMCID iledir)');
    const r = await runBridge('quote', { pmcid: pm, quote: qt });
    if (!r.ok) return gentle(r.error);
    return [`PMCID: ${pm}`, ...quoteLines(r.data)].join('\n');
  },
};
