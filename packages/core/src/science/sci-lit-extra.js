import { spawn } from 'node:child_process';
import { readFile } from 'node:fs/promises';
import { isAbsolute, join, resolve } from 'node:path';
import { resolvePython } from './pybridge.js';

/**
 * Extra literature evidence bridge: methodology audit, PRISMA-style screening,
 * hash-chained evidence ledger (append + verify), offline quote check on
 * caller-supplied text, BibTeX/RIS/CSL-JSON export, statistical reporting
 * consistency screen, DOI normalization, caller-supplied PDF page provenance
 * and offline BM25 evidence ranking via the user's installed
 * `literature-evidence-mcp` Python package (>= 0.5.1).
 *
 * Same call pattern as sci-lit.js: the package exposes directly callable
 * functions in `literature_evidence_mcp.server` (audit_pmc_methodology,
 * search_literature + screen_methodology, export_bibliography, verify_quote,
 * export_evidence, EvidenceLedger.verify / verify_evidence_ledger,
 * check_statistical_reporting, normalize_doi, pdf_page_provenance,
 * bm25_rank_evidence), so no MCP
 * stdio client is needed. Each call spawns
 * `python -X utf8 -I -c <driver>` with JSON on stdin and a sentinel-prefixed
 * JSON result on stdout. Every failure (missing Python, missing package,
 * network outage, provider rate limit, timeout) resolves to a gentle message
 * string; execute never lets the process crash.
 */

// Per-process spawn timeout (~60 s) and the shorter inner Python await timeout.
const BRIDGE_TIMEOUT_MS = 60_000;
const PY_INNER_TIMEOUT_S = 55;

// Sentinel markers: server logs go to stderr, but stdout is still parsed defensively.
const OK_MARK = '@@OK@@';
const ERR_MARK = '@@ERR@@';

// Python driver: read JSON request from stdin, dispatch one op, print JSON result.
// Handles both async server functions (wait_for) and plain sync ones directly.
const PY_DRIVER = `
import asyncio, json, sys

def _screen(srv, req):
    search = asyncio.run(_search(srv, req))
    papers = search.get("papers") if isinstance(search, dict) else None
    papers = papers if isinstance(papers, list) else []
    criteria = [str(c).strip() for c in (req.get("criteria") or []) if str(c).strip()]
    records = []
    for i, raw in enumerate(papers):
        p = raw if isinstance(raw, dict) else {}
        title = str(p.get("title") or "")
        abstract = str(p.get("abstract") or "")
        text = abstract.strip() or title.strip()
        doi = p.get("doi") if isinstance(p.get("doi"), str) and p.get("doi") else None
        rid = doi or ("no-doi:%d" % (i + 1))
        basis = "abstract" if abstract.strip() else ("title" if title.strip() else "none")
        row = {"record_id": rid, "title": title.strip(), "year": p.get("year"),
               "doi": doi, "sources": p.get("sources") if isinstance(p.get("sources"), list) else [p.get("source")],
               "text_basis": basis, "decision": None, "reason": None,
               "missing_criteria": [], "features": [], "example_snippet": None}
        if text and len(text) <= 250000:
            scr = srv.screen_methodology(text, rid)
            feats = []
            for field, info in (scr.get("features") or {}).items():
                if isinstance(info, dict) and info.get("status") == "TERM_MENTIONED":
                    feats.append(field)
                    ex = (info.get("examples") or [None])[0]
                    if row["example_snippet"] is None and isinstance(ex, dict):
                        sn = str(ex.get("snippet") or "")
                        if sn:
                            row["example_snippet"] = sn[:200]
            row["features"] = feats
            low = text.lower()
            row["missing_criteria"] = [c for c in criteria if c.lower() not in low]
            if criteria:
                if not row["missing_criteria"]:
                    row["decision"] = "include"
                else:
                    row["decision"] = "exclude"
                    row["reason"] = "criteria not found in screened text: " + ", ".join(row["missing_criteria"])
        elif criteria:
            row["decision"] = "exclude"
            row["reason"] = "no abstract/title text available for screening"
        records.append(row)
    inc = sum(1 for r in records if r["decision"] == "include")
    exc = sum(1 for r in records if r["decision"] == "exclude")
    pend = sum(1 for r in records if r["decision"] is None)
    return {"query": str(req.get("query") or ""), "criteria": criteria,
            "provider_status": search.get("provider_status") if isinstance(search, dict) else None,
            "identified": len(papers), "screened": len(papers) - sum(1 for r in records if r["text_basis"] == "none"),
            "included": inc, "excluded": exc, "pending": pend, "records": records,
            "status": "AUTOMATED_SINGLE_PASS_PRESCREEN_ONLY"}

async def _search(srv, req):
    return await srv.search_literature(str(req["query"]), int(req.get("limit", 8)))

def _ledger(srv, req):
    path = str(req.get("path") or "").strip()
    if path:
        led = srv.EvidenceLedger(path)
        check = led.verify()
        return {"path": str(led.file), **(check if isinstance(check, dict) else {})}
    check = srv.verify_evidence_ledger()
    out = check if isinstance(check, dict) else {}
    import os as _os
    out.setdefault("path", _os.getenv("EVIDENCE_LEDGER_PATH") or "evidence-ledger.jsonl")
    return out

def _main():
    try:
        req = json.loads(sys.stdin.buffer.read().decode("utf-8"))
        import literature_evidence_mcp.server as srv
        op = req.get("op")
        if op == "audit":
            res = srv.audit_pmc_methodology(
                str(req["pmcid"]), str(req["outcome"]), str(req["study_design"]),
                list(req.get("annotations") or []))
        elif op == "screen":
            res = _screen(srv, req)
        elif op == "ledger":
            res = _ledger(srv, req)
        elif op == "bib":
            res = srv.export_bibliography(list(req["papers"]), str(req.get("output_format", "bibtex")))
        elif op == "localquote":
            res = srv.verify_quote(str(req["quote_text"]), str(req["source_text"]), str(req["source_id"]))
        elif op == "evidence":
            res = srv.export_evidence(str(req["kind"]), dict(req["payload"]))
        elif op == "stats":
            res = srv.check_statistical_reporting(list(req["records"]))
        elif op == "doi":
            res = {"input": str(req["doi"]), "normalized": srv.normalize_doi(str(req["doi"]))}
        elif op == "pdfprov":
            res = srv.pdf_page_provenance(str(req["pdf_base64"]), int(req["page_number"]), str(req["quote"]))
        elif op == "rank":
            res = srv.bm25_rank_evidence(str(req["query"]), list(req["documents"]), int(req.get("top_k", 10)))
        else:
            raise ValueError("unknown op: %r" % (op,))
        if asyncio.iscoroutine(res):
            res = asyncio.run(asyncio.wait_for(res, timeout=float(req.get("timeout", ${PY_INNER_TIMEOUT_S}))))
        sys.stdout.write("${OK_MARK}" + json.dumps(res, ensure_ascii=False))
    except Exception as exc:
        sys.stdout.write("${ERR_MARK}" + json.dumps(
            {"error": type(exc).__name__ + ": " + str(exc)}, ensure_ascii=False))

_main()
`;

