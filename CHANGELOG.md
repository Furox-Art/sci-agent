# Changelog

All notable changes to SciAgent. Versions follow the root `package.json`.

## 0.10.2 — 2026-11-06

### Security (local app hardening)
- **Session id path traversal fixed** — `/api/sessions/{switch,rename,delete}` accepted ids like `../keep`, allowing reads/writes/deletes of arbitrary `.json` files outside the sessions directory; ids are now validated (`[A-Za-z0-9_-]{1,100}`), invalid ones get 400/404
- **Localhost CSRF / DNS-rebinding fixed** — a malicious website could no-cors-POST `/api/config` and retarget the model endpoint (exfiltrating conversations on the next calls); the server now rejects non-local `Host` headers (403) and requires `application/json` on POSTs (415), which browsers cannot send cross-origin without CORS
- `/api/csv` escape attempts now return 400 (no path leakage), missing files 404; invalid JSON 400; oversized bodies 413; static serving uses a `path.relative` containment check; skill sources are shape-validated before any network call
- Markdown renderer extracted to `ui/md.js` (single source for UI and tests, identical output); renderer crash guard for malformed model placeholders

### Tests
- +19 tests (renderer escaping, XSS vectors, traversal, CSRF, validation codes): **153 total, 0 fail**

### Electron (0.10.1 follow-up, same batch)
- Application menu (Reload/DevTools/About), single-instance lock (second launch focuses the window instead of racing the server port), startup errors show a native dialog instead of a white window, server handle closed on quit

## 0.10.1 — 2026-11-06

### Fixed
- **Packaged app data paths** — the installed SciAgent now writes config and sessions to the Electron userData dir (`%APPDATA%\Roaming\SciAgent`) instead of the process cwd; `SCI_AGENT_WORKSPACE` overrides (highest priority); dev mode unchanged (cwd)
- **Settings modal focus trap** — Tab/Shift+Tab cycle inside the open modal and focus cannot escape; the trap is removed on close
- **Chart legend keyboard access** — series toggles are real `<button>`s now (`aria-pressed`, identical styling); the series counter is no longer falsely click-styled

### Changed
- Portable lit-tool tests: the two validation tests no longer assume `literature-evidence-mcp` is installed — they verify the real invariant (a clean dedicated error with an install hint, whichever optional dependency is absent first). Found by running the suite on Linux (instabox VM), where they failed while Windows passed.
- CSS: three duplicated ≤640px media-query blocks merged into one (rendering unchanged)

## 0.10.0 — 2026-11-06

**Tools: 42 (7 core + 35 plugin) · Tests: 134 · Plugins: 8 · Skills: 3**

### Added
- **Electron installer** — `npm run dist` in `packages/desktop` builds a Windows NSIS installer via electron-builder (`packages/desktop/electron-builder.yml`): appId `com.furoxart.sciagent`, icon, `SciAgent-<version>-win-x64.exe`. Packaged layout verified (eq-layer sources via `extraResources`, root version via `extraFiles`); the packaged `SciAgent.exe` was smoke-tested. Unsigned (SmartScreen may warn).
- **`lit_bm25_rank`** — offline BM25 shortlisting of supplied abstracts by query (`rank_bm25` optional; missing package returns a clean install-hint error, never a crash). Literature group now 16 tools.
- **Accessibility pass** (web UI):
  - Settings modal: `role="dialog"`, `aria-modal`, labelled title, focus moves to the modal on open and returns to the opener on close (Esc included)
  - Icon-only buttons get `aria-label` (new session, hero toggle, session delete/rename, skill remove)
  - `#status` is now a polite live region that announces before painting
  - Session rows are keyboard-operable (`tabindex` + `role="button"` + Enter/Space)
  - Global `:focus-visible` outline, `.msg-copy` visible on keyboard focus, `prefers-reduced-motion` respected

## 0.9.0 — 2026-11-06

**Tools: 41 (7 core + 34 plugin) · Tests: 130 · Plugins: 8 · Skills: 3**

### Added
- **3 more offline literature bridge tools** (`sci-lit` now exposes 15 tools):
  - `lit_stats_check` — statistical-reporting consistency audit for structured records (p-value range, sample size, confidence-interval coherence flags)
  - `lit_doi_normalize` — DOI normalization and validation (strips doi.org/`doi:` prefixes, validates `10.<registrant>/<suffix>`)
  - `lit_pdf_provenance` — PDF page provenance: SHA-256 of PDF and page text, quote character offsets, table/figure bounding boxes
