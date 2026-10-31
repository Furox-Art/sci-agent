/**
 * eq-layer otomatik yönlendirme katmanı.
 *
 * Her kullanıcı turunda model çağrılmadan ÖNCE kurulu eq-layer Python paketi
 * (pip: eq-layer) çalıştırılır; kullanıcının niyeti/duygu durumu/repair ihtiyacı
 * çıkarılır ve seçilen yanıt politikasına ait system_instruction metni, o turun
 * sistem istemine eklenecek yönlendirme (steering) olarak döndürülür. Kalıcı
 * sohbet geçmişi burada değiştirilmez.
 *
 * Yol önceliği (en hafif güvenilir yol seçilir):
 *   1. 'portable' — kurulu pakete doğrudan Python API çağrısı
 *      (python -X utf8 -I -c … ; JSON girdi stdin'den, JSON çıktı stdout'tan;
 *      bağımlılık gerektirmeyen heuristic yol tercih edilir),
 *   2. 'cli'      — eq-layer.exe konsol betiği (Python Scripts dizini veya PATH).
 *
 * Kullanılabilirlik bir kez tespit edilip modül değişkeninde cache'lenir;
 * SCI_AGENT_EQ_DISABLE=1 ise her çağrı null döner. Her hata sessizce null'a
 * düşer; süreç başına ~20 sn timeout uygulanır. Uygulama asla bloklanmaz.
 */

import { spawn } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { resolvePython, pythonScriptsDir } from '../science/pybridge.js';

const TIMEOUT_MS = 20_000;
const MAX_STEERING_CHARS = 4000;

// eq-layer CLI sözleşmesi: route alt komutu stdin'den [{role, content}, ...] okur,
// stdout'a tek satırlık JSON yazar (system_instruction alanı yönlendirme metnidir).
// 'heuristic' mod öğrenilmiş ML bileşenlerini yüklemez: portable/hafif yol.
const PY_ROUTE_SCRIPT =
  "import sys; from eq_layer.cli import main; sys.exit(main(['route', '--intent-mode', 'heuristic']))";

/** 'portable' | 'cli' | null — bir kez tespit edilir, sonraki çağrılar cache'i kullanır. */
let transport;
let warned = false;

function warn(message) {
  if (warned) return;
  warned = true;
  console.error(`[eq-layer] ${message}`);
}

/**
 * Mesajları eq-layer girdi sözleşmesine göre süzer: yalnızca user/assistant/system
 * rolleri ve boş olmayan metin içerikler kalır; en az bir kullanıcı mesajı yoksa
 * eq-layer'a gitmenin anlamı yoktur.
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

/** Tek bir alt süreç çalıştırır; hata/timeout durumunda null döner (asla throw etmez). */
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

/** CLI çıktısını ayrıştırır; yönlendirme metni (kısa başlık + system_instruction) üretir. */
function parseRouteOutput(stdout) {
  if (!stdout || !stdout.trim()) return null;
  let parsed;
  try {
    parsed = JSON.parse(stdout.trim());
  } catch {
    // Uyarılar stdout'a karıştıysa son satır hâlâ JSON olabilir.
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
    : '[eq-layer] yönlendirme:';
  const full = `${header}\n${instruction}`;
  return full.length > MAX_STEERING_CHARS ? `${full.slice(0, MAX_STEERING_CHARS)}…` : full;
}

/** Yol 1: kurulu pakete doğrudan Python API çağrısı (portable, öğrenimsiz hafif yol). */
async function tryPortable(inputJson) {
  const py = resolvePython();
  if (!py) return null;
  const stdout = await runProcess(py, ['-X', 'utf8', '-I', '-c', PY_ROUTE_SCRIPT], inputJson);
  return parseRouteOutput(stdout);
}

/** PATH üzerinde ve Python Scripts dizininde eq-layer.exe arar. */
function findEqLayerExe() {
  const py = resolvePython();
  const candidates = [];
  if (py && path.isAbsolute(py)) candidates.push(path.join(pythonScriptsDir(py), 'eq-layer.exe'));
  for (const dir of (process.env.PATH ?? '').split(path.delimiter)) {
    if (dir) candidates.push(path.join(dir, 'eq-layer.exe'));
  }
  return candidates.find((c) => existsSync(c)) ?? null;
}

/** Yol 2: eq-layer.exe konsol betiği. */
async function tryCli(inputJson) {
  const exe = findEqLayerExe();
  if (!exe) return null;
  const stdout = await runProcess(exe, ['route', '--intent-mode', 'heuristic'], inputJson);
  return parseRouteOutput(stdout);
}

/**
 * eq-layer routing sonucunu üretir.
 * @param {{ messages?: Array<{role: string, content: string}>, workspaceRoot?: string }} opts
 *   messages: [{role, content}, ...] — son ~6 mesaj yeterlidir (süzülüp sözleşmeye uyarlanır).
 *   workspaceRoot: API uyumluluğu için kabul edilir; eq-layer route'u çalışma alanına bağlı değildir.
 * @returns {Promise<{steering: string, source: string} | null>}
 *   Paket yoksa, devre dışıysa veya herhangi bir adım hata verirse null.
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
        warn('eq-layer bulunamadı/çalışmadı; yönlendirme katmanı bu oturumda devre dışı.');
      }
      transport = t;
    }
    if (t === null) return null;
    const steering = t === 'portable' ? await tryPortable(inputJson) : await tryCli(inputJson);
    if (!steering) return null; // cache'lenmiş yol bu turda çalışmadı → sessiz null
    return { steering, source: t };
  } catch (e) {
    warn(`beklenmeyen hata: ${e?.message ?? e}`);
    return null;
  }
}