// Spawn the Python bridge once; always resolve (never reject) with a typed result.
function runBridge(op, payload = {}) {
  return new Promise((resolveBridge) => {
    const exe = resolvePython();
    if (!exe) {
      resolveBridge({ ok: false, error: 'Python interpreter not found' });
      return;
    }
    let child;
    try {
      child = spawn(exe, ['-X', 'utf8', '-I', '-c', PY_DRIVER], {
        windowsHide: true,
        timeout: BRIDGE_TIMEOUT_MS,
      });
    } catch (e) {
      resolveBridge({ ok: false, error: `Failed to start Python process: ${e.message}` });
      return;
    }
    let out = '';
    let done = false;
    const finish = (r) => {
      if (!done) {
        done = true;
        resolveBridge(r);
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
const clampLimit = (v, dflt = 8) => Math.min(20, Math.max(1, Math.floor(Number(v) || dflt)));

const fmtAuthors = (a) => {
  if (!Array.isArray(a) || !a.length) return '';
  return a.length > 3 ? `${a.slice(0, 3).join(', ')} et al.` : a.join(', ');
};

const SEARCH_CAVEAT =
  'Note: the search is not exhaustive; zero results does not mean the paper does not exist (may be provider unavailability or a rate limit).';

// Package-validated study designs and the domains they map to (mirrors DOMAINS).
const DESIGNS = {
  randomized_trial:
    'sequence_generation, allocation_concealment, baseline_imbalance, deviations_from_intervention, missing_outcome_data, outcome_measurement, selective_reporting',
  observational:
    'selection_of_participants, confounding, exposure_measurement, missing_data, outcome_measurement, selective_reporting',
};

// Render the audit_pmc_methodology result dict.
function auditLines(outcome, design, data) {
  const lines = [
    `Methodology audit (source-bound evidence traceability): ${data?.pmcid ?? '(unknown pmcid)'}`,
    `Status: ${data?.status ?? 'unknown'}`,
    `Outcome: ${outcome} | Study design: ${design}`,
    `Paragraphs read: ${Number.isFinite(data?.paragraph_count_read) ? data.paragraph_count_read : '?'} | Full-text truncated: ${data?.retrieval_truncated === true ? 'yes' : 'no'}`,
  ];
  if (typeof data?.xml_sha256 === 'string') lines.push(`Source XML sha256: ${data.xml_sha256.slice(0, 16)}…`);

  const domains = data?.domains && typeof data.domains === 'object' ? data.domains : {};
  const entries = Object.entries(domains);
  if (entries.length) {
    lines.push('Domain statuses (traceability only, no risk-of-bias judgement):');
    for (const [name, d] of entries) {
      const rows = Array.isArray(d?.annotations) ? d.annotations : [];
      const matched = rows.filter((r) => r?.source_match === true).length;
      lines.push(`  ${name}: ${d?.status ?? 'unknown'} (${matched}/${rows.length} annotations source-matched)`);
    }
  } else {
    lines.push('No domains returned (no annotations supplied or empty audit).');
  }
  lines.push(
    `Summary: source-located domains: ${Number(data?.source_located_domain_count) || 0} | untraceable: ${Number(data?.untraceable_domain_count) || 0} | contradictory: ${Number(data?.contradictory_domain_count) || 0}`,
  );
  if (typeof data?.notice === 'string' && data.notice.trim()) lines.push(`Package notice: ${data.notice}`);
  lines.push(
    'Warning: this is a direct-quote traceability audit only; it is NOT a RoB-2/GRADE assessment and no scientific validity is inferred.',
  );
  return lines;
}

// Render the automated PRISMA-style pre-screen built from search + screen_methodology.
function screenLines(result) {
  const criteria = Array.isArray(result?.criteria) ? result.criteria : [];
  const records = Array.isArray(result?.records) ? result.records : [];
  const out = [
    `PRISMA-style automated pre-screen: "${result?.query ?? ''}"`,
    `Inclusion criteria: ${criteria.length ? criteria.join('; ') : '(none given — records listed as pending, decisions left to the reviewer)'}`,
  ];
  const ps = providerSummary(result?.provider_status);
  if (ps) out.push(ps);
  out.push(
    `Flow: identified ${Number(result?.identified) || 0} | screened ${Number(result?.screened) || 0} | included ${Number(result?.included) || 0} | excluded ${Number(result?.excluded) || 0} | pending ${Number(result?.pending) || 0}`,
  );
  if (!records.length) {
    out.push('No records found (0).');
    out.push(SEARCH_CAVEAT);
    return out;
  }
  out.push(`Records (${records.length}):`);
  records.forEach((r, idx) => {
    const decision = r?.decision ?? 'pending';
    const title = r?.title ? r.title.slice(0, 120) : '(no title)';
    const year = Number.isFinite(r?.year) ? `[${r.year}] ` : '';
    const doi = r?.doi ? ` | DOI: ${r.doi}` : '';
    out.push(`${idx + 1}. [${decision}] ${year}${title}${doi}`);
    const basis = r?.text_basis ?? 'none';
    const feats = Array.isArray(r?.features) && r.features.length ? ` | detected: ${r.features.join(', ')}` : '';
    out.push(`   record_id: ${r?.record_id ?? '?'} | basis: ${basis}${feats}`);
    if (r?.reason) out.push(`   reason: ${r.reason}`);
    if (r?.example_snippet) out.push(`   keyword context: "${r.example_snippet}"`);
  });
  out.push(
    'Warning: this is a single-pass automated keyword pre-screen, NOT a valid PRISMA two-reviewer screening; decisions are provisional and must be reviewed by humans.',
  );
  out.push('Package notice: keyword detection is not a valid risk-of-bias or methods-quality assessment; a non-match does not mean a method was not used.');
  out.push(SEARCH_CAVEAT);
  return out;
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

// Render the export_bibliography (BibTeX/RIS/CSL-JSON) result dict.
function bibLines(data) {
  const content = typeof data?.content === 'string' ? data.content : '';
  const lines = [
    `Bibliography export (${data?.format ?? 'bibtex'}, ${Number(data?.record_count) || 0} records, caller-supplied unverified metadata)`,
  ];
  const recs = Array.isArray(data?.records) ? data.records : [];
  const invalid = recs.filter((r) => r?.doi_status === 'INVALID_DOI_OMITTED');
  if (invalid.length) lines.push(`Note: ${invalid.length} record(s) had invalid DOIs and were exported without a DOI.`);
  if (content) {
    lines.push('--- Export ---');
    lines.push(content);
  } else {
    lines.push('(no export content returned)');
  }
  lines.push(
    'Warning: this formats metadata only; no DOI resolution, deduplication, study-quality review or scientific verification was performed.',
  );
  return lines;
}

// Render the verify_quote (literal match on caller-supplied text) result dict.
function localQuoteLines(data) {
  const lines = [`Literal quote check in supplied text (source: ${data?.source_id ?? '?'}): ${data?.status ?? 'unknown'}`];
  if (data?.text_match === true) {
    lines.push(`Match found at characters ${data?.offset_start ?? '?'}-${data?.offset_end ?? '?'}.`);
  } else {
    lines.push('No literal match found in the supplied text.');
  }
  if (typeof data?.source_text_sha256 === 'string') {
    lines.push(`Source text sha256: ${data.source_text_sha256.slice(0, 16)}…`);
  }
  lines.push('Warning: a literal text occurrence does not verify the claim or its scientific validity.');
  return lines;
}

// Render the export_evidence (hash-chained ledger append) result dict.
function evidenceLines(data) {
  const lines = [`Evidence record appended to the hash-chained ledger: ${data?.status ?? 'unknown'}`];
  if (Number.isFinite(data?.entry_number)) lines.push(`Entry number: ${data.entry_number}`);
  if (typeof data?.hash === 'string') lines.push(`Entry hash: ${data.hash.slice(0, 16)}…`);
  if (typeof data?.path === 'string') lines.push(`Ledger file: ${data.path}`);
  lines.push('Verify the chain afterwards with lit_ledger. Limitation: wholesale replacement of the ledger file cannot be detected.');
  return lines;
}

// Render the check_statistical_reporting (mechanical stats consistency) result dict.
// `records` is the caller's original input; the package echoes only index/flags/status.
function statsCheckLines(records, data) {
  const lines = [`Statistical reporting screen (mechanical consistency): ${data?.status ?? 'unknown'}`];
  const checked = Array.isArray(data?.records) ? data.records : [];
  const flagged = checked.filter((r) => Array.isArray(r?.flags) && r.flags.length);
  lines.push(`Records checked: ${checked.length} | flagged: ${flagged.length}`);
  checked.forEach((r) => {
    const idx = Number.isFinite(r?.index) ? r.index : '?';
    const label =
      typeof records[idx]?.label === 'string' && records[idx].label.trim()
        ? ` (${records[idx].label.trim().slice(0, 80)})`
        : '';
    const flags = Array.isArray(r?.flags) && r.flags.length ? r.flags.join(', ') : 'none';
    lines.push(`  Record ${idx}${label}: ${r?.status ?? 'unknown'} | flags: ${flags}`);
  });
  if (typeof data?.notice === 'string' && data.notice.trim()) lines.push(`Package notice: ${data.notice}`);
  lines.push(
    'Warning: these are range/ordering checks on the numbers as entered; no statistical test, effect re-estimation or scientific validity assessment was performed.',
  );
  return lines;
}

// Render the normalize_doi result dict.
function doiNormalizeLines(input, data) {
  return [
    `Normalized DOI: ${typeof data?.normalized === 'string' && data.normalized ? data.normalized : '?'}`,
    `Input: ${input}`,
    'Note: syntactic normalization only (prefix strip, format validation, lowercase); registration or resolvability is not checked (use lit_verify for that).',
  ];
}

// Render the pdf_page_provenance (caller-supplied PDF) result dict.
function pdfProvenanceLines(data) {
  const lines = [
    `PDF page provenance: ${data?.status ?? 'unknown'}`,
    `Page: ${Number.isFinite(data?.page_number) ? data.page_number : '?'} of ${Number.isFinite(data?.page_count) ? data.page_count : '?'} | PDF sha256: ${typeof data?.pdf_sha256 === 'string' ? `${data.pdf_sha256.slice(0, 16)}…` : '?'}`,
  ];
  if (typeof data?.page_text_sha256 === 'string') lines.push(`Page text sha256: ${data.page_text_sha256.slice(0, 16)}…`);
  if (Number.isFinite(data?.quote_offset_start) && Number.isFinite(data?.quote_offset_end)) {
    lines.push(`Quote found at characters ${data.quote_offset_start}-${data.quote_offset_end}.`);
  } else {
    lines.push('Quote not found on this page (offsets null).');
  }
  const rects = Array.isArray(data?.matching_text_bounding_boxes) ? data.matching_text_bounding_boxes : [];
  const tables = Array.isArray(data?.detected_table_bounding_boxes) ? data.detected_table_bounding_boxes : [];
  const images = Array.isArray(data?.detected_image_bounding_boxes) ? data.detected_image_bounding_boxes : [];
  lines.push(
    `Match text boxes: ${rects.length} | tables: ${tables.length}${data?.tables_truncated === true ? ' (truncated)' : ''} | images: ${images.length}${data?.images_truncated === true ? ' (truncated)' : ''}`,
  );
  if (typeof data?.notice === 'string' && data.notice.trim()) lines.push(`Package notice: ${data.notice}`);
  lines.push(
    'Warning: structural/textual PDF coordinates only; figure and table content, source authenticity and scientific claims are not verified.',
  );
  return lines;
}

// Map pdf_page_provenance input errors to clear messages (offline op; the network
// gentle text would mislead when the package rejects a caller-supplied PDF).
function pdfProvError(errorText, page) {
  const msg = String(errorText ?? '');
  if (/Page not present/i.test(msg)) return `Error: page ${page} is not present in the PDF (check the reported page count).`;
  if (/quote length/i.test(msg)) return 'Error: quote must be 1-2000 characters.';
  if (/page_number/i.test(msg)) return 'Error: page_number must be an integer from 1 to 1000.';
  if (/PDF/i.test(msg)) return 'Error: the PDF could not be parsed (invalid, oversized or unsupported file).';
  return gentle(msg);
}

// Render the EvidenceLedger.verify() result dict.
function ledgerLines(data) {
  const status = data?.status ?? 'unknown';
  const lines = [`Evidence ledger integrity (hash chain): ${status}`];
  if (typeof data?.path === 'string') lines.push(`Ledger file: ${data.path}`);
  if (Number.isFinite(data?.count)) lines.push(`Entries verified: ${data.count}`);
  if (typeof data?.head === 'string') lines.push(`Chain head: ${data.head.slice(0, 16)}…`);
  if (Number.isFinite(data?.line)) lines.push(`Problem detected at line: ${data.line}`);
  if (status === 'TAMPER_DETECTED') {
    lines.push('WARNING: hash-chain integrity check FAILED — the ledger was modified or truncated after entries were appended. Do not trust its contents.');
  } else if (status === 'TAMPER_OR_CORRUPTION_DETECTED') {
    lines.push('WARNING: the ledger file is corrupt or unreadable. Do not trust its contents.');
  } else if (status === 'VALID_EMPTY') {
    lines.push('Ledger file not found or empty; no evidence entries have been recorded yet.');
  }
  lines.push(
    'Limitation: the hash chain verifies sequential entry integrity only; wholesale replacement of the ledger file with a fresh valid chain cannot be detected.',
  );
  return lines;
}

export const lit_audit = {
  name: 'lit_audit',
  description:
    'Runs a source-bound methodology audit on a Europe PMC article: fetches the JATS full text and checks user reporting annotations (domain, answer, optional verbatim quote) against direct paragraphs. Supported designs: randomized_trial or observational. This is quote traceability only, NOT a RoB-2/GRADE assessment and no scientific validity is inferred. Requires the literature-evidence-mcp package (uses the network); returns a gentle error message if unreachable.',
  parameters: {
    type: 'object',
    properties: {
      pmcid: { type: 'string', description: 'Europe PMC/PMC id of the article to audit (e.g. PMC8765432)' },
      outcome: { type: 'string', description: 'Result/outcome the audit focuses on (e.g. 28-day mortality)' },
      study_design: {
        type: 'string',
        enum: ['randomized_trial', 'observational'],
        description: 'Study design selecting the audit domains (default randomized_trial)',
      },
      annotations: {
        type: 'array',
        description:
          'Up to 100 reporting annotations: objects {domain, answer, quote?}. answer is one of reported_yes, reported_no, unclear, not_applicable; domain must belong to the design (randomized_trial: sequence_generation, allocation_concealment, baseline_imbalance, deviations_from_intervention, missing_outcome_data, outcome_measurement, selective_reporting; observational: selection_of_participants, confounding, exposure_measurement, missing_data, outcome_measurement, selective_reporting); quote is the verbatim text supporting a reported_yes/reported_no answer',
        items: {
          type: 'object',
          properties: {
            domain: { type: 'string', description: 'Audit domain (see tool description for valid values)' },
            answer: {
              type: 'string',
              enum: ['reported_yes', 'reported_no', 'unclear', 'not_applicable'],
              description: 'Reporting answer for this domain',
            },
            quote: { type: 'string', description: 'Verbatim quote (>=12 chars) supporting a reported_yes/reported_no answer' },
          },
          required: ['domain', 'answer'],
        },
      },
    },
    required: ['pmcid', 'outcome'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ pmcid, outcome, study_design, annotations } = {}) {
    const pm = str(pmcid);
    const oc = str(outcome);
    if (!pm || !oc) throw new Error('pmcid and outcome are required');
    const design = str(study_design) || 'randomized_trial';
    if (!DESIGNS[design]) {
      return `Error: unsupported study_design "${design}". Supported values: randomized_trial, observational.`;
    }
    let anns = [];
    if (annotations !== undefined && annotations !== null && annotations !== '') {
      if (!Array.isArray(annotations)) {
        return 'Error: annotations must be an array of objects {domain, answer, quote?}.';
      }
      if (annotations.length > 100) {
        return 'Error: too many annotations (max 100 per audit).';
      }
      anns = annotations;
    }
    const r = await runBridge('audit', { pmcid: pm, outcome: oc, study_design: design, annotations: anns });
    if (!r.ok) return gentle(r.error);
    return auditLines(oc, design, r.data).join('\n');
  },
};

export const lit_screen = {
  name: 'lit_screen',
  description:
    'Searches open academic providers for a query and runs a PRISMA-style automated pre-screen: each record (abstract or title) is passed through the package methodology keyword screen and, when inclusion criteria are given, records matching all criteria are marked include and the rest exclude with reasons. Decisions are provisional single-pass keyword automation, NOT a valid PRISMA two-reviewer screening. Requires the literature-evidence-mcp package (uses the network); returns a gentle error message if unreachable.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Text to search for (title, topic or keywords)' },
      criteria: {
        type: 'array',
        items: { type: 'string' },
        description: 'Inclusion criteria as keywords/phrases; a record is included only if ALL appear in its abstract/title (case-insensitive). Omit to list records as pending without decisions',
      },
      max_results: {
        type: 'number',
        description: 'Max records per provider (1-20, default 8)',
      },
    },
    required: ['query'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ query, criteria, max_results } = {}) {
    const q = str(query);
    if (!q) throw new Error('query required: provide the text to search');
    let crits = [];
    if (criteria !== undefined && criteria !== null && criteria !== '') {
      if (!Array.isArray(criteria)) {
        return 'Error: criteria must be an array of keyword strings.';
      }
      crits = criteria.map((c) => str(c)).filter(Boolean);
    }
    const limit = clampLimit(max_results);
    const r = await runBridge('screen', { query: q, limit, criteria: crits });
    if (!r.ok) return gentle(r.error);
    return screenLines(r.data).join('\n');
  },
};

export const lit_ledger = {
  name: 'lit_ledger',
  description:
    'Verifies the integrity of the local hash-chained evidence ledger (append-only JSONL): re-computes each entry hash and the previous-hash chain and reports VALID, VALID_EMPTY, TAMPER_DETECTED or TAMPER_OR_CORRUPTION_DETECTED. By default uses the EVIDENCE_LEDGER_PATH environment variable or evidence-ledger.jsonl in the working directory. Local-only check (no network); returns a gentle error message if the package is missing.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Optional path to the ledger JSONL file; relative paths resolve against the workspace root. Omit to use EVIDENCE_LEDGER_PATH or the default evidence-ledger.jsonl',
      },
    },
  },
  needsApproval: false,
  parallel: true,
  async execute({ path } = {}, ctx = {}) {
    let p = str(path);
    if (p) {
      if (!isAbsolute(p)) {
        const base = typeof ctx?.workspaceRoot === 'string' && ctx.workspaceRoot ? ctx.workspaceRoot : process.cwd();
        p = resolve(join(base, p));
      }
      if (/[*?]/.test(p)) return 'Error: invalid ledger path (wildcards are not allowed).';
    }
    const r = await runBridge('ledger', p ? { path: p } : {});
    if (!r.ok) return gentle(r.error);
    return ledgerLines(r.data).join('\n');
  },
};

