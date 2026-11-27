import { spawn } from 'node:child_process';
import { resolvePython, findPythonScript } from './pybridge.js';
import { sandboxEnabled, sandboxOutput } from '../sandbox/local.js';
import { buildSteering } from '../eq/eq-layer.js';

/**
 * Kullanıcının açık bilimsel paketleri için köprü araçları:
 *   - axiomize (pip: axiomize)                → modelleme, birim/boyut doğrulama, belirsizlik, SBML/CellML/Modelica
 *   - cds2 (pip: scientific-computing-system-2.0) → lineer cebir, ODE/PDE, kadratür, Monte Carlo, istatistik, sinyal, kuantum simülasyonu
 * Araçlar kurulu Python yorumlayıcısını PATH'ten bağımsız bulur (pybridge).
 */

const OUT_CAP = 50_000;

function runProcess(exe, args, { cwd, timeout = 120_000 } = {}) {
  return new Promise((resolve) => {
    const child = spawn(exe, args, { cwd, windowsHide: true });
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

const PRELUDE = [
  'import sys',
  'loaded = []',
  'for _m in ("numpy", "scipy", "pandas", "cds2", "axiomize"):',
  '    try:',
  '        __import__(_m); loaded.append(_m)',
  '    except Exception:',
  '        pass',
  'print("LOADED PACKAGES:", ",".join(loaded) if loaded else "(none)")',
].join('\n');

export const scientific_compute = {
  name: 'scientific_compute',
  description:
    'Runs code with the installed scientific Python stack (numpy, scipy, pandas, cds2, axiomize — installed packages are auto-imported); the preferred tool for numerical scientific computations. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python code to run' },
      timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' },
    },
    required: ['code'],
  },
  needsApproval: true,
  parallel: true,
  async execute({ code, timeoutMs = 120_000 }, { workspaceRoot, cfg, signal }) {
    if(sandboxEnabled(cfg))return sandboxOutput({workspaceRoot,kind:'python',code:PRELUDE+'\n'+code,timeoutMs,signal});
    const py = resolvePython();
    if (!py) return 'Error: Python not found. Install it or provide the path via SCI_AGENT_PYTHON.';
    const timeout = Math.min(Number(timeoutMs) || 120_000, 600_000);
    const res = await runProcess(py, ['-I', '-X', 'utf8', '-c', `${PRELUDE}\n${code}`], { cwd: workspaceRoot, timeout });
    return res.output;
  },
};

function cliTool({ name, script, moduleName, installHint, description }) {
  return {
    name,
    description: `${description} Requires approval.`,
    parameters: {
      type: 'object',
      properties: {
        args: { type: 'array', items: { type: 'string' }, description: `CLI arguments (e.g. ["capabilities"])` },
        timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' },
      },
      required: ['args'],
    },
    needsApproval: true,
    parallel: true,
    async execute({ args = [], timeoutMs = 120_000 }, { workspaceRoot }) {
      const py = resolvePython();
      if (!py) return `Error: Python not found. ${installHint}`;
      const timeout = Math.min(Number(timeoutMs) || 120_000, 600_000);
      const exe = findPythonScript(py, script);
      if (exe) {
        const res = await runProcess(exe, args, { cwd: workspaceRoot, timeout });
        return res.output;
      }
      // If the console script is missing, try the module entry (python -m <mod>)
      const mod = moduleName ?? script.replaceAll('-', '_');
      const res = await runProcess(py, ['-X', 'utf8', '-m', mod, ...args], { cwd: workspaceRoot, timeout });
      return res.ok || !res.output.includes('No module named')
        ? res.output
        : `Error: '${script}' not found. ${installHint}\n${res.output}`;
    },
  };
}

export const axiomize_cli = cliTool({
  name: 'axiomize_cli',
  script: 'axiomize',
  installHint: "Install: pip install axiomize",
  description:
    'axiomize CLI: versioned scientific modeling IR, mandatory units, dimension/numerical validation, calibration, uncertainty analysis; SBML/CellML/Modelica export (e.g. ["capabilities"], ["solve"], ["fit"], ["model","--action","numerical-verify"]).',
});

export const cds2_cli = cliTool({
  name: 'cds2_cli',
  script: 'cds2',
  installHint: 'Install: pip install scientific-computing-system-2.0',
  description:
    'cds2 CLI (scientific-computing-system-2.0): linear algebra, ODE/PDE solvers, quadrature, Monte Carlo, statistics, signal processing, quantum simulation, uncertainty quantification (explore with ["--help"]).',
});

export const cds1_cli = cliTool({
  name: 'cds1_cli',
  script: 'cds',
  installHint: 'Install: pip install scientific-computing-system',
  description:
    'cds CLI (scientific-computing-system v1, pure Python): calc/stats/integrate/units/constants/plot/sample/hypothesis/prompt/modules (explore with ["--help"]).',
});

export const repocraft_cli = cliTool({
  name: 'repocraft_cli',
  script: 'repocraft',
  installHint: 'Install: pip install repocraft',
  description:
    'repocraft CLI: deterministic Python project scaffolding from a validated specification (validate/render/make/recipes/ask/craft; explore with ["--help"]).',
});

export const nomosguard_cli = cliTool({
  name: 'nomosguard_cli',
  script: 'nomosguard',
  installHint: 'Install: pip install nomosguard',
  description:
    'nomosguard CLI: deterministic safety reasoning core — hash-chained evidence ledger, fail-closed policy gate (["--help"] for subcommands).',
});

export const sra_cli = cliTool({
  name: 'sra_cli',
  script: 'sra',
  installHint: 'Install: pip install scientific-reasoning-auditor',
  description:
    'sra CLI (scientific-reasoning-auditor): scientific paper reasoning audit — audit/review-template/review-model/verify-stats (explore with ["--help"]).',
});

export const polyguard_cli = cliTool({
  name: 'polyguard_cli',
  script: 'polyguard',
  installHint: 'Install: pip install polyglot-code-guard',
  description:
    'polyguard CLI (polyglot-code-guard): fail-closed verification for AI-generated code — runs the project test suites, does not pass without evidence (e.g. ["verify","--path","."]).',
});

export const polyglot_cli = cliTool({
  name: 'polyglot_cli',
  script: 'polyglot-python',
  installHint: 'Install: pip install polyglot-python',
  description:
    'polyglot-python CLI: write Python in your own language — deterministic keyword transpiler (run/translate/check/locales; 8 languages incl. TR; explore with ["--help"]).',
});

export const eq_route = {
  name: 'eq_route',
  description:
    'eq-layer routing: intent/emotion/repair analysis and a response routing suggestion for the given user message (the user\u2019s eq-layer package; portable path).',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'User message to route' },
    },
    required: ['message'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ message }) {
    const r = await buildSteering({ messages: [{ role: 'user', content: message }] });
    if (!r) return 'eq-layer unavailable (not installed or SCI_AGENT_EQ_DISABLE=1).';
    return `source: ${r.source}\n${r.steering}`;
  },
};

export const sciFuroxTools = [
  scientific_compute,
  axiomize_cli,
  cds2_cli,
  cds1_cli,
  repocraft_cli,
  nomosguard_cli,
  sra_cli,
  polyguard_cli,
  polyglot_cli,
  eq_route,
];
