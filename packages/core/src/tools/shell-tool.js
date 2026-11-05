import { spawn } from 'node:child_process';
import { resolveSafe } from './fs-tools.js';

const OUT_CAP = 50_000;

export const run_command = {
  name: 'run_command',
  description: 'Runs a shell command in the workspace and returns its output. Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      command: { type: 'string', description: 'Command to run' },
      cwd: { type: 'string', description: 'Directory the command runs in (default root)' },
      timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' },
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
      child.on('error', (e) => resolve(`Error: ${e.message}`));
      child.on('close', (code, sig) => {
        if (out.length >= OUT_CAP) out += '\n...(output truncated)';
        const tail = sig === 'SIGTERM' ? `\n(timeout: ${timeout} ms)` : '';
        resolve(`exit code: ${code ?? '?'}${tail}\n${out || '(no output)'}`);
      });
    });
  },
};