export const lit_bib = {
  name: 'lit_bib',
  description:
    'Formats caller-supplied paper metadata (title, authors, journal, year, DOI — e.g. records from lit_search) as BibTeX, RIS or CSL-JSON for reference lists. Offline deterministic formatting; no DOI resolution, deduplication or verification is performed, and metadata is treated as unverified caller input.',
  parameters: {
    type: 'object',
    properties: {
      papers: {
        type: 'array',
        description:
          '1-100 metadata records, each {title (required), authors (list of names), journal, year (four-digit), doi}; e.g. the papers array returned by lit_search',
        items: {
          type: 'object',
          properties: {
            title: { type: 'string', description: 'Paper title (required)' },
            authors: { type: 'array', items: { type: 'string' }, description: 'Author names' },
            journal: { type: 'string', description: 'Journal name' },
            year: { type: 'number', description: 'Four-digit publication year' },
            doi: { type: 'string', description: 'DOI string' },
          },
          required: ['title'],
        },
      },
      output_format: {
        type: 'string',
        enum: ['bibtex', 'ris', 'csl-json'],
        description: 'Output format (default bibtex)',
      },
    },
    required: ['papers'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ papers, output_format } = {}) {
    if (!Array.isArray(papers) || !papers.length) {
      return 'Error: papers must be a non-empty array of metadata objects {title, authors?, journal?, year?, doi?}.';
    }
    if (papers.length > 100) {
      return 'Error: too many papers (max 100 per export).';
    }
    if (papers.some((p) => p === null || typeof p !== 'object' || Array.isArray(p))) {
      return 'Error: each paper must be a metadata object with at least a title.';
    }
    const fmt = str(output_format) || 'bibtex';
    if (!['bibtex', 'ris', 'csl-json'].includes(fmt)) {
      return 'Error: output_format must be bibtex, ris or csl-json.';
    }
    const r = await runBridge('bib', { papers, output_format: fmt });
    if (!r.ok) return gentle(r.error);
    return bibLines(r.data).join('\n');
  },
};

