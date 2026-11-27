# Sci-Agent (PyPI launcher)

**Sci-Agent** is a model-agnostic scientific research and coding agent for the terminal. This PyPI distribution is a thin, dependency-free launcher for the matching npm package. It does **not** reimplement the scientific core in Python; it runs the bundled Node.js CLI with the Node runtime already installed on your machine.

## Requirements

- Node.js **20 or newer**
- Python **3.9 or newer** (this launcher)
- An OpenAI-compatible model endpoint for actual agent runs

## Install

```bash
pip install sci-agent
sci-agent --version
```

The wheel bundles `sci-agent-<version>.tgz`, the exact npm package published for this release. On first run the launcher extracts it to a cache directory and then executes:

```text
node <cache>/<version>/package/packages/cli/bin/sci-agent.js
```

No separate `npm install` is required.

## Usage

```bash
sci-agent                                  # interactive terminal
sci-agent --prompt "summarize the data"    # one-shot task
sci-agent --workspace ./project            # set the workspace
sci-agent --version | --help
```

Configure the model with `sci-agent.config.json` or environment variables:

```bash
export SCI_AGENT_BASE_URL=http://localhost:11434/v1
export SCI_AGENT_MODEL=your-model
export SCI_AGENT_API_KEY=...
sci-agent
```

## Environment variables

| Variable | Purpose |
|---|---|
| `SCI_AGENT_NODE` | Path to the Node.js executable (default: `node` on `PATH`) |
| `SCI_AGENT_CACHE_DIR` | Where the bundled npm package is extracted |
| `SCI_AGENT_BASE_URL` | OpenAI-compatible base URL |
| `SCI_AGENT_API_KEY` | API key for the model endpoint |
| `SCI_AGENT_MODEL` | Model name |
| `SCI_AGENT_PROVIDER` | `openai-compatible` (default) or `mock` |
| `SCI_AGENT_WORKSPACE` | Workspace root |

## What is inside

The npm tarball contains only the runtime source (`packages/core`, `packages/cli`), the example config, changelog, licenses, and README. It contains no credentials, tests, build output, or local session data. The launcher validates the archive paths before extraction and never executes anything except the bundled CLI entry point.

## Full documentation

See the repository README for the architecture, the tool registry, the evidence grounding gate, skills, provider and local-model options, and the security model:

<https://github.com/Furox-Art/Sci-Agent>

## License

Dual-licensed under **MIT OR Apache-2.0**. See `LICENSE-MIT` and `LICENSE-APACHE`.
