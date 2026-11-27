import { spawn } from 'node:child_process';
import { resolvePython, findPythonScript } from './pybridge.js';

/**
 * Bridge to plan-auditor (pip: plan-auditor):
 * Deterministic verification of agent plans: sealed plans,
 * SHA-256 evidence chain, STRIPS/PDDL reachability, and a fail-closed completion gate.
 * The bridge locates an installed Python interpreter independently of PATH (pybridge)
 * and executes the plan-auditor console script.
 */

const OUT_CAP = 50_000;
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_TIMEOUT_MS = 600_000;

function runProcess(exe, args, { cwd, timeout = DEFAULT_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    const env = { ...process.env, PYTHONUTF8: '1' };
    const child = spawn(exe, args, { cwd, windowsHide: true, env });
    let out = '';
    let done = false;
    let timedOut = false;
    const finish = (r) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
      } catch {}
      resolve(r);
    };
    const timer = setTimeout(() => {
      timedOut = true;
      try {
        child.kill();
      } catch {}
    }, timeout);
    const grab = (d) => {
      if (out.length < OUT_CAP) out += d.toString('utf8');
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    child.on('error', (e) => finish({ ok: false, output: `Error: ${e.message}`, code: -1 }));
    child.on('close', (code, sig) => {
      if (out.length >= OUT_CAP) out += '\n...(output truncated)';
      const tail = timedOut || sig === 'SIGTERM' ? `\n(timeout: ${timeout} ms)` : '';
      finish({ ok: code === 0 && !timedOut, output: `exit code: ${code ?? '?'}${tail}\n${out || '(no output)'}`, code });
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
    // Path 1: console script in the Python scripts/bin directory (not PATH-dependent)
    const exe = findPythonScript(py, 'plan-auditor');
    if (exe) {
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
