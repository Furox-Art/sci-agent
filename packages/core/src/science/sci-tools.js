import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolveSafe } from '../tools/fs-tools.js';

/** Bilimsel araç takımı: model-bağımsız, yerel çalışan hesaplama araçları. */

export const python_eval = {
  name: 'python_eval',
  description:
    'Kısa bir Python kodunu çalıştırıp çıktısını döndürür (bilimsel hesaplama; numpy/pandas kuruluysa kullanılabilir). Onay gerektirir.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Çalıştırılacak Python kodu' },
      timeoutMs: { type: 'number', description: 'Zaman aşımı ms (varsayılan 120000, en fazla 600000)' },
    },
    required: ['code'],
  },
  needsApproval: true,
  async execute({ code, timeoutMs = 120_000 }, { workspaceRoot }) {
    const timeout = Math.min(Number(timeoutMs) || 120_000, 600_000);
    const exe = process.platform === 'win32' ? 'python' : 'python3';
    return await new Promise((resolve) => {
      // -I: yalıtılmış kip; kod kabuk üzerinden değil doğrudan argüman olarak verilir.
      const child = spawn(exe, ['-I', '-c', code], { cwd: workspaceRoot, timeout, windowsHide: true });
      let out = '';
      const grab = (d) => {
        if (out.length < 50_000) out += d.toString('utf8');
      };
      child.stdout.on('data', grab);
      child.stderr.on('data', grab);
      child.on('error', (e) => resolve(`Hata: Python çalıştırılamadı (${e.message}). Kurulu mu?`));
      child.on('close', (c, sig) => {
        const tail = sig === 'SIGTERM' ? `\n(zaman aşımı: ${timeout} ms)` : '';
        resolve(`çıkış kodu: ${c ?? '?'}${tail}\n${out || '(çıktı yok)'}`);
      });
    });
  },
};

export const csv_stats = {
  name: 'csv_stats',
  description:
    'CSV dosyasının sayısal sütunları için temel istatistikleri hesaplar (n, ortalama, standart sapma, min, maks). Basit CSV: tırnaklı alanlar desteklenmez.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Çalışma alanına göre CSV dosyası' },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Yalnız bu sütunlar (varsayılan: tümü)',
      },
    },
    required: ['path'],
  },
  needsApproval: false,
  async execute({ path: p, columns }, { workspaceRoot }) {
    const abs = resolveSafe(workspaceRoot, p);
    const text = await fs.readFile(abs, 'utf8');
    if (text.includes('\0')) throw new Error(`ikili dosya okunamaz: ${p}`);
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) throw new Error('CSV en az başlık + 1 satır içermeli');
    const header = lines[0].split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((l) => l.split(','));
    const wanted = Array.isArray(columns) && columns.length ? columns : header;
    const out = [];
    for (const name of wanted) {
      const i = header.indexOf(String(name).trim());
      if (i === -1) {
        out.push(`${name}: sütun yok`);
        continue;
      }
      const nums = rows.map((r) => Number(r[i])).filter((v) => Number.isFinite(v));
      if (!nums.length) {
        out.push(`${name}: sayısal veri yok`);
        continue;
      }
      const n = nums.length;
      const mean = nums.reduce((a, b) => a + b, 0) / n;
      const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (n > 1 ? n - 1 : 1));
      out.push(
        `${name}: n=${n}, ortalama=${mean.toPrecision(6)}, ss=${sd.toPrecision(6)}, min=${Math.min(...nums)}, maks=${Math.max(...nums)}`,
      );
    }
    return `dosya: ${p} (${rows.length} satır)\n${out.join('\n')}`;
  },
};
