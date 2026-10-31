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
    child.on('error', (e) => resolve({ ok: false, output: `Hata: ${e.message}`, code: -1 }));
    child.on('close', (code, sig) => {
      if (out.length >= OUT_CAP) out += '\n...(çıktı kesildi)';
      const tail = sig === 'SIGTERM' ? `\n(zaman aşımı: ${timeout} ms)` : '';
      resolve({ ok: code === 0, output: `çıkış kodu: ${code ?? '?'}${tail}\n${out || '(çıktı yok)'}`, code });
    });
  });
}

export const plan_audit = {
  name: 'plan_audit',
  description:
    'plan-auditor CLI: AI ajan planlarını bağımsız ve deterministik doğrular — mühürlü plan sözleşmeleri, SHA-256 hash zincirli kanıt günlüğü, STRIPS/PDDL erişilebilirlik denetimi, fail-closed tamamlanma kapısı. Gerçek alt komutlar (--help): supervisor (gözetim servisi denetimi), task (planları gözetim görevi olarak inceleme), plan (planları doğrula/mühürle/incele), evidence (aktif ve arşivlenmiş kanıtları doğrula), integrity (dış anahtarla kimliklenen bütünlük), request (host\u2019a ait değişmez istek sözleşmesi), agents (kalıcı çoklu ajan kayıt defteri), audit (aktif planlarda bütünleşik son kapı), doctor (ortam ve gözetim yeteneği raporu), run ve validate (deterministik çekirdeğe yönlendirme). Keşif için ["--help"]. Onay gerektirir.',
  parameters: {
    type: 'object',
    properties: {
      args: {
        type: 'array',
        items: { type: 'string' },
        description: 'plan-auditor CLI argümanları (ör. ["--help"], ["plan","--help"], ["doctor"], ["audit","."])',
      },
      timeoutMs: { type: 'number', description: 'Zaman aşımı ms (varsayılan 120000, en fazla 600000)' },
    },
    required: ['args'],
  },
  needsApproval: true,
  parallel: true,
  async execute({ args = [], timeoutMs = DEFAULT_TIMEOUT_MS }, { workspaceRoot }) {
    const py = resolvePython();
    if (!py) {
      return 'Hata: Python bulunamadı. plan-auditor için Python 3.10+ gerekir; kurun veya SCI_AGENT_PYTHON ortam değişkeniyle yolu verin.';
    }
    const timeout = Math.min(Number(timeoutMs) || DEFAULT_TIMEOUT_MS, MAX_TIMEOUT_MS);
    // 1. yol: Python Scripts dizinindeki konsol betiği (PATH'e bağlı değil)
    const exe = path.join(pythonScriptsDir(py), 'plan-auditor.exe');
    if (existsSync(exe)) {
      const res = await runProcess(exe, args, { cwd: workspaceRoot, timeout });
      return res.output;
    }
    // 2. yol: modül girişimi (python -m supervisor.cli — paketin gerçek giriş noktası)
    const res = await runProcess(py, ['-X', 'utf8', '-m', 'supervisor.cli', ...args], {
      cwd: workspaceRoot,
      timeout,
    });
    if (!res.ok && /No module named/.test(res.output)) {
      return `Hata: 'plan-auditor' bulunamadı. Kurmak için: pip install plan-auditor\n${res.output}`;
    }
    return res.output;
  },
};

export const sciAuditTools = [plan_audit];
