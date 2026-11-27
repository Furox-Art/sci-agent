# Changelog

All notable changes to SciAgent. Versions follow the root `package.json`.

## Unreleased

### Added
- English repository documentation, package descriptions, CLI messages and developer comments; English-only built-in aliases and sample data names. The previous Turkish aliases and dataset name are no longer supported.
- Dedicated local model catalog and provider selection for Ollama, LM Studio, llama.cpp, vLLM and custom loopback endpoints; optional user-requested Ollama startup, configurable inference timeout and scientific-tool integration.
- Public-release preparation: symlink/hardlink/special-file guards, expanded local ignore rules, configuration prototype-key rejection, pinned least-privilege CI and security/privacy/third-party documentation. Account acceptance and historical image cleanup remain maintainer checks.
- Renamed the scientific Python stack tool to `scientific_compute` (no change to its execution behavior or library support).
- Optional free local Linux/WSL2 Bubblewrap process sandbox for shell, Python and scientific computations. Read-only workspace, private temporary storage, isolated networking, cleared credentials, resource limits and fail-closed startup; unsafe external CLI bridges are unavailable in this mode. This is not an application-wide sandbox. Real Linux isolation regression coverage.
- Separate interactive native-agent entries for unmodified Claude Code and Google Antigravity. Claude uses the official local terminal; Antigravity uses the official ACP v1 SDK, agent-advertised model selection, one-time permission review and turn cancellation. No subscription-token extraction, headless model bridge or automatic scientific-evidence certification in these sessions.
- Native-agent regression tests and real unauthenticated Antigravity ACP initialization smoke check.
- Optional GitHub Copilot account integration using the official Microsoft Copilot SDK and stored CLI sign-in, isolated tool-free SDK sessions, explicit account/model checks and a validated SciAgent tool-request bridge.
- OpenRouter official headless OAuth PKCE account connection, encrypted local key storage, credit-limit/expiration prefill, model selection and key-status inspection; provider selection menu. Live authenticated model requests remain untested.
- Opt-in local CLI Sign in with ChatGPT using the documented authorization-code/PKCE flow, OIDC signature verification, separate account registrations, encrypted local credential vault, refresh, sign-out and account-specific model discovery.
- ChatGPT plan Responses adapter with explicit completed-stream validation and local function-tool mapping; API-key and local providers unchanged. Live entitlement and cross-platform browser acceptance remain untested.
- Natural-language scientific claim extraction and pairwise model-assisted NLI with exact source quotations, offsets, content hashes, modality and context abstention.
- Candidate causal DAG audit with observational partial-correlation/Fisher-z tests, Holm adjustment, temporal constraints and adjustment-set robustness.
- Independent numerical replay for matrix multiplication/inverse, basic arithmetic, canonical unit conversions and direct covariance propagation.
- Fourteen regression tests for extraction provenance, model abstention, causal model compatibility, replay integrity and actual agent-loop integration.
- Eight research-methodology tools: causal DAG/backdoor analysis, reproducible experimental allocation and approximate power planning, covariance-aware uncertainty propagation, independent numerical replay, controlled semantic contradiction detection, persistent local research memory, actual pinned Lesson-gate integration, and intent-based tool routing.
- CLI `/memory` and `/lesson` inspection; optional memory auto-save and fail-closed lesson preflight; reproduction mismatch prevents release of linked claims.
- SHA-256 memory verification, scientific-notation grounding, and regression tests for the new methodology tools.
- Run-local claim/evidence graph with explicit references, source output hashes, failure/truncation filtering, and withholding of unsupported final text.
- Hypothesis state machine with optional predeclared deterministic compute criteria and conflicting findings retained.
- Distinct configured reviewer and verifier providers, structured evidence-linked verdicts, optional strict consensus gate, and CLI `/research` inspection.
- Regression tests for unrelated, missing, failed and nonmatching evidence, hypothesis state, and reviewer agreement/disagreement.

### Removed
- Desktop/Electron application, local web server, UI assets, desktop-only tests and helper scripts. CLI, scientific core, session format and example datasets remain.

## 0.10.7 — 2026-11-09

### Added
- **Deterministic grounding gate ("no fabrication")** — the no-fabrication rule is no longer prompt-only: `runAgentLoop` now checks every final answer. If a run executed **zero tools** and the answer still contains a verifiable claim (p-values, n=, measurement with a unit, `x = <number>`, DOI/`et al.`/PMID/arXiv), it emits a `warning` event, retries once with a verification instruction in that turn's system prompt, and — if the model still answers without a tool — returns `unverified: true` with `unverifiedClaims`; CLI and desktop show the warning in red. Disable with `runAgentLoop({ grounding: false })`. `findUngroundedClaims()` is exported (+6 tests)
- **Two more default skills** — `github:Furox-Art/axiomize/skills/axiomize` and `github:Furox-Art/scientific-computing-system-2.0` are now in `DEFAULT_CONFIG.skills.sources` (9 total); the example config matches and a test now locks config/example parity (+1 test)

