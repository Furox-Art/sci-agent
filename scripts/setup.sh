#!/usr/bin/env bash
# Sci-Agent one-command setup (Linux / macOS / WSL / Git Bash)
# Usage: bash scripts/setup.sh [--skip-pip]
# - checks Node.js >= 20
# - npm install (workspaces)
# - best-effort pip install of the optional scientific bridge packages (unless --skip-pip)
# - prints verification counts
set -euo pipefail

SKIP_PIP=0
[ "${1:-}" = "--skip-pip" ] && SKIP_PIP=1
ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"

# 1) Node.js >= 20
if ! command -v node >/dev/null 2>&1; then
  echo "node not found - install Node.js 20+ (https://nodejs.org)" >&2
  exit 1
fi
NODE_MAJOR="$(node --version | sed 's/^v//' | cut -d. -f1)"
echo "node $(node --version) - OK"
if [ "$NODE_MAJOR" -lt 20 ]; then
  echo "Node.js 20+ required (found an older version)" >&2
  exit 1
fi

# 2) npm install (workspace root)
echo
echo "==> npm install (workspaces)..."
cd "$ROOT"
npm install

# 3) Optional Python bridge packages (best-effort)
if [ "$SKIP_PIP" -eq 0 ]; then
  echo
  echo "==> pip install (optional scientific bridges, best-effort)..."
  if command -v python >/dev/null 2>&1 || command -v python3 >/dev/null 2>&1; then
    PY="$(command -v python || command -v python3)"
    for p in numpy scipy pandas \
             axiomize scientific-computing-system scientific-computing-system-2.0 \
             literature-evidence-mcp plan-auditor polyglot-code-guard \
             polyglot-python scientific-reasoning-auditor repocraft nomosguard \
             'eq-layer[ml]'; do
      printf '  pip install %s ...' "$p"
      # shellcheck disable=SC2086
      if "$PY" -X utf8 -I -m pip install --quiet --disable-pip-version-check "$p" >/dev/null 2>&1; then
        echo " ok"
      else
        echo " skipped (optional)"
      fi
    done
  else
    echo "  python not found - skipping optional bridges (the agent works without them)"
  fi
else
  echo
  echo "==> skipping pip step (--skip-pip)"
fi

# 4) Verification
echo
echo "==> verification..."
cd "$ROOT"
node -e "import('./packages/core/src/plugins.js').then(m => { const ps = m.listPlugins(); const tools = ps.reduce((n,p) => n + (m.getPlugin(p.name)?.tools ?? []).length, 0); console.log('plugins: ' + ps.length); console.log('plugin tools: ' + tools); })"
echo
echo "Sci-Agent is ready."
echo "  CLI:         npm run cli -- --help"
echo "  Tests:       npm test"