export const lit_quote_text = {
  name: 'lit_quote_text',
  description:
    'Checks whether a quote appears verbatim in caller-supplied text (a user document, text fetched yourself or lit_fulltext output) and returns the match offsets. Offline literal string check; unlike lit_quote it fetches no source, so the caller is responsible for the provenance of the text. A literal match is not a judgment of scientific validity.',
  parameters: {
    type: 'object',
    properties: {
      quote: { type: 'string', description: 'Verbatim quote to check (1-1000 characters)' },
      source_text: { type: 'string', description: 'Text to search in (1-250000 characters)' },
      source_id: { type: 'string', description: 'Label identifying the supplied text (e.g. the PMCID or file name)' },
    },
    required: ['quote', 'source_text', 'source_id'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ quote, source_text, source_id } = {}) {
    const qt = str(quote);
    const st = typeof source_text === 'string' ? source_text : '';
    const sid = str(source_id);
    if (!qt || !st || !sid) throw new Error('quote, source_text and source_id are required');
    if (qt.length > 1000) return 'Error: quote must be at most 1000 characters.';
    if (st.length > 250_000) return 'Error: source_text must be at most 250000 characters.';
    if (sid.length > 300) return 'Error: source_id must be at most 300 characters.';
    const r = await runBridge('localquote', { quote_text: qt, source_text: st, source_id: sid });
    if (!r.ok) return gentle(r.error);
    return localQuoteLines(r.data).join('\n');
  },
};

