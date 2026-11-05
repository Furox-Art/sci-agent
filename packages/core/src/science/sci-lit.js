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
 * gentle message string; execute never lets the process crash.
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
      resolve({ ok: false, error: 'Python interpreter not found' });
      return;
    }
    let child;
    try {
      child = spawn(exe, ['-X', 'utf8', '-I', '-c', PY_DRIVER], {
        windowsHide: true,
        timeout: BRIDGE_TIMEOUT_MS,
      });
    } catch (e) {
      resolve({ ok: false, error: `Failed to start Python process: ${e.message}` });
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
    child.on('error', (e) => finish({ ok: false, error: `Failed to start Python process: ${e.message}` }));
    child.on('close', (code, signal) => {
      if (signal) {
        finish({ ok: false, error: `timeout (${BRIDGE_TIMEOUT_MS} ms)` });
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
          finish({ ok: false, error: String(parsed?.error ?? 'unknown error') });
          return;
        } catch {}
      }
      finish({ ok: false, error: `unexpected Python output (exit code: ${code ?? '?'})` });
    });
    child.stdin.on('error', () => {}); // EPIPE guard: child may exit early
    child.stdin.end(JSON.stringify({ op, timeout: PY_INNER_TIMEOUT_S, ...payload }), 'utf8');
  });
}

// Map any bridge failure to a gentle message (never throw).
function gentle(errorText) {
  const msg = String(errorText ?? '');
  if (/No module named/i.test(msg) && /literature_evidence_mcp/i.test(msg)) {
    return 'Error: the literature-evidence-mcp Python package was not found. Install: "python -m pip install literature-evidence-mcp" (>= 0.5.1). If a different Python is used, you can provide its path via the SCI_AGENT_PYTHON environment variable.';
  }
  const tail = msg.length > 400 ? `${msg.slice(0, 400)}…` : msg;
  return `Error: could not reach the literature provider (may be no network, an exhausted quota/rate limit, or a temporary service outage). Details: ${tail}`;
}

const str = (v) => (typeof v === 'string' ? v.trim() : '');
const clampLimit = (v) => Math.min(20, Math.max(1, Math.floor(Number(v) || 5)));

const fmtAuthors = (a) => {
  if (!Array.isArray(a) || !a.length) return 'unknown';
  return a.length > 3 ? `${a.slice(0, 3).join(', ')} et al.` : a.join(', ');
};

// One paper -> three source lines (title/year, authors/journal, DOI/sources).
function paperLines(p, i) {
  const title = typeof p.title === 'string' && p.title.trim() ? p.title.trim() : '(no title)';
  const year = Number.isFinite(p.year) ? `[${p.year}] ` : '';
  const journal = typeof p.journal === 'string' && p.journal ? ` | Journal: ${p.journal}` : '';
  const doi = typeof p.doi === 'string' && p.doi ? p.doi : 'none';
  const sources = Array.isArray(p.sources) && p.sources.length ? p.sources.join(', ') : String(p.source ?? 'unknown');
  return `${i}. ${year}${title}\n   Authors: ${fmtAuthors(p.authors)}${journal}\n   DOI: ${doi} | Source(s): ${sources}`;
}

// Compact "openalex=OK(3)" style provider summary; includes per-provider errors.
function providerSummary(providerStatus) {
  if (!providerStatus || typeof providerStatus !== 'object') return '';
  const parts = Object.entries(providerStatus).map(([name, st]) => {
    if (st && st.status === 'OK') return `${name}=OK(${st.count ?? 0})`;
    return `${name}=ERROR(${st?.error ?? 'unknown'})`;
  });
  return parts.length ? `Provider status: ${parts.join(', ')}` : '';
}

const SEARCH_CAVEAT =
  'Note: the search is not exhaustive; zero results does not mean the paper does not exist (may be provider unavailability or a rate limit).';

