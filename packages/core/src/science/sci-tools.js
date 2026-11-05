import { promises as fs } from 'node:fs';
import { spawn } from 'node:child_process';
import { resolveSafe } from '../tools/fs-tools.js';
import { resolvePython } from './pybridge.js';

/** Scientific tool pack: model-agnostic, locally running computation tools. */

export const python_eval = {
  name: 'python_eval',
  description:
    'Runs a short Python snippet and returns its output (scientific computing; usable when numpy/pandas are installed). Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      code: { type: 'string', description: 'Python code to run' },
      timeoutMs: { type: 'number', description: 'Timeout in ms (default 120000, max 600000)' },
    },
    required: ['code'],
  },
  needsApproval: true,
  async execute({ code, timeoutMs = 120_000 }, { workspaceRoot }) {
    const timeout = Math.min(Number(timeoutMs) || 120_000, 600_000);
    const exe = resolvePython();
    if (!exe) return 'Error: Python not found. Install it or provide the path via SCI_AGENT_PYTHON.';
    return await new Promise((resolve) => {
      // -I: isolated mode; -X utf8: force UTF-8 standard streams on Windows.
      const child = spawn(exe, ['-I', '-X', 'utf8', '-c', code], { cwd: workspaceRoot, timeout, windowsHide: true });
      let out = '';
      const grab = (d) => {
        if (out.length < 50_000) out += d.toString('utf8');
      };
      child.stdout.on('data', grab);
      child.stderr.on('data', grab);
      child.on('error', (e) => resolve(`Error: could not run Python (${e.message}). Is it installed?`));
      child.on('close', (c, sig) => {
        const tail = sig === 'SIGTERM' ? `\n(timeout: ${timeout} ms)` : '';
        resolve(`exit code: ${c ?? '?'}${tail}\n${out || '(no output)'}`);
      });
    });
  },
};

export const csv_stats = {
  name: 'csv_stats',
  description:
    'Computes basic statistics for the numeric columns of a CSV file (n, mean, standard deviation, min, max). Simple CSV: quoted fields are not supported.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'CSV file relative to the workspace' },
      columns: {
        type: 'array',
        items: { type: 'string' },
        description: 'Only these columns (default: all)',
      },
    },
    required: ['path'],
  },
  needsApproval: false,
  async execute({ path: p, columns }, { workspaceRoot }) {
    const abs = resolveSafe(workspaceRoot, p);
    const text = await fs.readFile(abs, 'utf8');
    if (text.includes('\0')) throw new Error(`binary file cannot be read: ${p}`);
    const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
    if (lines.length < 2) throw new Error('CSV must contain at least a header + 1 row');
    const header = lines[0].split(',').map((h) => h.trim());
    const rows = lines.slice(1).map((l) => l.split(','));
    const wanted = Array.isArray(columns) && columns.length ? columns : header;
    const out = [];
    for (const name of wanted) {
      const i = header.indexOf(String(name).trim());
      if (i === -1) {
        out.push(`${name}: column not found`);
        continue;
      }
      const nums = rows.map((r) => Number(r[i])).filter((v) => Number.isFinite(v));
      if (!nums.length) {
        out.push(`${name}: no numeric data`);
        continue;
      }
      const n = nums.length;
      const mean = nums.reduce((a, b) => a + b, 0) / n;
      const sd = Math.sqrt(nums.reduce((a, b) => a + (b - mean) ** 2, 0) / (n > 1 ? n - 1 : 1));
      out.push(
        `${name}: n=${n}, mean=${mean.toPrecision(6)}, sd=${sd.toPrecision(6)}, min=${Math.min(...nums)}, max=${Math.max(...nums)}`,
      );
    }
    return `file: ${p} (${rows.length} rows)\n${out.join('\n')}`;
  },
};