export const lit_evidence = {
  name: 'lit_evidence',
  description:
    'Appends one evidence record (a kind label plus a JSON payload, e.g. a search receipt or a verification result) to the local hash-chained JSONL evidence ledger; the entry hash chains onto the previous head. Local-only (no network); verify the file afterwards with lit_ledger. By default uses the EVIDENCE_LEDGER_PATH environment variable or evidence-ledger.jsonl in the working directory.',
  parameters: {
    type: 'object',
    properties: {
      kind: {
        type: 'string',
        description: 'Record type label: 2-48 lowercase letters/underscores (e.g. search_receipt, citation_check)',
      },
      payload: {
        type: 'object',
        description: 'JSON payload of the evidence record (max 100 KB when serialized)',
      },
    },
    required: ['kind', 'payload'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ kind, payload } = {}) {
    const k = str(kind);
    if (!k || !/^[a-z_]{2,48}$/.test(k)) {
      return 'Error: kind must be 2-48 lowercase letters/underscores (e.g. search_receipt).';
    }
    if (payload === null || typeof payload !== 'object' || Array.isArray(payload)) {
      return 'Error: payload must be a JSON object.';
    }
    let body;
    try {
      body = JSON.stringify(payload);
    } catch {
      return 'Error: payload must be JSON-serializable.';
    }
    if (body.length > 100_000) {
      return 'Error: payload exceeds the 100 KB ledger record limit.';
    }
    const r = await runBridge('evidence', { kind: k, payload });
    if (!r.ok) return gentle(r.error);
    return evidenceLines(r.data).join('\n');
  },
};

