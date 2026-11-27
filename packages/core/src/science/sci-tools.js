import { spawn } from 'node:child_process';
import { readSafeText } from '../tools/fs-tools.js';
import { parseCsv, parseNumericCell } from './csv-parser.js';
import { describeNumbers } from './numeric-stats.js';
import { sandboxEnabled, sandboxOutput } from '../sandbox/local.js';
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
  async execute({ code, timeoutMs = 120_000 }, { workspaceRoot, cfg, signal }) {
    if(sandboxEnabled(cfg))return sandboxOutput({workspaceRoot,kind:'python',code,timeoutMs,signal});
    const timeout = Math.min(Number(timeoutMs) || 120_000, 600_000);
    const exe = resolvePython();
    if (!exe) return 'Error: Python not found. Install it or provide the path via SCI_AGENT_PYTHON.';
    return await new Promise((resolve) => {
      // -I: isolated mode; -X utf8: force UTF-8 standard streams on Windows.
      // Timeout is handled here (not via spawn's `timeout` option): when a spawn fails
      // (ENOENT/EACCES) the stdio pipes would otherwise keep the event loop alive.
      const child = spawn(exe, ['-I', '-X', 'utf8', '-c', code], { cwd: workspaceRoot, windowsHide: true });
      let out = '';
      let done = false;
      let timedOut = false;
      const finish = (text) => {
        if (done) return;
        done = true;
        clearTimeout(timer);
        try {
          child.stdin?.destroy();
          child.stdout?.destroy();
          child.stderr?.destroy();
        } catch {}
        resolve(text);
      };
      const timer = setTimeout(() => {
        timedOut = true;
        try {
          child.kill();
        } catch {}
      }, timeout);
      const grab = (d) => {
        if (out.length < 50_000) out += d.toString('utf8');
      };
      child.stdout.on('data', grab);
      child.stderr.on('data', grab);
      child.on('error', (e) => finish(`Error: could not run Python (${e.message}). Is it installed?`));
      child.on('close', (c, sig) => {
        const tail = timedOut || sig === 'SIGTERM' ? `\n(timeout: ${timeout} ms)` : '';
        finish(`exit code: ${c ?? '?'}${tail}\n${out || '(no output)'}`);
      });
    });
  },
};

export const csv_stats = {
  name: 'csv_stats',
  description:
    'Computes basic statistics for the numeric columns of a CSV file (n, mean, sample standard deviation (undefined for one value), min, max). Supports quoted fields, escaped quotes and multiline records.',
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
    const text = await readSafeText(workspaceRoot,p);
    if (text.includes('\0')) throw new Error(`binary file cannot be read: ${p}`);
    const { header, rows } = parseCsv(text);
    const wanted = Array.isArray(columns) && columns.length ? columns : header;
    const out = [];
    for (const name of wanted) {
      const i = header.indexOf(String(name).trim());
      if (i === -1) {
        out.push(`${name}: column not found`);
        continue;
      }
      const nums = rows.map((r) => parseNumericCell(r[i])).filter((v) => v !== null);
      if (!nums.length) {
        out.push(`${name}: no numeric data`);
        continue;
      }
      const { n, mean, sd, min, max } = describeNumbers(nums, { includeVariance: false, includeMedian: false });
      out.push(
        `${name}: n=${n}, mean=${mean.toPrecision(6)}, sd=${sd === null ? 'undefined (requires at least 2 values)' : sd.toPrecision(6)}, min=${min}, max=${max}`,
      );
    }
    return `file: ${p} (${rows.length} rows)\n${out.join('\n')}`;
  },
};
