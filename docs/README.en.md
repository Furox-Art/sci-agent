<div align="center">
  <img src="https://raw.githubusercontent.com/Furox-Art/Sci-Agent/main/docs/assets/logo.png" alt="Sci-Agent" width="560" />
</div>

# Sci-Agent

**Sci-Agent** is a model-agnostic scientific research and coding agent for the terminal. It connects to any OpenAI-compatible endpoint, runs a tool-using agent loop, and keeps scientific claims tied to evidence instead of letting the model invent numbers, citations, or measurements.

- **Model-agnostic:** vLLM, Ollama, Hugging Face TGI, LM Studio, or any cloud API that speaks the OpenAI chat-completions protocol.
- **Evidence-linked:** a deterministic grounding gate catches numerical, statistical, measurement, and literature claims that were produced without a tool call, forces one verification turn, and marks the result `unverified` if the model still refuses to check.
- **Scientific toolset:** 42 built-in tools for files, shell, Python, mathematics, units, statistics, matrices, chemistry, literature search, citation checks, evidence ledgers, and plan verification.
- **Approval-gated execution:** read-only tools run automatically; writes, shell commands, and Python execution require approval. Every tool is confined to the workspace root.
- **Parallel sub-agents:** multiple `task` calls in one model step run concurrently, each with its own context.
- **Skills:** load `SKILL.md` files from public GitHub repositories and inject them into the system prompt.
- **Shared sessions:** the CLI and the optional desktop UI use the same `.sci-agent-sessions/` store, so a conversation can move between them.

## Installation

### npm (recommended for the CLI)

```bash
npm install -g sci-agent
sci-agent --version
```

### PyPI (Python launcher)

```bash
pip install sci-agent
sci-agent --version
```

The PyPI distribution is a thin, dependency-free launcher. It bundles the matching npm package and runs it with the Node.js runtime already on your machine; the scientific core is not reimplemented in Python. Node.js 20 or newer is required. Set `SCI_AGENT_NODE` to choose a Node executable and `SCI_AGENT_CACHE_DIR` to change where the bundled package is extracted.

### From source

```bash
git clone https://github.com/Furox-Art/Sci-Agent.git
cd Sci-Agent
npm install
npm run cli
```

## Requirements

- Node.js **20 or newer**.
- An OpenAI-compatible model endpoint (local or remote).
- Python **3.10+** is optional and only needed for the scientific package bridges (`numpy`, `scipy`, `pandas`, `axiomize`, `scientific-computing-system`, and related packages). The core agent, file tools, literature tools, and mathematics tools work without Python.

## Quick start

Point Sci-Agent at a model with environment variables:

```bash
export SCI_AGENT_BASE_URL=http://localhost:11434/v1
export SCI_AGENT_MODEL=your-model
sci-agent
```

Or copy `sci-agent.config.example.json` to `sci-agent.config.json` and edit it:

```json
{
  "model": {
    "provider": "openai-compatible",
    "baseUrl": "http://localhost:11434/v1",
    "apiKey": "",
    "name": "your-model",
    "temperature": 0.2,
    "stream": true
  },
  "agent": {
    "maxSteps": 25,
    "workspaceRoot": "."
  }
}
```

`apiKey` can also be supplied through `SCI_AGENT_API_KEY`; the config file is git-ignored and should never be committed.

Use the scripted mock provider to try the interface without a model:

```bash
SCI_AGENT_PROVIDER=mock sci-agent
```

## CLI

```bash
sci-agent                                  # interactive terminal
sci-agent --prompt "summarize the data"    # one-shot task
sci-agent --workspace ./project            # set the workspace
sci-agent --version | --help
```

Inside the REPL:

| Command | Action |
|---|---|
| `/help` | command list |
| `/model` | model and configuration information |
| `/tools [filter]` | list or search tools |
| `/plugins` | list plugins |
| `/skills` | list loaded skills |
| `/skills add github:user/repo` | add a skill source |
| `/sessions [no\|del no\|ren no title]` | list, switch, delete, or rename sessions |
| `/save` | save the conversation as a timestamped Markdown file |
| `/test` | test the model connection |
| `/clear` | clear the conversation and its saved history |
| `/exit` | exit |

## Scientific tools

The registry contains **42 tools** in six groups. The CLI and desktop UI use the same registry.

### File and code

`read_file`, `list_dir`, `search_files`, `write_file`, `edit_file`, `run_command`, `task`, `python_eval`.

### Scientific computation

`csv_stats`, `math_eval`, `unit_convert`, `physical_constants`, `stats_calc`, `matrix_ops`, `molar_mass`, `furox_compute`.

`furox_compute` runs Python against the installed scientific stack (`numpy`, `scipy`, `pandas`, `cds2`, `axiomize`) and reports which packages were loaded.

### Scientific package bridges