### Fixed
- **Linux/macOS console scripts** — `pythonScriptsDir()` now also resolves POSIX `bin/`, and `findPythonScript()` probes `<name>` (unix) or `<name>.exe` (Windows), so `axiomize`, `cds2`, `plan-auditor`, `eq-layer` and friends are found in Debian/Ubuntu venvs instead of falling back to `python -m`; hyphenated modules fall back to `python -m polyglot_python` instead of an invalid `polyglot-python` (+tests updated)
- **Child-process leak / 60 s hang (Linux CI)** — `sci-lit`, `sci-lit-extra`, `sci-furox`, `sci-audit`, `sci-tools` and `run_command` no longer pass spawn's `timeout` option; each bridge now owns its timer, kills the child, destroys stdio pipes and clears the timer on every exit path, so a failed spawn (`ENOENT`/`EACCES`) cannot keep the Node event loop alive. The two "no interpreter" tests now pass an empty `PATH` so Linux no longer falls back to `/usr/bin/python3` (+4 CI tests green)
- **Lockfile drift** — `package-lock.json` was stuck at 0.9.0 while the packages were 0.10.6

### Documentation
- README: skills 7 → 9 (with the two new sources), test count 134 → 180, new grounding-gate section; `sci-agent.config.example.json` synced (was 3 skills vs 7 in the defaults)

### Tests
- +7 tests: **180 total, 0 fail** on Windows (no skips)
- Linux verification on the `instabox` Debian box (Node 22, Python 3.13): **160 pass, 0 fail, 20 skipped** — the 20 skips are the live `literature-evidence-mcp` tests (package not installed there); the 4 tests that used to hang/fail on Linux CI now pass, and the whole suite runs in ~3 s (previously two tests waited out a 60 s spawn timeout)

## 0.10.6 — 2026-11-07

### Added
- **Bounded parallel tool execution** — when the model emits many tool calls in one turn they now run through a worker pool (max 4 concurrent, optional `maxConcurrent` loop option) instead of all-at-once; results stay paired to the correct `tool_call_id`, events stream as they complete, and abort/malformed handling extends to the parallel branch (+4 tests)
- **Faithful chat Export** — the exported markdown now includes the session title as heading, tool calls as fenced blocks with dynamic fence length, results mapped to their tool names with ` (failed)` markers, 2000-char truncation notes, and a timestamp footer; long unbroken strings no longer overflow chat bubbles (`overflow-wrap`)

### Tests
- +4 tests: **173 total, 0 fail**

## 0.10.5 — 2026-11-07

### Fixed
- **Honest error attribution in the literature bridges** — a Python-start failure (broken venv, permissions, missing interpreter) was mislabeled as "could not reach the literature provider"; both drivers now emit a dedicated message (`the Python interpreter could not be started (<reason>). Set SCI_AGENT_PYTHON …`), and the network wording is reserved for real outbound failures (+5 simulation tests)
- **CLI `/skills add`** — no-argument usage guidance (previously went to the model), `busy` guard while fetching (fast `/exit` no longer swallows the result), 20 s hard timeout, error lines match the `/skills` format
- **UI: toast on mobile** — on ≤640 px the toast anchors above the input bar instead of colliding with the wrapped header

### Tests
- +7 tests: **169 total, 0 fail**

## 0.10.4 — 2026-11-07

### Fixed
- **Linux/macOS Python resolution** — bare interpreter names are now probed with a real spawn before being trusted; Debian/Ubuntu (no `python` alias, only `python3`) previously failed every Python bridge with `spawn python ENOENT`, misreported as a network error (found by running the suite on an Ubuntu VM)
- **CLI `/test`** — 15 s timeout with a clear timeout message (previously hung forever against a silent model server); the result line no longer gets swallowed by a fast `/exit`
- **CLI `/sessions del`** — the delete was silently dropped (async import raced EOF) and the deleted session's title haunted the next save; now synchronous with a title reset
- **CLI** — a command error no longer crashes the whole REPL (top-level catch + prompt continues)

### Added
- **UI: failed tool results are visible** — red left border + a real-text "failed" chip next to the tool name (detection covers `Error:` strings and JSON `{error}` shapes, including history replay); successful blocks unchanged

### Tests
- +7 tests (CLI timeouts/delete/crash-guard, skill truncation boundaries, example CSVs): **162 total, 0 fail**

## 0.10.3 — 2026-11-06

### Added
- **4 more default skills** (7 total, all verified to load via `fetchSkill`): `plan-auditor` (sealed-plan verification workflow), `nomosguard` (fail-closed security reasoning), `literature-evidence-mcp` (verifiable literature evidence usage), `scientific-computing-system` (dependency-free scientific computation guidance) — all from the user's public repos, on top of the existing 3
- **Scientific example CSVs** — `examples/kinetics.csv` (first-order decay: C(t) + ln[C], k = 0.035/min) and `examples/titration.csv` (weak-acid titration sigmoid, equivalence at 12.5 mL), with `/api/csv` tests; x-axis columns are text labels so the Charts view plots the curves against time/volume
- **Skill prompt budget locked by tests** — measured 7-skill system text (~34k chars, ~8.6k tokens); per-skill 6000-char cap keeps names + descriptions always intact (5 bodies full, 2 at 85%/68% retention)
- **CLI `/tools [filter]`** and a dynamic version banner; README screenshots refreshed from the current UI

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
