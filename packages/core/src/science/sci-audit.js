import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolvePython, pythonScriptsDir } from './pybridge.js';

/**
 * plan-auditor (pip: plan-auditor) köprü aracı:
 * AI ajanlarının planlarını deterministik doğrular — mühürlü planlar,
 * SHA-256 kanıt zinciri, STRIPS/PDDL erişilebilirlik, fail-closed tamamlanma kapısı.
 * Araç, kurulu Python yorumlayıcısını PATH'ten bağımsız bulur (pybridge) ve
 * plan-auditor konsol betiğini (Scripts/plan-auditor.exe) çalıştırır.
 */

const OUT_CAP = 50_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

function runProcess(exe, args, { cwd, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, PYTHONUTF8: '1' };
    const child = spawn(exe, args, { cwd, timeout, windowsHide: true, env });
    let out = '';
    const grab = (d) => {
      if (out.length < OUT_CAP) out += d.toString('utf8');
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    child.on('error', (e) => resolve({ ok: false, output: `Error: ${e.message}`, code: -1 }));
    child.on('close', (code, sig) => {
      if (out.length >= OUT_CAP) out += '\n...(output truncated)';
      const tail = sig === 'SIGTERM' ? `\n(timeout: ${timeout} ms)` : '';
      resolve({ ok: code === 0, output: `exit code: ${code ?? '?'}${tail}\n${out || '(no output)'}`, code });
    });
  });
}

export const plan_audit = {
  name: 'plan_audit',
  description:
    'plan-auditor CLI: independently and deterministically verifies AI agent plans — sealed plan contracts, SHA-256 hash-chained evidence log, STRIPS/PDDL reachability audit, fail-closed completion gate. Actual subcommands (--help): supervisor (supervision service audit), task (inspect plans as supervision tasks), plan (verify/seal/inspect plans), evidence (verify active and archived evidence), integrity (integrity identified with an external key), request (host\u2019s immutable request contract), agents (persistent multi-agent registry), audit (integrated final gate on active plans), doctor (environment and supervision capability report), run and validate (dispatch to the deterministic core). Explore with ["--help"]. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'plan-auditor CLI arguments (e.g. ["--help"], ["plan","--help"], ["doctor"], ["audit","."])',
      },
      timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' },
    },
    required: ['args'],
  },
  needsApproval: true,
  parallel: true,
  async execute({ args = [], timeoutMs = DEFAULT_TIMEOUT_MS }, { workspaceRoot }) {
    const py = resolvePython();
    if (!py) {
      return 'Error: Python not found. Python 3.10+ is required for plan-auditor; install it or provide the path via the SCI_AGENT_PYTHON environment variable.';
    }
    const timeout = Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    // Path 1: console script in the Python Scripts directory (not PATH-dependent)
    const exe = path.join(pythonScriptsDir(py), 'plan-auditor.exe');
    if (existsSync(exe)) {
      const res = await runProcess(exe, args, { cwd: workspaceRoot, timeout });
      return res.output;
    }
    // Path 2: module attempt (python -m supervisor.cli — the package's real entry point)
    const res = await runProcess(py, ['-X', 'utf8', '-m', 'supervisor.cli', ...args], {
      cwd: workspaceRoot,
      timeout,
    });
    if (!res.ok && /No module named/.test(res.output)) {
      return `Error: 'plan-auditor' not found. Install: pip install plan-auditor\n${res.output}`;
    }
    return res.output;
  },
};

export const sciAuditTools = [plan_audit];