export const lit_stats_check = {
  name: 'lit_stats_check',
  description:
    'Screens caller-supplied reported statistics (p values, confidence intervals, sample sizes, point estimates) for mechanical inconsistencies: p value outside 0-1, reversed or partial confidence interval, estimate outside its reported CI, invalid sample size. Purely arithmetic range/ordering checks on the numbers exactly as entered — no statistical re-analysis, no scientific validity assessment; runs offline (the records are never sent to any provider). Requires the literature-evidence-mcp package.',
  parameters: {
    type: 'object',
    properties: {
      records: {
        type: 'array',
        description:
          '1-100 statistical records, each {label?, p_value?, sample_size?, ci_lower?, ci_upper?, estimate?}; label is free text identifying the paper/table/section (not checked), the others are optional numbers taken exactly as reported',
        items: {
          type: 'object',
          properties: {
            label: { type: 'string', description: 'Free-text identifier, e.g. "Smith 2020 Table 2" (not checked)' },
            p_value: { type: 'number', description: 'Reported p value; flags P_VALUE_OUT_OF_RANGE when outside 0-1' },
            sample_size: { type: 'number', description: 'Reported sample size (integer); flags INVALID_SAMPLE_SIZE when below 1' },
            ci_lower: { type: 'number', description: 'Lower bound of the reported confidence interval' },
            ci_upper: { type: 'number', description: 'Upper bound of the reported confidence interval' },
            estimate: {
              type: 'number',
              description: 'Reported point estimate; flags ESTIMATE_OUTSIDE_REPORTED_CI_REVIEW when outside ci_lower..ci_upper',
            },
          },
        },
      },
    },
    required: ['records'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ records } = {}) {
    if (!Array.isArray(records) || !records.length) {
      return 'Error: records must be a non-empty array of statistical records {label?, p_value?, sample_size?, ci_lower?, ci_upper?, estimate?}.';
    }
    if (records.length > 100) {
      return 'Error: too many records (max 100 per screen).';
    }
    if (records.some((r) => r === null || typeof r !== 'object' || Array.isArray(r))) {
      return 'Error: each record must be an object with optional numeric fields p_value, sample_size, ci_lower, ci_upper, estimate.';
    }
    const NUM_FIELDS = ['p_value', 'sample_size', 'ci_lower', 'ci_upper', 'estimate'];
    for (let i = 0; i < records.length; i++) {
      for (const key of NUM_FIELDS) {
        const v = records[i][key];
        if (v !== undefined && v !== null && (typeof v !== 'number' || !Number.isFinite(v))) {
          return `Error: record ${i} field ${key} must be a finite number (got ${typeof v}).`;
        }
      }
    }
    const r = await runBridge('stats', { records });
    if (!r.ok) return gentle(r.error);
    return statsCheckLines(records, r.data).join('\n');
  },
};

