/**
 * Automatic eq-layer steering layer.
 *
 * Before each user turn invokes the model, the installed eq-layer Python package
 * (pip: eq-layer) runs to assess intent, emotional context and repair needs.
 * The selected response policy supplies system_instruction text for
 * steering in the current system prompt. Persistent
 * conversation history is not modified here.
 *
 * Path priority (prefer the lightest reliable method):
 *   1. 'portable' — call the installed Python API directly
 *      (python -X utf8 -I -c …; JSON input on stdin, output on stdout;
 *      prefer the dependency-light heuristic path),
 *   2. 'cli' — eq-layer console script (Python Scripts directory or PATH).
 *
 * Availability is detected once and cached in a module variable;
 * SCI_AGENT_EQ_DISABLE=1 returns null on every call. Failures return null
 * silently; each subprocess has an approximately 20-second timeout.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolvePython, findPythonScript } from '../science/pybridge.js';

const TIMEOUT_MS = 20_000;
const MAX_STEERING_CHARS = 4000;

// eq-layer CLI contract: route reads [{role, content}, ...] from stdin,
// and emits one JSON line on stdout (system_instruction is the steering text).
// 'heuristic' mode avoids loading learned ML components; a portable, lightweight path.
const PY_ROUTE_SCRIPT =
  "import sys; from eq_layer.cli import main; sys.exit(main(['route', '--intent-mode', 'heuristic']))";

/** 'portable' | 'cli' | null — detected once and reused from cache. */
let transport;
let warned = false;

function warn(message) {
  if (warned) return;
  warned = true;
  console.error(`[eq-layer] ${message}`);
}

/**
 * Filter messages for the eq-layer contract: only user/assistant/system
 * roles and non-empty text are retained; if there is no user message,
 * skip eq-layer.
 */
function normalizeMessages(messages) {
  if (!Array.isArray(messages)) return null;
  const out = [];
  for (const m of messages) {
    if (!m || typeof m !== 'object') continue;
    const { role, content } = m;
    if (role !== 'user' && role !== 'assistant' && role !== 'system') continue;
    if (typeof content !== 'string' || !content.trim()) continue;
    out.push({ role, content });
  }
  return out.some((m) => m.role === 'user') ? out : null;
}

/** Run one subprocess; return null on failure or timeout instead of throwing. */
function runProcess(cmd, args, input) {
  return new Promise((resolve) => {
    let child;
    try {
      child = spawn(cmd, args, { windowsHide: true });
    } catch {
      resolve(null);
      return;
    }
    let stdout = '';
    let done = false;
    const finish = (value) => {
      if (done) return;
      done = true;
      clearTimeout(timer);
      try {
        child.stdin?.destroy();
        child.stdout?.destroy();
        child.stderr?.destroy();
      } catch {}
      resolve(value);
    };
    const timer = setTimeout(() => {
      try {
        child.kill();
      } catch {}
      finish(null);
    }, TIMEOUT_MS);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', () => {});
    child.on('error', () => finish(null));
    child.on('close', (code) => finish(code === 0 ? stdout : null));
    child.stdin.on('error', () => {});
    child.stdin.end(Buffer.from(input, 'utf8'));
  });
}

/** Parse CLI output into a short heading and system_instruction steering text. */
function parseRouteOutput(stdout) {
  if (!stdout || !stdout.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    // If warnings appear on stdout, the final line may still contain JSON.
    const last = stdout.trim().split(/\r?\n/).pop().trim();
    try {
      parsed = JSON.parse(last);
    } catch {
      return null;
    }
  }
  const instruction = typeof parsed?.system_instruction === 'string' ? parsed.system_instruction.trim() : '';
  if (!instruction) return null;
  const policy = parsed?.policy?.name;
  const register = parsed?.policy?.register;
  const header = policy
    ? `[eq-layer] politika: ${policy}${register ? ` (${register})` : ''}`
    : '[eq-layer] steering:';
  const full = `${header}\n${instruction}`;
  return full.length > MAX_STEERING_CHARS ? `${full.slice(0, MAX_STEERING_CHARS)}…` : full;
}

/** Path 1: direct call to the installed Python API (portable lightweight heuristic). */
async function tryPortable(inputJson) {
  const py = resolvePython();
  if (!py) return null;
  const stdout = await runProcess(py, ['-X', 'utf8', '-I', '-c', PY_ROUTE_SCRIPT], inputJson);
  return parseRouteOutput(stdout);
}

/** Find the eq-layer console script on PATH or in Python Scripts/bin. */
function findEqLayerExe() {
  const py = resolvePython();
  if (py && path.isAbsolute(py)) {
    const found = findPythonScript(py, 'eq-layer');
    if (found) return found;
  }
  const names = process.platform === 'win32' ? ['eq-layer.exe', 'eq-layer'] : ['eq-layer', 'eq-layer.exe'];
  const candidates = [];
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (!dir) continue;
    for (const n of names) candidates.push(path.join(dir, n));
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Path 2: eq-layer console script. */
async function tryCli(inputJson) {
  const exe = findEqLayerExe();
  if (!exe) return null;
  const stdout = await runProcess(exe, ['route', '--intent-mode', 'heuristic'], inputJson);
  return parseRouteOutput(stdout);
}

/**
 * Produce the eq-layer routing result.
 * @param {{ messages?: Array<{role: string, content: string}>, workspaceRoot?: string }} opts
 *   messages: [{role, content}, ...] — the last ~6 messages are sufficient (filtered to match the contract).
 *   workspaceRoot: accepted for API compatibility; eq-layer routing is independent of the workspace.
 * @returns {Promise<{steering: string, source: string} | null>}
 *   Return null if the package is missing, disabled, or any step fails.
 */
export async function buildSteering({ messages, workspaceRoot } = {}) {
  if (process.env.SCI_AGENT_EQ_DISABLE === '1') return null;
  const input = normalizeMessages(messages);
  if (!input) return null;
  const inputJson = JSON.stringify(input);
  try {
    let t = transport;
    if (t === undefined) {
      if ((await tryPortable(inputJson)) !== null) t = 'portable';
      else if ((await tryCli(inputJson)) !== null) t = 'cli';
      else {
        t = null;
        warn('eq-layer not found/failed; steering layer disabled for this session.');
      }
      transport = t;
    }
    if (t === null) return null;
    const steering = t === 'portable' ? await tryPortable(inputJson) : await tryCli(inputJson);
    if (!steering) return null; // cached route failed this turn; return null silently
    return { steering, source: t };
  } catch (e) {
    warn(`beklenmeyen hata: ${e?.message ?? e}`);
    return null;
  }
}
