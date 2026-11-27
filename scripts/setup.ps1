# Sci-Agent one-command setup (Windows)
# Usage: powershell -NoProfile -ExecutionPolicy Bypass -File scripts\setup.ps1 [-SkipPip]
# - checks Node.js >= 20
# - npm install (workspaces)
# - best-effort pip install of the optional scientific bridge packages (unless -SkipPip)
# - prints verification counts (plugins / tools / tests are printed by npm test)
param(
  [switch]$SkipPip
)

$ErrorActionPreference = 'Stop'

# 1) Node.js >= 20
$nodeOk = $false
try {
  $v = (& node --version) -replace '^v', ''
  $major = [int]($v.Split('.')[0])
  $nodeOk = $major -ge 20
  Write-Host ("node " + $v + " - OK")
} catch {
  Write-Host "node not found - install Node.js 20+ from https://nodejs.org" -ForegroundColor Red
  exit 1
}
if (-not $nodeOk) {
  Write-Host "Node.js 20+ required (found an older version)" -ForegroundColor Red
  exit 1
}

# 2) npm install (workspace root)
Write-Host "`n==> npm install (workspaces)..."
Push-Location $PSScriptRoot\..
try {
  & npm install
  if ($LASTEXITCODE -ne 0) { throw "npm install failed" }
} finally {
  Pop-Location
}

# 3) Optional Python bridge packages (best-effort)
if (-not $SkipPip) {
  Write-Host "`n==> pip install (optional scientific bridges, best-effort)..."
  $py = Get-Command python -ErrorAction SilentlyContinue
  if (-not $py) { $py = Get-Command py -ErrorAction SilentlyContinue }
  if ($py) {
    $pkgs = @(
      'numpy', 'scipy', 'pandas',
      'axiomize', 'scientific-computing-system', 'scientific-computing-system-2.0',
      'literature-evidence-mcp', 'plan-auditor', 'polyglot-code-guard',
      'polyglot-python', 'scientific-reasoning-auditor', 'repocraft', 'nomosguard',
      'eq-layer[ml]'
    )
    foreach ($p in $pkgs) {
      Write-Host ("  pip install " + $p + " ...") -NoNewline
      & $py.Source -X utf8 -I -m pip install --quiet --disable-pip-version-check $p 2>$null
      if ($LASTEXITCODE -eq 0) { Write-Host " ok" -ForegroundColor Green }
      else { Write-Host " skipped (optional)" -ForegroundColor Yellow }
    }
  } else {
    Write-Host "  python not found - skipping optional bridges (the agent works without them)" -ForegroundColor Yellow
  }
} else {
  Write-Host "`n==> skipping pip step (-SkipPip)"
}

# 4) Verification
Write-Host "`n==> verification..."
Push-Location $PSScriptRoot\..
try {
  & node -e "import('./packages/core/src/plugins.js').then(m => { const ps = m.listPlugins(); const tools = ps.reduce((n,p) => n + (m.getPlugin(p.name)?.tools ?? []).length, 0); console.log('plugins: ' + ps.length); console.log('plugin tools: ' + tools); })"
  Write-Host "`nSci-Agent is ready."
  Write-Host "  CLI:         npm run cli -- --help"
  Write-Host "  Tests:       npm test"
} finally {
  Pop-Location
}