export const lit_doi_normalize = {
  name: 'lit_doi_normalize',
  description:
    'Normalizes a DOI to its canonical lowercase form: strips https://doi.org/, https://dx.doi.org/ and doi: prefixes and validates the 10.<registrant>/<suffix> syntax. Syntactic cleanup only — it does not check that the DOI is registered or resolvable (use lit_verify for that). Offline; requires the literature-evidence-mcp package.',
  parameters: {
    type: 'object',
    properties: {
      doi: {
        type: 'string',
        description: 'DOI in any common spelling: bare 10.<registrant>/<suffix>, doi: prefixed, or a https://doi.org/ URL',
      },
    },
    required: ['doi'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ doi } = {}) {
    const d = str(doi);
    if (!d) throw new Error('doi required (e.g. 10.1038/nature12373 or https://doi.org/10.1038/nature12373)');
    const r = await runBridge('doi', { doi: d });
    if (!r.ok) {
      if (/Expected a valid DOI/i.test(r.error)) {
        return 'Error: invalid DOI; expected 10.<registrant>/<suffix> (e.g. 10.1038/nature12373, doi:10.1038/nature12373 or a https://doi.org/ URL).';
      }
      return gentle(r.error);
    }
    return doiNormalizeLines(d, r.data).join('\n');
  },
};

export const lit_pdf_provenance = {
  name: 'lit_pdf_provenance',
  description:
    'Audits one page of a caller-supplied PDF: returns the PDF SHA-256, the page text hash, the character offsets where a quote occurs and bounding boxes for the matching text, tables and images. Structural/textual provenance only — embedded image content, table semantics, source authenticity and scientific claims are not verified. Runs offline (the PDF is read locally, nothing is uploaded); requires the literature-evidence-mcp package.',
  parameters: {
    type: 'object',
    properties: {
      pdf_path: {
        type: 'string',
        description:
          'Path to a local PDF file (max 5 MB); relative paths resolve against the workspace root. Used when both pdf_path and pdf_base64 are given',
      },
      pdf_base64: {
        type: 'string',
        description: 'PDF bytes base64-encoded (max 7 MB of base64, decoded max 5 MB); use pdf_path when the file is on disk',
      },
      page_number: { type: 'number', description: '1-based page number to audit (1-1000)' },
      quote: { type: 'string', description: 'Quote to locate on that page (1-2000 characters)' },
    },
    required: ['page_number', 'quote'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ pdf_path, pdf_base64, page_number, quote } = {}, ctx = {}) {
    const page = Math.floor(Number(page_number));
    if (!Number.isFinite(page) || page < 1 || page > 1000) {
      return 'Error: page_number must be an integer from 1 to 1000.';
    }
    const qt = typeof quote === 'string' ? quote.trim() : '';
    if (!qt) throw new Error('quote required (the text to locate on the page)');
    if (qt.length > 2000) return 'Error: quote must be 1-2000 characters.';
    let b64 = typeof pdf_base64 === 'string' ? pdf_base64.trim() : '';
    let p = str(pdf_path);
    if (p) {
      if (!isAbsolute(p)) {
        const base = typeof ctx?.workspaceRoot === 'string' && ctx.workspaceRoot ? ctx.workspaceRoot : process.cwd();
        p = resolve(join(base, p));
      }
      if (/[*?]/.test(p)) return 'Error: invalid PDF path (wildcards are not allowed).';
      let buf;
      try {
        buf = await readFile(p);
      } catch (e) {
        return `Error: could not read the PDF file (${e.message}).`;
      }
      if (buf.length > 5_000_000) return 'Error: PDF file too large (max 5 MB).';
      b64 = buf.toString('base64');
    }
    if (!b64) throw new Error('pdf_path or pdf_base64 required (the caller-supplied PDF to audit)');
    if (b64.length > 7_000_000) return 'Error: PDF base64 too large (max 7 MB, decoded max 5 MB).';
    if (!Buffer.from(b64, 'base64').subarray(0, 5).toString('latin1').startsWith('%PDF-')) {
      return 'Error: file does not look like a PDF (missing %PDF- header).';
    }
    const r = await runBridge('pdfprov', { pdf_base64: b64, page_number: page, quote: qt });
    if (!r.ok) return pdfProvError(r.error, page);
    return pdfProvenanceLines(r.data).join('\n');
  },
};