// Render a citation-verify result dict.
function citeLines(doi, claimedTitle, data) {
  const status = data?.status ?? 'unknown';
  const xTitle = data?.crossref_title ?? '(could not fetch)';
  const lines = [
    `Citation match (bibliographic): ${status}`,
    `  Requested title: ${claimedTitle}`,
    `  Crossref title: ${xTitle}`,
    '  Warning: this is a metadata match only; scientific content is not verified.',
  ];
  return [`DOI: ${doi}`, ...lines];
}

// Render a retraction-check result dict (updates present -> loud warning).
function retractLines(data) {
  const status = data?.status ?? 'unknown';
  const updates = Array.isArray(data?.updates) ? data.updates : [];
  const found =
    updates.length > 0 || /RETRACT|WITHDRAW/i.test(String(status));
  const lines = [
    `Retraction check: ${status}`,
    found
      ? `  WARNING: retraction/corrigendum update record found (${updates.length}). ${JSON.stringify(updates).slice(0, 500)}`
      : '  No retraction/corrigendum update found in Crossref records.',
    '  Note: absence of a retraction in the Crossref record does not guarantee the paper is not retracted.',
  ];
  return lines;
}

// Defensive renderer for the quote-verify result; the package reports `matched_spans`.
function quoteLines(data) {
  const lines = [];
  if (data?.status) lines.push(`Status: ${data.status}`);
  const spans = Array.isArray(data?.matched_spans) ? data.matched_spans : Array.isArray(data?.matches) ? data.matches : [];
  if (spans.length) {
    lines.push(`Matched paragraph count: ${spans.length}`);
    for (const m of spans.slice(0, 3)) {
      const id = typeof m?.span_id === 'string' ? m.span_id : '?';
      const section = typeof m?.section === 'string' && m.section ? ` | Section: ${m.section}` : '';
      const hash = typeof m?.sha256_text === 'string' ? ` | sha256: ${m.sha256_text.slice(0, 16)}…` : '';
      lines.push(`  ${id}${section}${hash}`);
    }
  }
  if (data?.retrieval_truncated === true) {
    lines.push('Caution: full-text retrieval was truncated; the match list may be incomplete.');
  }
  if (!lines.length) lines.push(JSON.stringify(data, null, 1).slice(0, 800));
  lines.push('Warning: this is a verbatim text match; it is not a judgment of scientific validity.');
  return lines;
}

export const lit_search = {
  name: 'lit_search',
  description:
    'Searches open academic providers (OpenAlex, Europe PMC, Crossref) for literature; returns title, authors, year, DOI and source lines. Requires the literature-evidence-mcp package (uses the network). Returns a gentle error message if providers are unreachable. Note: the search is not exhaustive; zero results does not mean the paper does not exist.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to search for (title, topic or keywords)' },
      max_results: {
        type: 'number',
        description: 'Max results per provider (1-20, default 5)',
      },
    },
    required: ['query'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ query, max_results } = {}) {
    const q = str(query);
    if (!q) throw new Error('query required: provide the text to search');
    const limit = clampLimit(max_results);
    const r = await runBridge('search', { query: q, limit });
    if (!r.ok) return gentle(r.error);
    const papers = Array.isArray(r.data?.papers) ? r.data.papers : [];
    const out = [`Literature search: "${q}" (max ${limit} per provider)`];
    const ps = providerSummary(r.data?.provider_status);
    if (ps) out.push(ps);
    if (!papers.length) {
      out.push('No results found (0).');
      out.push(SEARCH_CAVEAT);
      return out.join('\n');
    }
    const shown = papers.slice(0, 15);
    out.push(`Results (${shown.length}/${papers.length}):`);
    shown.forEach((p, idx) => out.push(paperLines(p ?? {}, idx + 1)));
    if (papers.length > shown.length) out.push(`(showing first ${shown.length} results)`);
    out.push(SEARCH_CAVEAT);
    return out.join('\n');
  },
};

