import { spawn } from 'node:child_process';
import { resolveSafe } from './fs-tools.js';

const OUT_CAP = 50_000;

export const run_command = {
  name: 'run_command',
  description: 'Çalışma alanında bir kabuk komutu çalıştırır ve çıktısını döndürür. Onay gerektirir.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Çalıştırılacak komut' },
      cwd: { type: 'string', description: 'Komutun çalışacağı dizin (varsayılan kök)' },
      timeoutMs: { type: 'number', description: 'Zaman aşımı ms (varsayılan 120000, en fazla 600000)' },
    },
    required: ['command'],
  },
  needsApproval: true,
  async execute({ command, cwd = '.', timeoutMs = 120_000 }, { workspaceRoot }) {
    const absCwd = resolveSafe(workspaceRoot, cwd);
    const timeout = Math.min(Number(timeoutMs) || 120_000, 600_000);
    return await new Promise((resolve) => {
      const child = spawn(command, { shell: true, cwd: absCwd, timeout, windowsHide: true });
      let out = '';
      const grab = (d) => {
        if (out.length < OUT_CAP) out += d.toString('utf8');
      };
      child.stdout.on('data', grab);
      child.stderr.on('data', grab);
      child.on('error', (e) => resolve(`Hata: ${e.message}`));
      child.on('close', (code, sig) => {
        if (out.length >= OUT_CAP) out += '\n...(çıktı kesildi)';
        const tail = sig === 'SIGTERM' ? `\n(zaman aşımı: ${timeout} ms)` : '';
        resolve(`çıkış kodu: ${code ?? '?'}${tail}\n${out || '(çıktı yok)'}`);
      });
    });
  },
};
