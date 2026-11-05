import { spawn } from 'node:child_process';
import { isAbsolute, join, resolve } from 'node:path';
import { resolvePython } from './pybridge.js';

/**
 * Extra literature evidence bridge: methodology audit, PRISMA-style screening
 * and hash-chained evidence ledger verification via the user's installed
 * `literature-evidence-mcp` Python package (>= 0.5.1).
 *
 * Same call pattern as sci-lit.js: the package exposes directly callable
 * functions in `literature_evidence_mcp.server` (audit_pmc_methodology,
 * search_literature + screen_methodology, EvidenceLedger.verify /
 * verify_evidence_ledger), so no MCP stdio client is needed. Each call spawns
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