- **Agent loop hardening** (contract unchanged — same events, same message shapes):
  - Tool registry errors and invalid results become clean `{error}` observations; the loop continues
  - Abort propagates between steps and tool batches; the loop emits `{reason:'aborted'}` and returns `{aborted:true}`; unexecuted tool calls get paired error observations
  - Malformed tool calls (unknown name / invalid JSON) get clean error observations with a 3-strike bail-out (`reason:'malformed_tool_calls'`)
  - `step` events may now carry additive fields (e.g. `durationMs`); tools receive the abort `signal`
- **One-command setup scripts** — `scripts/setup.ps1` (Windows) and `scripts/setup.sh` (Linux/macOS/WSL/Git Bash): Node 20+ check, workspace install, best-effort optional pip bridges (`--skip-pip` to skip), verification counts
- **CHANGELOG.md** — this file

## 0.8.0 — 2026-11-06

**Tools: 38 (7 core + 31 plugin) · Tests: 116 · Plugins: 8 · Skills: 3**

### Added
- **6 new literature bridge tools** (`sci-lit` now exposes 12 tools):
  - `lit_fulltext` — open-access full-text reading via Europe PMC (`read_fulltext`)
  - `lit_cite_graph` — OpenAlex citation-graph traversal (`expand_citation_chain`)
  - `lit_data_code` — Crossref data/software availability links for a DOI
  - `lit_bib` — offline bibliography export: BibTeX / RIS / CSL-JSON
  - `lit_quote_text` — offline verbatim quote verification against provided text
  - `lit_evidence` — append entries to the hash-chained evidence ledger (write side of `lit_ledger`)
- **CLI `/plugins` command** — lists registered plugins with per-plugin tool counts and a total line
- **CLI `/skills` empty state** — clear hint when no skill sources are configured
- **Charts: "start at zero" checkbox** — forces the y-axis minimum to 0 for line and bar modes
- **Charts: "Download SVG" button** — serializes the rendered chart to `sciagent-chart.svg`
- **Desktop server `--workspace` / `SCI_AGENT_WORKSPACE`** — explicit workspace resolution (CLI parity); fixes `/api/csv` failing when the server was started from a different directory
- **"Verify it yourself" README section** — one-command checks for plugin/tool/skill/test counts

### Fixed
- **Critical UI bug:** duplicate `const chartType` declaration made `app.js` a SyntaxError — every UI event listener was dead (Tools/Charts/Agents views did not open). Fixed; `node --check` is now part of the workflow.

### Changed
- Version bumped to 0.8.0 across all packages; README synced with verified counts (8 plugins / 38 tools / 3 skills / 116 tests / 12 integrated repos); roadmap pruned of completed items.

## 0.7.0 — 2026-11-05

- Multi-session support shared between desktop UI and CLI (`.sci-agent-sessions/`)
- Charts view: CSV → multi-series line chart with per-series scaling; data-table view
- Agents view: task cards, GitHub skills (SKILL.md) with live loading, add/remove
- Tool search filter (multi-term: `|` OR, space AND); markdown + code rendering with copy buttons
- Model connection test in Settings; health endpoint reports version
- English localization of the whole UI and CLI output

## 0.6.0 — 2026-11-05

- Bridge tools to the user's open scientific packages: `cds1_cli`, `repocraft_cli`, `nomosguard_cli`, `eq_route`
- Reasoning-audit bridges: `sra_cli` (scientific-reasoning-auditor), `polyguard_cli` (polyglot-code-guard), `polyglot_cli` (polyglot-python, 8 languages incl. TR)
- polyglot-code-guard SKILL.md added as a default skill
- eq-layer automatic pre-message routing (intent/affect/repair) with `SCI_AGENT_EQ_DISABLE` opt-out

## 0.5.0 — 2026-10-31

- Plugin architecture: 8 built-in plugins (`sci-tools`, `sci-extra`, `sci-data`, `sci-chem`, `sci-furox`, `sci-quantum`, `sci-lit`, `sci-audit`) with per-plugin system prompts
- Literature evidence tools (`lit_search`, `lit_verify`, `lit_quote`, `lit_audit`, `lit_screen`, `lit_ledger`) on literature-evidence-mcp
- Plan verification (`plan_audit`) on plan-auditor: sealed plans, SHA-256 evidence chain, fail-closed completion gate
- quantum-reasoning protocol wired as a reasoning steering prompt

## Earlier

- Streaming chat (SSE) with stop; parallel sub-agents via `task`; edit tool with replace-all; session history; CSV stats; mock provider for tests; GitHub Actions CI.
