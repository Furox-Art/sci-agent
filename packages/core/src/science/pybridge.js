import { existsSync, readdirSync } from 'node:fs';
import path from 'node:path';

/**
 * Finds the installed Python interpreter (independent of PATH).
 * The SCI_AGENT_PYTHON environment variable has the highest priority.
 * Returns: absolute path to python.exe, or a bare name left to PATH.
 */
let cached = undefined;

export function resolvePython() {
  if (cached !== undefined) return cached;
  const candidates = [];
  if (process.env.SCI_AGENT_PYTHON) candidates.push(process.env.SCI_AGENT_PYTHON);
  if (process.env.LOCALAPPDATA) {
    const base = path.join(process.env.LOCALAPPDATA, 'Programs', 'Python');
    try {
      for (const d of readdirSync(base)) candidates.push(path.join(base, d, 'python.exe'));
    } catch {}
  }
  if (process.env.ProgramFiles) {
    for (const d of readdirSafe(process.env.ProgramFiles)) {
      if (/^Python3\d+$/i.test(d)) candidates.push(path.join(process.env.ProgramFiles, d, 'python.exe'));
    }
  }
  candidates.push('python', 'python3');
  for (const c of candidates) {
    if (path.isAbsolute(c) && !existsSync(c)) continue;
    cached = c;
    return c;
  }
  cached = null;
  return null;
}

function readdirSafe(dir) {
  try {
    return readdirSync(dir);
  } catch {
    return [];
  }
}

/** The interpreter's Scripts directory (Windows console scripts: axiomize.exe, cds2.exe…). */
export function pythonScriptsDir(pyExe) {
  const base = path.dirname(path.resolve(pyExe));
  const scripts = path.join(base, 'Scripts');
  return existsSync(scripts) ? scripts : base;
}