// Render the bm25_rank_evidence (lexical ranking of caller-supplied documents) result dict.
function bm25RankLines(data) {
  const lines = [`BM25 evidence ranking (caller-supplied corpus): ${data?.status ?? 'unknown'}`];
  if (typeof data?.backend === 'string' && data.backend) lines.push(`Backend: ${data.backend}`);
  lines.push(
    `Candidates: ${Number(data?.candidate_count) || 0} | lexically matched: ${Number(data?.lexically_matched_candidates) || 0} | returned: ${Number(data?.returned_count) || 0}`,
  );
  const results = Array.isArray(data?.results) ? data.results : [];
  for (const r of results.slice(0, 50)) {
    const title = typeof r?.title === 'string' && r.title ? r.title.slice(0, 100) : '(no title)';
    const score = Number.isFinite(r?.bm25_score) ? r.bm25_score.toFixed(4) : '?';
    lines.push(`  ${r?.rank ?? '?'}. ${r?.id ?? '?'}: ${title} | BM25 score: ${score}`);
  }
  if (data?.status === 'NO_QUERY_TERM_OVERLAP') {
    lines.push('No candidate shares a query term; nothing is ranked (absence of lexical overlap is not evidence of absence).');
  }
  if (data?.status === 'NO_INDEXABLE_DOCUMENT_TEXT') {
    lines.push('No candidate had indexable text (words of two or more characters).');
  }
  if (typeof data?.notice === 'string' && data.notice.trim()) lines.push(`Package notice: ${data.notice}`);
  lines.push(
    'Warning: BM25 is a lexical overlap ranking only; it does not verify sources, semantic support or scientific validity.',
  );
  return lines;
}

export const lit_bm25_rank = {
  name: 'lit_bm25_rank',
  description:
    'Ranks caller-supplied documents (id, title, abstract) against a query with BM25 (rank-bm25/BM25Okapi) and returns only lexically matched candidates with scores, highest first. Lexical overlap ranking only — no semantic support, source authentication or scientific verdict, and no network: the corpus stays local. Requires the literature-evidence-mcp package and the optional rank_bm25 package; if rank_bm25 is missing a dedicated install hint is returned.',
  parameters: {
    type: 'object',
    properties: {
      query: { type: 'string', description: 'Query text (2-1000 characters; words of two or more characters are indexed)' },
      documents: {
        type: 'array',
        description:
          '1-10000 candidate records, each {id (unique string or integer), title?, abstract?}; title (max 700 chars) and abstract (max 20000 chars) are strings and at least one must be non-empty',
        items: {
          type: 'object',
          properties: {
            id: { type: ['string', 'number'], description: 'Unique record id (string 1-256 chars, or integer)' },
            title: { type: 'string', description: 'Document title (max 700 characters)' },
            abstract: { type: 'string', description: 'Document abstract (max 20000 characters)' },
          },
          required: ['id'],
        },
      },
      top_k: { type: 'number', description: 'Max ranked results to return (1-50, default 10)' },
    },
    required: ['query', 'documents'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ query, documents, top_k } = {}) {
    const q = str(query);
    if (!q) throw new Error('query required (2-1000 characters to rank the supplied documents against)');
    if (q.length < 2 || q.length > 1000) {
      return 'Error: query must have 2-1000 characters.';
    }
    if (!Array.isArray(documents) || !documents.length) {
      return 'Error: documents must be a non-empty array of records {id, title?, abstract?}.';
    }
    if (documents.length > 10_000) {
      return 'Error: too many documents (max 10000 per ranking).';
    }
    const seen = new Set();
    let totalBytes = 0;
    for (let i = 0; i < documents.length; i++) {
      const d = documents[i];
      if (d === null || typeof d !== 'object' || Array.isArray(d)) {
        return `Error: document ${i} must be an object {id, title?, abstract?}.`;
      }
      const rawId = d.id;
      let id;
      if (typeof rawId === 'string') id = rawId.trim();
      else if (typeof rawId === 'number' && Number.isInteger(rawId)) id = String(rawId);
      if (!id || id.length < 1 || id.length > 256) {
        return `Error: document ${i} requires a string id (1-256 characters) or an integer id.`;
      }
      if (seen.has(id)) {
        return `Error: duplicate document id "${id.slice(0, 64)}"; ids must be unique.`;
      }
      seen.add(id);
      const title = d.title;
      const abstract = d.abstract;
      if ((title !== undefined && title !== null && typeof title !== 'string') ||
          (abstract !== undefined && abstract !== null && typeof abstract !== 'string')) {
        return `Error: document ${i} title and abstract must be strings when given.`;
      }
      const t = typeof title === 'string' ? title : '';
      const a = typeof abstract === 'string' ? abstract : '';
      if (!t.trim() && !a.trim()) {
        return `Error: document ${i} needs a non-empty title or abstract.`;
      }
      if (t.length > 700) return `Error: document ${i} title exceeds 700 characters.`;
      if (a.length > 20_000) return `Error: document ${i} abstract exceeds 20000 characters.`;
      totalBytes += Buffer.byteLength(t, 'utf8') + Buffer.byteLength(a, 'utf8');
      if (totalBytes > 8_000_000) {
        return 'Error: total candidate text exceeds the 8 MB limit.';
      }
    }
    const k = Math.min(50, Math.max(1, Math.floor(Number(top_k) || 10)));
    const r = await runBridge('rank', { query: q, documents, top_k: k });
    if (!r.ok) return gentle(r.error);
    if (r.data?.status === 'OPTIONAL_BM25_NOT_INSTALLED') {
      return 'Error: the optional rank_bm25 Python package is not installed. Install: "python -m pip install rank_bm25" (or "python -m pip install literature-evidence-mcp[retrieval]") and retry.';
    }
    return bm25RankLines(r.data).join('\n');
  },
};