`axiomize_cli`, `cds1_cli`, `cds2_cli`, `repocraft_cli`, `nomosguard_cli`, `sra_cli`, `polyguard_cli`, `polyglot_cli`, `eq_route`, `plan_audit`.

These bridge to the author's open scientific packages: `axiomize`, `scientific-computing-system`, `scientific-computing-system-2.0`, `deterministic-recipe-scaffolder`, `evidence-ledger-policy-gate`, `scientific-reasoning-auditor`, `polyglot-code-guard`, `polyglot-python`, `eq-layer`, and `plan-auditor`.

### Literature and evidence chain

`lit_search`, `lit_verify`, `lit_quote`, `lit_audit`, `lit_screen`, `lit_ledger`, `lit_fulltext`, `lit_cite_graph`, `lit_data_code`, `lit_bib`, `lit_quote_text`, `lit_evidence`, `lit_stats_check`, `lit_doi_normalize`, `lit_pdf_provenance`, `lit_bm25_rank`.

These tools query OpenAlex, Europe PMC, and Crossref, verify quotes against full text, check retractions and corrections, export BibTeX/RIS/CSL-JSON, and maintain a hash-chained JSONL evidence ledger. Several verification tools work fully offline.

## Evidence grounding gate

Starting with v0.10.7, "do not fabricate" is enforced by the agent loop, not only by the prompt. If a run produces a final answer containing a numerical, statistical, measurement, or literature claim without any tool call, `packages/core/src/agent.js` emits a warning and forces the model to verify the claim with a tool. If the second turn still has no tool call, the result is marked `unverified: true` with an `unverifiedClaims` list, and the CLI/desktop UI shows the warning in red. Disable the gate with `runAgentLoop({ grounding: false })` when embedding the core programmatically.

## Skills

Sci-Agent loads agent skills from public GitHub repositories. A skill is a `SKILL.md` file with YAML front matter (`name`, `description`) at the repository root or a subdirectory:

```text
github:user/repo[/sub/path]
```

Default sources include `quantum-reasoning-skill`, `eq-layer`, `polyglot-code-guard`, `plan-auditor`, `evidence-ledger-policy-gate`, `literature-evidence-mcp`, `scientific-computing-system`, `axiomize`, and `scientific-computing-system-2.0`.

## Desktop UI

```bash
npm run server    # browser UI at http://127.0.0.1:8765
npm run desktop   # Electron window
```

The desktop app shares the session store with the CLI. To build a Windows installer:

```bash
npm run dist --workspace packages/desktop
```

The output is `packages/desktop/release/Sci-Agent-<version>-win-x64.exe`. The installer is unsigned, so Windows SmartScreen may warn on first launch. Set `SCI_AGENT_WORKSPACE` to choose the workspace.

## Architecture

```text
packages/
  core/      agent loop, provider interface, tool registry, approval policy, plugins, skills
  cli/       terminal interface and the `sci-agent` executable
  desktop/   local SSE server, web UI, and Electron shell
test/        node:test suites
```

The core has no runtime npm dependencies. It uses Node.js built-ins and talks to model endpoints over HTTP. Scientific Python packages are optional bridges, discovered through `SCI_AGENT_PYTHON` or the platform Python installation.

## Security model

- Read-only tools (`read_file`, `list_dir`, `search_files`, `csv_stats`, literature queries) are auto-approved by default.
- `write_file`, `edit_file`, `run_command`, `python_eval`, and the package bridges require explicit approval.
- All file paths are resolved against the workspace root; the agent cannot escape it through `..` or absolute paths.
- API keys belong in environment variables or the git-ignored `sci-agent.config.json`; never commit them.
- The npm and PyPI packages contain only the runtime source, licenses, changelog, and example config. They contain no credentials, tests, build output, or local session data.

## Tests

```bash
npm test
```

The suite uses `node:test` and covers the agent loop, tools, plugins, skills, grounding gate, streaming, CLI, server, and scientific bridges. Python-dependent tests skip automatically when the corresponding interpreter or package is unavailable.

On memory-constrained machines, set `OPENBLAS_NUM_THREADS=1` (and optionally `OMP_NUM_THREADS=1`) before running the suite so the Python bridge tests do not exhaust OpenBLAS thread buffers:

```bash
OPENBLAS_NUM_THREADS=1 npm test
```

## License

Dual-licensed under **MIT OR Apache-2.0**. See `LICENSE-MIT` and `LICENSE-APACHE`. Apache-2.0 includes an explicit patent grant; MIT is short and permissive. Choose either.

## Links

- Repository: <https://github.com/Furox-Art/Sci-Agent>
- Issues: <https://github.com/Furox-Art/Sci-Agent/issues>
- npm: <https://www.npmjs.com/package/sci-agent>
- PyPI: <https://pypi.org/project/sci-agent/>
