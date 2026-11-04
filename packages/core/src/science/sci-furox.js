import { existsSync } from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { resolvePython, pythonScriptsDir } from './pybridge.js';
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
    const child = spawn(exe, args, { cwd, timeout, windowsHide: true });
    let out = '';
    const grab = (d) => {
      if (out.length < OUT_CAP) out += d.toString('utf8');
    };
    child.stdout.on('data', grab);
    child.stderr.on('data', grab);
    child.on('error', (e) => resolve({ ok: false, output: `Hata: ${e.message}`, code: -1 }));
    child.on('close', (code, sig) => {
      if (out.length >= OUT_CAP) out += '\n...(çıktı kesildi)';
      const tail = sig === 'SIGTERM' ? `\n(zaman aşımı: ${timeout} ms)` : '';
      resolve({ ok: code === 0, output: `çıkış kodu: ${code ?? '?'}${tail}\n${out || '(çıktı yok)'}`, code });
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
  'print("YÜKLÜ PAKETLER:", ",".join(loaded) if loaded else "(hiçbiri)")',
].join('\n');

export const furox_compute = {
  name: 'furox_compute',
  description:
    'Kullanıcının bilimsel Python yığınıyla (numpy, scipy, pandas, cds2, axiomize — kurulu olanlar otomatik yüklenir) kod çalıştırır; sayısal bilimsel hesaplamalar için tercih edilen araç. Onay gerektirir.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Çalıştırılacak Python kodu' },
      timeoutMs: { type: 'number', description: 'Zaman aşımı ms (varsayılan 120000, en fazla 600000)' },
    },
    required: ['code'],
  },
  needsApproval: true,
  parallel: true,
  async execute({ code, timeoutMs = 120_000 }, { workspaceRoot }) {
    const py = resolvePython();
    if (!py) return 'Hata: Python bulunamadı. Kurun veya SCI_AGENT_PYTHON ile yolu verin.';
    const timeout = Math.min(Number(timeoutMs) || 120_000, 600_000);
    const res = await runProcess(py, ['-I', '-X', 'utf8', '-c', `${PRELUDE}\n${code}`], { cwd: workspaceRoot, timeout });
    return res.output;
  },
};

function cliTool({ name, script, installHint, description }) {
  return {
    name,
    description: `${description} Onay gerektirir.`,
    parameters: {
      type: 'object',
      properties: {
        args: { type: 'array', items: { type: 'string' }, description: `CLI argümanları (ör. ["capabilities"])` },
        timeoutMs: { type: 'number', description: 'Zaman aşımı ms (varsayılan 120000, en fazla 600000)' },
      },
      required: ['args'],
    },
    needsApproval: true,
    parallel: true,
    async execute({ args = [], timeoutMs = 120_000 }, { workspaceRoot }) {
      const py = resolvePython();
      if (!py) return `Hata: Python bulunamadı. ${installHint}`;
      const timeout = Math.min(Number(timeoutMs) || 120_000, 600_000);
      const exe = path.join(pythonScriptsDir(py), `${script}.exe`);
      if (existsSync(exe)) {
        const res = await runProcess(exe, args, { cwd: workspaceRoot, timeout });
        return res.output;
      }
      // exe yoksa modül girişimini dene (python -m <script>)
      const res = await runProcess(py, ['-X', 'utf8', '-m', script, ...args], { cwd: workspaceRoot, timeout });
      return res.ok || !res.output.includes('No module named')
        ? res.output
        : `Hata: '${script}' bulunamadı. ${installHint}\n${res.output}`;
    },
  };
}

export const axiomize_cli = cliTool({
  name: 'axiomize_cli',
  script: 'axiomize',
  installHint: "Kurmak için: pip install axiomize",
  description:
    'axiomize CLI: sürümlü bilimsel modelleme IR\u2019i, zorunlu birimler, boyut/sayısal doğrulama, kalibrasyon, belirsizlik analizi; SBML/CellML/Modelica dışa aktarım (ör. ["capabilities"], ["solve"], ["fit"], ["model","--action","numerical-verify"]).',
});

export const cds2_cli = cliTool({
  name: 'cds2_cli',
  script: 'cds2',
  installHint: 'Kurmak için: pip install scientific-computing-system-2.0',
  description:
    'cds2 CLI (scientific-computing-system-2.0): lineer cebir, ODE/PDE çözücüler, kadratür, Monte Carlo, istatistik, sinyal işleme, kuantum simülasyonu, belirsizlik nicemleme (keşif için ["--help"]).',
});

export const cds1_cli = cliTool({
  name: 'cds1_cli',
  script: 'cds',
  installHint: 'Kurmak için: pip install scientific-computing-system',
  description:
    'cds CLI (scientific-computing-system v1, saf Python): calc/stats/integrate/units/constants/plot/sample/hypothesis/prompt/modules (keşif için ["--help"]).',
});

export const repocraft_cli = cliTool({
  name: 'repocraft_cli',
  script: 'repocraft',
  installHint: 'Kurmak için: pip install repocraft',
  description:
    'repocraft CLI: doğrulanmış spesifikasyondan deterministik Python proje iskeleti oluşturma (validate/render/make/recipes/ask/craft; keşif için ["--help"]).',
});

export const nomosguard_cli = cliTool({
  name: 'nomosguard_cli',
  script: 'nomosguard',
  installHint: 'Kurmak için: pip install nomosguard',
  description:
    'nomosguard CLI: deterministik güvenlik akıl yürütme çekirdeği — hash zincirli kanıt defteri, fail-closed politika kapısı (alt komutlar için ["--help"]).',
});

export const eq_route = {
  name: 'eq_route',
  description:
    'eq-layer routing: verilen kullanıcı mesajı için niyet/duygu/repair analizi ve yanıt yönlendirme önerisi üretir (kullanıcının eq-layer paketi; portable yol).',
  parameters: {
    type: 'object',
    properties: {
      message: { type: 'string', description: 'Yönlendirilecek kullanıcı mesajı' },
    },
    required: ['message'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ message }) {
    const r = await buildSteering({ messages: [{ role: 'user', content: message }] });
    if (!r) return 'eq-layer kullanılamadı (kurulu değil veya SCI_AGENT_EQ_DISABLE=1).';
    return `kaynak: ${r.source}\n${r.steering}`;
  },
};

export const sciFuroxTools = [
  furox_compute,
  axiomize_cli,
  cds2_cli,
  cds1_cli,
  repocraft_cli,
  nomosguard_cli,
  eq_route,
];
