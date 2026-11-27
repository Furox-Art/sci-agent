<div align="center">
  <img src="https://raw.githubusercontent.com/Furox-Art/Sci-Agent/main/docs/assets/logo.png" alt="Sci-Agent - scientific research and coding agent" width="560" />
</div>

# Sci-Agent

A model-agnostic scientific research and coding agent for the terminal. Sci-Agent combines a tool-driven agent loop with hypothesis tracking, evidence-linked claims, scientific computation, literature retrieval, independent numerical replay and persistent research records.

[![npm version](https://img.shields.io/npm/v/sci-agent.svg)](https://www.npmjs.com/package/sci-agent)
[![npm downloads](https://img.shields.io/npm/dm/sci-agent.svg)](https://www.npmjs.com/package/sci-agent)
[![tests](https://github.com/Furox-Art/Sci-Agent/actions/workflows/test.yml/badge.svg)](https://github.com/Furox-Art/Sci-Agent/actions/workflows/test.yml)
[![license](https://img.shields.io/badge/license-MIT%20OR%20Apache--2.0-blue.svg)](LICENSE-MIT)

**CLI only.** No desktop application, hosted service or separate Sci-Agent subscription is required. Model access, optional scientific packages and local computing resources are supplied by the user.

## Package

Install from npm - version **0.10.8**:

```bash
npm install -g sci-agent
sci-agent --version
```

See [sci-agent on npm](https://www.npmjs.com/package/sci-agent). The package bundles its runtime dependencies, so no separate `npm install` is needed after installation.

## Releasing

To publish a new version, update `package.json`, commit it, and create a GitHub release tagged `v<version>` (for example `v0.10.9`). The `publish-npm.yml` workflow verifies that the tag matches the package version, runs the test suite, builds the tarball and publishes it to npm with provenance via OIDC trusted publishing. No npm token is stored in the repository.

## Quick start

Requires Node.js 20 or newer (Node 22+ recommended). Python 3.11+ is needed for optional scientific bridges and Lesson-gate. The optional Copilot SDK requires a compatible platform and Node 20.19+ or 22.12+.

```bash
npm install -g sci-agent
sci-agent --provider-menu
```

To work from the source repository instead:

```bash
git clone https://github.com/Furox-Art/Sci-Agent.git
cd Sci-Agent
npm ci
npm run cli -- --provider-menu
```

For a scripted demonstration without a model account:

```bash
SCI_AGENT_PROVIDER=mock sci-agent --prompt "List the project files"
```

Optional setup scripts: `bash scripts/setup.sh` or `powershell -File scripts/setup.ps1`. Review installation commands and package provenance first.

## Architecture

```
sci-agent/
├── packages/
│   ├── core/        # Provider adapters, tools, approval policy, research state and agent loop
│   └── cli/         # Terminal interface and local account/runtime selection
├── examples/        # Sample CSV datasets
└── test/            # Automated Node.js regression tests
```

- **Model-independent:** OpenAI-compatible APIs and local servers, with optional account adapters.
- **Agent loop:** model → tool calls → observations → model, with a bounded step count.
- **Parallel sub-agents:** bounded concurrent execution; fresh contexts; no recursive task creation.
- **Scientific plugins:** eight built-in tool/prompt bundles and nine configured skill sources.
- **Streaming:** text and reasoning events where supported; final grounded text is checked before release.
- **Approval policy:** risky operations such as file changes and arbitrary code execution require approval by default.
- **Workspace guards:** reject path traversal, symbolic links, hardlinked regular files and special files. These checks are not an operating-system security boundary.

## Model and account selection

```bash
sci-agent --provider-menu
```

| Option | Integration | Access |
|---|---|---|
| ChatGPT | Documented Sign in with ChatGPT flow | Eligible user's own plan |
| GitHub Copilot | Official Copilot SDK | Eligible signed-in user's account |
| OpenRouter | OAuth PKCE | User's own credits |
| Existing configuration | OpenAI-compatible API | API key or local endpoint |
| Claude Code | Official local CLI | Separate native agent |
| Gemini / Antigravity | Official ACP client | Separate native agent |
| Ollama | Local server | User's hardware |
| LM Studio | Local server | User's hardware |
| llama.cpp | Local server | User's hardware |
| vLLM | Local server | User's hardware |

Account integrations are experimental. Authenticated live inference has not been acceptance-tested for the account adapters. Provider access, model availability, quotas, charges and distribution eligibility remain subject to provider terms. No endorsement, partnership or unlimited account access is implied.

### OpenAI-compatible API configuration

Copy `sci-agent.config.example.json` to `sci-agent.config.json` and edit the model settings, or use environment variables:

```bash
SCI_AGENT_BASE_URL=http://127.0.0.1:8000/v1 SCI_AGENT_MODEL=my-model sci-agent
```

Set `SCI_AGENT_API_KEY` if the endpoint requires a key. `SCI_AGENT_PROVIDER=mock` selects the scripted demonstration provider. `SCI_AGENT_WORKSPACE` overrides the configured workspace. Do not commit real credentials.

### Local AI models

Sci-Agent connects to local inference servers; the server, not Sci-Agent, loads the model weights. Install the runtime and download a tool-capable model yourself. Model licensing, quantization, GPU/CPU allocation and context length remain under user control.

```bash
sci-agent local models --local ollama
sci-agent local status --local ollama
sci-agent --local ollama
sci-agent --local ollama --local-start --local-model qwen3:32b
sci-agent --local lmstudio
sci-agent --local llamacpp
sci-agent --local vllm
sci-agent --local custom --local-url http://127.0.0.1:9000/v1
```

`qwen3:32b` is an example of a model that must already be installed. Specify `--local-model` for direct selection or non-interactive prompts. `--local-timeout 900` extends the request timeout (1–3600 seconds; default 600). `--workspace` and `--sandbox` are supported.

| Runtime | Default endpoint |
|---|---|
| [Ollama](https://docs.ollama.com/api/openai-compatibility) | http://127.0.0.1:11434/v1 |
| [LM Studio](https://lmstudio.ai/docs/developer/core/server) | http://127.0.0.1:1234/v1 |
| [llama.cpp](https://github.com/ggml-org/llama.cpp) | http://127.0.0.1:8080/v1 |
| [vLLM](https://docs.vllm.ai/) | http://127.0.0.1:8000/v1 |

Ollama discovery displays available parameter count, quantization and on-disk size metadata. Known cloud models and remote-model metadata are rejected; models explicitly lacking tool support are unavailable. Other runtimes must expose the OpenAI-compatible model catalog and tool-call protocol. Catalog availability does not prove tool-call quality.

`--local-start` explicitly starts an installed Ollama server when needed, requests cloud mode to be disabled, binds to loopback and stops only the process Sci-Agent started on exit. It does not install software, download models or stop a previously running service.

Local mode accepts loopback HTTP endpoints and rejects redirects. Set `SCI_AGENT_LOCAL_API_KEY` if required; cloud API credentials are not forwarded automatically. A loopback endpoint alone does not prove that the server never forwards requests. Literature tools and configured independent reviewers may use networks separately.

Large-model feasibility depends on RAM, VRAM, quantization and context length. On-disk size is not runtime memory usage. There is no guarantee that a model exceeding the user's hardware capacity will run. Local inference consumes the user's hardware and electricity. HTTP/tool-loop integration has been tested with a fixture server, not with real large-model weights.

### Sign in with ChatGPT

Use the documented [Sign in with ChatGPT](https://developers.openai.com/siwc/quickstart) flow on your own eligible account and device. No API key is needed for an eligible plan connection. Check the [terms](https://openai.com/policies/sign-in-with-chatgpt-terms/) before use or distribution; paid or hosted distribution may require additional access or approval.

```bash
sci-agent --chatgpt
sci-agent auth login
sci-agent auth status
sci-agent auth switch
sci-agent auth models
sci-agent auth logout
sci-agent auth usage
```

On first use, create a password for the local vault (not your ChatGPT password), open the provider's authorization page, consent and select an available model. The integration is interactive only; unattended `--prompt` requests are rejected. Accounts are explicitly selected, not rotated to evade usage limits.

The adapter uses authorization code + PKCE S256, random state/nonce, a short-lived loopback callback and OIDC issuer/audience/expiration/nonce/signature checks. It requires granted plan scopes. The password-encrypted vault at `~/.sci-agent-auth/chatgpt.enc` uses scrypt and AES-256-GCM. It is not an OS keychain. Keep the vault password safe. After a crash, remove a stale `active.lock` only after verifying that no Sci-Agent process is using it. Logout attempts remote refresh-token revocation and removes local tokens; failure to verify revocation is disclosed.

Inference is restricted to the documented OpenAI models and Responses endpoints. The Responses adapter uses `store:false`, streaming and completed-response validation; incomplete responses cannot trigger tools. This does not guarantee provider-wide zero retention. Requests include prompts and relevant tool results. Connected account modes do not automatically load or save Sci-Agent chat history; explicit exports and research-memory settings still apply. Risky tools retain approval requirements. Synthetic OAuth/JWT and Responses tests pass; real-account acceptance, OS-specific browser handling and distribution eligibility remain to be verified.

### GitHub Copilot

The optional [official SDK](https://github.com/microsoft/copilot-sdk) (`@microsoft/copilot-sdk` 2.0.3) uses a signed-in user of the official Copilot CLI. Install and authenticate using the [official instructions](https://docs.github.com/en/copilot/how-tos/copilot-cli/set-up-copilot-cli/authenticate-copilot-cli).

```bash
sci-agent auth copilot login
sci-agent --copilot
sci-agent auth copilot status
sci-agent auth copilot models
sci-agent auth copilot switch
sci-agent auth copilot logout
sci-agent auth copilot usage
```

On Windows, run `copilot login` directly in the terminal. Sci-Agent does not extract or store GitHub tokens. Only stored GitHub.com user authentication and catalog models explicitly attributed to Copilot are accepted; environment-token, gh CLI and BYOK authentication are not accepted.

The SDK uses an empty isolated working directory, with its native tools, repository config discovery, hooks and skills disabled. A validated JSON bridge requests Sci-Agent tools; the normal registry and evidence gate execute and check them. Nonconforming tool requests fail closed. SDK sessions are disconnected and deleted after each inference call; this is not a guarantee of service-wide retention behavior. For account switching or logout, use the official CLI's `/user switch` or `/logout`; revoke authorization separately in GitHub settings if needed. Actual SDK startup and unauthenticated rejection have been tested on Linux, but authenticated inference has not.

### OpenRouter

The [official headless OAuth PKCE flow](https://openrouter.ai/docs/guides/overview/auth/oauth) exchanges the one-time authorization code for a user-owned API key. Charges use your OpenRouter credits, not an unlimited subscription.

```bash
sci-agent --openrouter
sci-agent auth openrouter login
sci-agent auth openrouter status
sci-agent auth openrouter models
sci-agent auth openrouter logout
sci-agent auth openrouter usage
```

Prefill a key spending limit in USD and review the final limit and expiration (default 30 days) at the provider's consent page. The model catalog is filtered for advertised tool support. The key is stored in the existing encrypted local vault, not in project settings. Logout removes the local key; revoke the remote key using the displayed provider link. Reconnecting does not revoke an older key automatically. HTTP tests use synthetic responses. Real-account billing, login and inference acceptance remain untested.

### Claude Code and Gemini / Antigravity

These are **separate native agent sessions**, not model backends for Sci-Agent's scientific core. Their own tools, permissions, account settings and data-retention policies apply. Their output is not certified by Sci-Agent's evidence gate.

Install [Claude Code](https://code.claude.com/docs/en/setup) and use its unchanged official executable:

```bash
sci-agent auth claude login
sci-agent auth claude status
sci-agent --claude --workspace /path/to/project
sci-agent auth claude logout
sci-agent auth claude usage
```

Model selection and account management remain in Claude Code's terminal. Sci-Agent does not extract subscription tokens, replace authentication or proxy Claude.ai access. Review [Anthropic's legal and compliance guidance](https://code.claude.com/docs/en/legal-and-compliance) before distribution or commercial embedding.

Install [Antigravity CLI with ACP support](https://antigravity.google/docs/cli/acp):

```bash
sci-agent auth gemini login
sci-agent --gemini --workspace /path/to/project
sci-agent auth gemini version
sci-agent auth gemini status
sci-agent auth gemini logout
sci-agent auth gemini native
sci-agent auth gemini usage
```

Sci-Agent starts unchanged `agy acp` and speaks ACP v1 over stdio with the official SDK (2.12.0). User prompts are interactive. `/model` selects a model when advertised by the agent; `/exit` closes the session. Ctrl+C cancels a turn; a second Ctrl+C closes the connection. Account status/logout are handled by the official agent; the Sci-Agent status command is guidance, not an OAuth status query.

Client filesystem, terminal and MCP capabilities are not advertised. Concrete permission requests for the active session and turn may receive an explicit one-time grant, never an automatic permanent grant. This does not override the native agent's own previously configured permissions or provide an OS sandbox. Google documents ACP clients but restricts third-party inference-backend use; see its [FAQ](https://antigravity.google/docs/faq). Both native modes remain separate from unattended inference and sub-agent workflows.

Linux checks identified Claude Code 2.1.332 and Antigravity CLI 1.5.11; the real unauthenticated ACP initialization succeeded. Synthetic sessions test permission denial, model selection, cancellation and protocol mismatch. Real login/inference and Windows/macOS acceptance remain unverified.

## Optional free local execution sandbox

Linux Bubblewrap isolates selected generated-code subprocesses on your own hardware. No cloud sandbox or separate subscription is needed. Model-provider charges are unaffected.

```bash
# Debian/Ubuntu, including suitable WSL2 installations
sudo apt install bubblewrap util-linux python3
sci-agent --sandbox --workspace /path/to/project
```

The mode is off by default. Set `agent.sandbox.enabled: true` in the project configuration for persistent use. It requires an unprivileged user, performs a real startup probe and fails closed if unavailable. Use `/sandbox` to inspect status.

- `run_command`, `python_eval` and `scientific_compute` execute with isolated Linux namespaces, cleared environment, read-only `/workspace`, private 64 MiB temporary storage and isolated networking.
- System shell and `/usr/bin/python3` are used; user-home virtual environments are not mounted. Temporary output is discarded. Persistent file edits use the separate approved file tools.
- Time, output, code size and per-process resource limits apply; they are not aggregate cgroup guarantees.
- External CLI bridges, `plan_audit` and `eq_route` are unavailable in this mode. The normal registry has 53 tools; sandbox mode has 43.
- **Not an application-wide sandbox:** other tools, provider requests, file edits, Lesson-gate and authentication remain outside the subprocess boundary. Native Claude Code and Antigravity sessions are separate. Use a trusted, limited workspace; do not mount secrets, special files or untrusted nested filesystems.

Real Linux isolation tests cover host-file visibility, read-only project access, environment separation, host-loopback isolation, temporary files, cancellation and limits. Native Windows/macOS backends and real WSL2 acceptance have not been tested. See [SECURITY.md](SECURITY.md).

## CLI reference

```bash
sci-agent --help
sci-agent
sci-agent --prompt "Your research task"
sci-agent --workspace /path/to/project
npm test
```

| Command | Purpose |
|---|---|
| `/help` | List commands |
| `/model` | Show model configuration |
| `/tools [filter]` | List or filter tools; spaces are AND, pipes are OR |
| `/plugins` | List plugins |
| `/skills` | Inspect configured skills |
| `/skills add github:owner/repository` | Add a skill source |
| `/sessions` | List sessions |
| `/sessions <number>` | Switch session |
| `/sessions del <number>` | Delete session |
| `/sessions ren <number> <title>` | Rename session |
| `/research` | Inspect the latest research state |
| `/memory save [label]` | Persist the latest research record |
| `/memory search [query]` | Search saved research records |
| `/memory get <id>` | Retrieve a record by hash ID |
| `/lesson stats`, `/lesson preflight`, `/lesson export` | Inspect Lesson-gate records |
| `/sandbox` | Inspect local execution isolation |
| `/save` | Export conversation as Markdown |
| `/test` | Test the model connection |
| `/clear` | Clear current conversation |
| `/exit` | Exit |

Normal session history is stored in `.sci-agent-sessions/`. Connected account and dedicated local-provider modes use separate ephemeral conversation history.

### Example datasets

| File | Description |
|---|---|
| `examples/weather.csv` | Monthly temperature, humidity and pressure data |
| `examples/kinetics.csv` | First-order reaction: concentration and ln concentration |
| `examples/titration.csv` | Weak-acid titration (0.010 M acetic acid) |

## Tool catalog

The default registry contains **53 tools** (18 core and 35 plugin tools) in seven groups. Approval requirements below are defaults and can be changed through the policy configuration. Sub-agent calls still require approval for their risky operations.

| Tool | Approval | Purpose |
|---|---|---|
| `read_file` | No | Read workspace text |
| `list_dir` | No | List a directory |
| `search_files` | No | Search names and content |
| `write_file` | Yes | Create or overwrite files |
| `edit_file` | Yes | Edit matching text |
| `run_command` | Yes | Run shell commands |
| `task` | No* | Run a fresh-context sub-agent |
| `research_hypothesis` | No | Register and assess hypotheses |
| `research_causal` | No | DAG backdoor and adjustment-set analysis |
| `research_causal_audit` | No | Candidate DAG compatibility and robustness |
| `research_experiment` | No | Seeded allocation and approximate power planning |
| `research_uncertainty` | No | Covariance-aware first-order propagation |
| `research_reproduce` | No | Independent numerical replay |
| `research_conflicts` | No | Structured contradiction candidates |
| `research_semantic` | No | Quote-linked extraction and model-assisted NLI |
| `research_memory` | Yes | Save, search and retrieve persistent records |
| `research_lesson` | Yes | Inspect or add Lesson-gate records |
| `research_route` | No | Rank tools by intent |
| `python_eval` | Yes | Execute Python |
| `csv_stats` | No | CSV descriptive statistics |
| `math_eval` | No | Parsed arithmetic without eval |
| `unit_convert` | No | Unit conversions |
| `physical_constants` | No | CODATA physical constants |
| `stats_calc` | No | Descriptive statistics, correlation and regression |
| `matrix_ops` | No | Determinant, inverse and multiplication |
| `molar_mass` | No | Formula-based molar mass for 118 elements |
| `scientific_compute` | Yes | Python scientific stack |
| `axiomize_cli` | Yes | Modeling, dimensions, calibration and export |
| `cds2_cli` | Yes | Numerical linear algebra, ODE/PDE, simulation |
| `lit_search` | No | OpenAlex, Europe PMC and Crossref search |
| `lit_verify` | No | Citation and retraction checks |
| `lit_quote` | No | Full-text quote matching |
| `lit_audit` | No | Reporting and methodology audit |
| `lit_screen` | No | Preliminary PRISMA-style screening |
| `lit_ledger` | No | Verify hash-chained JSONL evidence |
| `lit_fulltext` | No | Open-access full-text retrieval |
| `lit_cite_graph` | No | Citation graph traversal |
| `lit_data_code` | No | Data and software links |
| `lit_bib` | No | BibTeX, RIS and CSL-JSON export |
| `lit_quote_text` | No | Quote verification in supplied text |
| `lit_evidence` | No | Append evidence ledger entry |
| `lit_stats_check` | No | Statistical reporting consistency |
| `lit_doi_normalize` | No | Normalize and validate DOI |
| `lit_pdf_provenance` | No | PDF page/quote provenance |
| `lit_bm25_rank` | No | Rank supplied abstracts by BM25 |
| `plan_audit` | Yes | Sealed plan and completion audit |
| `cds1_cli` | Yes | Scientific computing v1 |
| `repocraft_cli` | Yes | Deterministic project scaffolding |
| `nomosguard_cli` | Yes | Evidence ledger and policy gate |
| `sra_cli` | Yes | Scientific reasoning audit |
| `polyguard_cli` | Yes | Fail-closed code verification |
| `polyglot_cli` | Yes | Multilingual Python transpilation |
| `eq_route` | No | Intent and response routing |

*The registry groups these as File & code, AI agents, Scientific computation, Scientific package bridges, Literature (evidence chain), Plan verification and Research methodology.*

## Scientific research protocol

### Evidence and hypotheses

Eligible successful tool results are recorded with tool arguments, run-local evidence IDs and SHA-256 output hashes. Detected numeric, statistical and literature claims require matching evidence from the current run. For example, `determinant = 4.000000000 [E1]` passes only if E1 contains the matching output. Use `CLAIM: exact source passage [E1]` to explicitly check a qualitative claim. Failed, truncated and unrelated tool outputs are not substitutes for evidence.

After a failed final check, the agent requests one correction. A second failure withholds final text and returns `done: false, unverified: true`. Tool events continue during the run. Programmatic callers can disable grounding with `grounding: false`. The check is bounded by its claim detector and exact matching; undetected claims, scientific interpretation and semantic entailment are not guaranteed.

`research_hypothesis` supports `add` with an ID, statement, prediction and falsifier. Optional predeclared test fields are `tool, args, support, refute`; matching successful compute calls made after registration can update the hypothesis. Manual `assess` takes `id, evidenceId, quote, direction, rationale` (supports/refutes). The `list` action exposes active, supported_candidate, refuted_candidate and contested states. Conflicting evidence is retained; these statuses are candidates, not scientific proof.

### Independent review

`task` supports researcher, reviewer and verifier roles. Configure distinct model names and endpoints for reviewer and verifier:

```json
{
  "agent": {
    "requireIndependentReview": true,
    "roleModels": {
      "reviewer": {
        "name": "review-model",
        "baseUrl": "http://localhost:8001/v1",
        "stream": false
      },
      "verifier": {
        "name": "verify-model",
        "baseUrl": "http://localhost:8002/v1",
        "stream": false
      }
    }
  }
}
```

Roles produce structured support/reject/unresolved judgments with their own evidence. Strict review is opt-in and requires both distinct roles to support detected claims; rejection remains contested. Distinct configured names do not prove independent model weights. Role endpoints receive the relevant research context and are called only when configured and requested.

### Research methods

Outputs appear in the latest `/research` record under `analyses`. Persistent memory and Lesson-gate use separate stores.

| Method | Inputs and results | Limitations |
|---|---|---|
| Causal analysis | nodes, edges, treatment, outcome, observed, adjustment; DAG validation, d-separation and minimal adjustment sets | Conditional on supplied graph; no causal discovery or effect estimation; supply adjustment when more than 12 candidates |
| Experimental design | arms, participants, seed, outcome, hypothesis, controls, analysisPlan; balanced allocation and optional standardizedEffect/alpha/power | Approximate two-arm normal calculation; independent continuous outcomes/common variance; plan blinding, concealment, attrition, ethics and preregistration separately |
| Uncertainty | estimate, unit, gradient, standardUncertainties, correlation, coverageFactor; PSD check and linear propagation | First-order approximation; coverage factor is not a guaranteed confidence level |
| Replay | evidenceId; independent numerical algorithm and comparison | No general Python/shell, mutable file or physical experiment replay |
| Conflicts | assertions with subject, relation, object, context, negation, evidence ID, exact quote and optional unit interval | Rule-based candidate detection; interpretation requires scientific review |
| Routing | Ranked tools with optional first-step shortlist | Unknown requests and later steps use full catalog; approval policy unchanged |

Structured conflicts compare normalized subject/object/context, relation direction, negation and disjoint intervals. Supported relation aliases are English; canonical units include g/kg/mg, m/cm/mm, s/min/h and fraction/%.

#### Natural-language semantic analysis

`research_semantic` accepts current-turn full-text `evidenceIds` and/or supplied `texts` (label/text), up to six sources and 48,000 characters. It uses the current model in two tool-free calls: extract at most 12 claims, then compare every pair. Exact quotes, source IDs, offsets, hashes and output schema are checked. Source instructions are treated as data. Relations include contradiction, equivalence, entailment, compatibility, incomparability and uncertainty; differing context and uncertain/hypothetical modality trigger abstention. Supplied passages are marked `supplied_text_not_verified`, not promoted to evidence.

A matching quotation does not establish faithful interpretation. Two calls to the same model are not independent models. No detected contradiction does not establish consistency. Actual performance depends on the selected model.

#### Independent numerical replay

`research_reproduce` checks the source output hash and compares independent calculations:

| Original operation | Replay method |
|---|---|
| Determinant (up to 7×7) | Laplace/cofactor expansion |
| Matrix inverse (up to 7×7) | Adjugate/cofactors |
| Matrix multiplication (up to 10×10) | Outer-product accumulation |
| Descriptive statistics | Welford variance and sorted median |
| Basic arithmetic | Operator stack with signs, parentheses and scientific notation |
| Unit conversion | Direct ratios or affine temperature conversion |
| Uncertainty propagation | Direct quadratic covariance form |

Fixed tolerances and rounding rules are applied. A mismatch blocks linked claims. Unsupported operations return `unsupported`. General Python programs, changing files, transcendental functions and physical experiments are not replayed automatically. Independent numerical algorithms are not independent datasets or experimental replications.

#### Candidate causal model audit

`research_causal_audit` accepts nodes, treatment, outcome, candidate models with IDs and edges, and complete numeric data rows. Optional observed, alpha, adjustment and temporalOrder constrain the audit. Limits: 20 nodes, eight DAGs, 10–5000 rows and 200 unique tests.

Local Markov conditional-independence predictions are tested with partial Pearson correlation and asymptotic Fisher-z tests, with Holm correction over unique tests. Latent parents, constant or collinear variables and insufficient degrees of freedom are marked untestable. Temporal-order violations are reported. Candidate statuses are incompatible_with_assumptions, not_rejected and untestable; adjustment validity is compared across non-rejected candidates. Assumptions include independent observations and linear/Gaussian conditional-independence testing. Markov equivalence, unmeasured confounding, measurement errors, selection bias and nonlinear dependence remain unresolved.

#### Research memory and Lesson-gate

`.sci-agent-research/memory/` holds content-addressed JSON records with integrity checks. Saved records are historical evidence, not current-turn evidence. Saving through a tool requires approval; automatic saving is disabled by default. Records may contain sensitive plaintext arguments and outputs; keep them outside public version control.

Lesson-gate 0.1.0 is vendored from [Furox-Art/lesson-gate](https://github.com/Furox-Art/lesson-gate), commit `d947fa8d6b71fe19f11b493d885cf65958a2d6a5`, with its MIT license. When enabled, preflight checks relevant open/promoted lessons before inference and final release. Unresolved debt or errors block completion. Unverified final claims create a generic lesson without user content.

```bash
python packages/core/src/science/vendor/lesson-gate/lesson_gate.py stats --store .sci-agent-research/lessons --json
python packages/core/src/science/vendor/lesson-gate/lesson_gate.py --help
```

The model cannot run arbitrary Lesson-gate fixture commands through its lesson tool. Review upstream promote/verify commands and fixtures before execution. Reverify after code changes; an old proof does not establish current behavior. Check that a negative fixture fails for the intended regression, not an unrelated error.

```json
{
  "agent": {
    "researchMemory": { "autoSave": true },
    "lessonGate": { "enabled": true },
    "toolRouting": { "enabled": true, "shortlist": false }
  }
}
```

Memory autosave, Lesson-gate enforcement and shortlist mode default to off. Tool ranking defaults to on. The scientific checks do not guarantee scientific truth; Python and shell outputs and bibliographic query echoes alone are not eligible verified evidence.

## Scientific plugins and skill sources

The eight built-in plugins are `sci-tools`, `sci-extra`, `sci-data`, `sci-chem`, `sci-furox`, `sci-quantum`, `sci-lit` and `sci-audit`. These identifiers remain stable for compatibility.

| Integration | Purpose |
|---|---|
| [axiomize](https://github.com/Furox-Art/axiomize) | Modeling, units, uncertainty and export |
| [scientific-computing-system-2.0](https://github.com/Furox-Art/scientific-computing-system-2.0) | Numerical scientific stack |
| [quantum-reasoning-skill](https://github.com/Furox-Art/quantum-reasoning-skill) | Alternative hypothesis and reasoning protocol |
| [literature-evidence-mcp](https://github.com/Furox-Art/literature-evidence-mcp) | Literature and evidence bridges |
| [plan-auditor](https://github.com/Furox-Art/plan-auditor) | Plan verification |
| [scientific-computing-system](https://github.com/Furox-Art/scientific-computing-system) | Computing v1 |
| [scientific-reasoning-auditor](https://github.com/Furox-Art/scientific-reasoning-auditor) | Scientific paper reasoning audit |
| [polyglot-code-guard](https://github.com/Furox-Art/polyglot-code-guard) | Code verification |
| [polyglot-python](https://github.com/Furox-Art/polyglot-python) | Multilingual transpiler |
| [repocraft](https://github.com/Furox-Art/deterministic-recipe-scaffolder) | Project scaffolding |
| [nomosguard](https://github.com/Furox-Art/evidence-ledger-policy-gate) | Evidence-backed safety policy |
| [eq-layer](https://github.com/Furox-Art/eq-layer) | Optional pre-inference routing |

Optional Python installation (prefer a dedicated virtual environment; review dependencies first):

```bash
pip install numpy scipy pandas axiomize scientific-computing-system scientific-computing-system-2.0 literature-evidence-mcp plan-auditor polyglot-code-guard polyglot-python scientific-reasoning-auditor repocraft nomosguard "eq-layer[ml]"
```

The Python bridge resolves installed interpreters and console scripts. Unavailable optional packages limit their associated tools. Eq-layer steering can be disabled using `SCI_AGENT_EQ_DISABLE=1`; sandbox mode skips it.

Skills use the `github:owner/repository[/subdirectory]` format and a `SKILL.md` file. The nine configured defaults are quantum-reasoning-skill, eq-layer, polyglot-code-guard, plan-auditor, nomosguard, literature-evidence-mcp, scientific-computing-system, axiomize and scientific-computing-system-2.0. Use `/skills` to inspect sources or `/skills add github:owner/repository` to add a source. Review downloaded skill text as untrusted external content. Add a model-specific plugin to `BUILTINS` in `packages/core/src/plugins.js` and enable it in configuration if additional tools or instructions are needed.

## Verification and roadmap

```bash
npm ci
npm test
npm audit --omit=dev
node -e "import('./packages/core/src/index.js').then(m => console.log(m.createRegistry({cfg:m.DEFAULT_CONFIG}).tools.length))"
```

The local regression suite recorded 235 tests: 215 passed, zero failed and 20 skipped because optional dependencies were unavailable. These are software checks, not comparative scientific-performance benchmarks. GitHub-hosted CI passed on Node.js 22 and 24 with Python 3.12 after public release, including the production-dependency security audit.

Planned work includes live model acceptance tests, comprehensive research orchestration, general Python experiment replay, broader sandbox support and comparative agent benchmarks.

## Security, privacy and licensing

- [Security policy](SECURITY.md)
- [Privacy and data handling](PRIVACY.md)
- [Third-party notices](THIRD_PARTY_NOTICES.md)
- [Public-release checklist](docs/public-release-checklist.md)
- [Changelog](CHANGELOG.md)

Sci-Agent's original source is dual-licensed under **MIT OR Apache-2.0**. See [LICENSE-MIT](LICENSE-MIT) and [LICENSE-APACHE](LICENSE-APACHE). Third-party components retain their own licenses and terms.