export const lit_verify = {
  name: 'lit_verify',
  description:
    "Checks a paper's citation match and retraction status. If doi + title are given: bibliographic title match (Crossref) and retraction check; only doi: retraction check; only title: a DOI candidate is extracted via package search and retraction is checked (approximate). Absence of a retraction record does not guarantee the paper is not retracted. Requires the literature-evidence-mcp package (uses the network); returns a gentle error message if unreachable.",
  parameters: {
    type: 'object',
    properties: {
      doi: { type: 'string', description: 'DOI (e.g. 10.1038/nature12373); with title or on its own' },
      title: { type: 'string', description: 'Paper title (for bibliographic match; used to extract a candidate when no DOI is given)' },
    },
  },
  needsApproval: false,
  parallel: true,
  async execute({ doi, title } = {}) {
    const d = str(doi);
    const t = str(title);
    if (!d && !t) throw new Error('at least one of doi or title is required');

    if (d && t) {
      const cite = await runBridge('cite', { doi: d, title: t });
      const retr = await runBridge('retract', { doi: d });
      const out = [];
      if (!cite.ok) out.push(`Citation verification: ${gentle(cite.error)}`);
      else out.push(...citeLines(d, t, cite.data));
      if (!retr.ok) out.push(`Retraction check: ${gentle(retr.error)}`);
      else out.push(...retractLines(retr.data));
      return out.join('\n');
    }

    if (d) {
      const retr = await runBridge('retract', { doi: d });
      if (!retr.ok) return gentle(retr.error);
      return [`DOI: ${d}`, '(bibliographic title match skipped because no title was given)', ...retractLines(retr.data)].join('\n');
    }

    // Title only: resolve a DOI candidate via the package search, then check it.
    const search = await runBridge('search', { query: t, limit: 3 });
    if (!search.ok) return gentle(search.error);
    const papers = Array.isArray(search.data?.papers) ? search.data.papers : [];
    const top = papers.find((p) => typeof p?.doi === 'string' && p.doi);
    const out = ['No DOI given; package search was used to extract a candidate.'];
    if (!top) {
      out.push('No candidate with a DOI was found; try again with the DOI for exact verification.');
      out.push(SEARCH_CAVEAT);
      return out.join('\n');
    }
    out.push(`Best candidate: ${Number.isFinite(top.year) ? `[${top.year}] ` : ''}${top.title ?? '(no title)'} (DOI: ${top.doi})`);
    const retr = await runBridge('retract', { doi: top.doi });
    if (!retr.ok) out.push(`Retraction check: ${gentle(retr.error)}`);
    else out.push(...retractLines(retr.data));
    out.push('Note: the title→DOI match is approximate; give the DOI explicitly for exact verification.');
    return out.join('\n');
  },
};

export const lit_quote = {
  name: 'lit_quote',
  description:
    'Verifies whether the given quote appears verbatim in the Europe PMC full text; returns matched paragraph ids and section info. Package constraint: quote verification works by PMCID (DOI not supported), pass a PMCID (e.g. PMC8765432). This is a verbatim text match, not a judgment of scientific validity. Requires the literature-evidence-mcp package (uses the network); returns a gentle error message if unreachable.',
  parameters: {
    type: 'object',
    properties: {
      pmcid: { type: 'string', description: 'Europe PMC/PMC id (e.g. PMC8765432)' },
      quote: { type: 'string', description: 'Verbatim quote text to verify' },
    },
    required: ['pmcid', 'quote'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ pmcid, quote } = {}) {
    const pm = str(pmcid);
    const qt = str(quote);
    if (!pm || !qt) throw new Error('pmcid and quote required (the package verifies quotes by PMCID)');
    const r = await runBridge('quote', { pmcid: pm, quote: qt });
    if (!r.ok) return gentle(r.error);
    return [`PMCID: ${pm}`, ...quoteLines(r.data)].join('\n');
  },
};
