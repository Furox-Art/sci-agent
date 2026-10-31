import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, createProvider, createRegistry, runAgentLoop, buildSystemPrompt, resolveSafe } from '@sci/core';
import { buildSteering } from '../core/src/eq/eq-layer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
  '.png': 'image/png',
};

export async function startServer({ port = 8765, host = '127.0.0.1', workspace = process.cwd() } = {}) {
  const cfg = loadConfig(workspace);
  const state = {
    busy: false,
    res: null,
    pending: new Map(),
    messages: [{ role: 'system', content: buildSystemPrompt(cfg) }],
  };

  // Sohbet geçmişi kalıcılığı (çalışma alanında, git'e girmez)
  const historyFile = path.join(cfg.agent.workspaceRoot, '.sci-agent-history.json');
  try {
    const saved = JSON.parse(readFileSync(historyFile, 'utf8'));
    if (Array.isArray(saved) && saved.length) state.messages = saved;
  } catch {}
  const saveHistory = () => {
    try {
      writeFileSync(historyFile, JSON.stringify(state.messages));
    } catch {}
  };

  const emit = (ev) => {
    const res = state.res;
    if (!res) return;
    try {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch {}
  };

  const registry = createRegistry({
    cfg,
    approve: (name, args) =>
      new Promise((resolve) => {
        const id = crypto.randomUUID();
        state.pending.set(id, resolve);
        emit({ type: 'approval_request', id, name, args });
        // Bekleyen onay 5 dakika sonra otomatik reddedilir.
        setTimeout(() => {
          if (state.pending.has(id)) {
            state.pending.delete(id);
            resolve(false);
          }
        }, 5 * 60_000).unref();
      }),
  });


  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/health') return json(res, { ok: true });

      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json(res, {
          model: { provider: cfg.model.provider, baseUrl: cfg.model.baseUrl, name: cfg.model.name, hasKey: Boolean(cfg.model.apiKey) },
          workspaceRoot: cfg.agent.workspaceRoot,
          tools: registry.list(),
        });
      }

      if (url.pathname === '/api/config' && req.method === 'POST') {
        const b = await readBody(req);
        const updates = {};
        for (const k of ['provider', 'baseUrl', 'name']) {
          if (typeof b[k] === 'string' && b[k].trim()) updates[k] = b[k].trim();
        }
        if (typeof b.apiKey === 'string' && b.apiKey.length > 0) updates.apiKey = b.apiKey;
        Object.assign(cfg.model, updates);
        persistModel(cfg.agent.workspaceRoot, updates);
        return json(res, { ok: true, model: { provider: cfg.model.provider, baseUrl: cfg.model.baseUrl, name: cfg.model.name, hasKey: Boolean(cfg.model.apiKey) } });
      }

      if (url.pathname === '/api/clear' && req.method === 'POST') {
        state.messages = [{ role: 'system', content: buildSystemPrompt(cfg) }];
        return json(res, { ok: true });
      }

      if (url.pathname === '/api/approve' && req.method === 'POST') {
        const b = await readBody(req);
        const resolve = state.pending.get(b.id);
        if (!resolve) return json(res, { ok: false, error: 'Bekleyen onay yok' }, 404);
        state.pending.delete(b.id);
        resolve(Boolean(b.approved));
        emit({ type: 'approval_result', id: b.id, approved: Boolean(b.approved) });
        return json(res, { ok: true });
      }

      if (url.pathname === '/api/history' && req.method === 'GET') {
        return json(res, { messages: state.messages.filter((m) => m.role !== 'system') });
      }

      // Model bağlantı testi (Ayarlar'daki "Bağlantıyı Test Et")
      if (url.pathname === '/api/test-model' && req.method === 'POST') {
        const b = await readBody(req);
        const testCfg = {
          ...cfg.model,
          ...(typeof b.provider === 'string' && b.provider.trim() ? { provider: b.provider.trim() } : {}),
          ...(typeof b.baseUrl === 'string' && b.baseUrl.trim() ? { baseUrl: b.baseUrl.trim() } : {}),
          ...(typeof b.name === 'string' && b.name.trim() ? { name: b.name.trim() } : {}),
          ...(typeof b.apiKey === 'string' && b.apiKey ? { apiKey: b.apiKey } : {}),
        };
        const t0 = Date.now();
        try {
          const provider = createProvider(testCfg);
          const out = await provider.chat({ messages: [{ role: 'user', content: 'Yalnızca "ok" yaz.' }] });
          return json(res, { ok: true, ms: Date.now() - t0, sample: String(out.content ?? '').slice(0, 60) });
        } catch (e) {
          return json(res, { ok: false, ms: Date.now() - t0, error: String(e.message).slice(0, 300) });
        }
      }

      if (url.pathname === '/api/csv' && req.method === 'GET') {
        const rel = url.searchParams.get('path') ?? '';
        const abs = resolveSafe(cfg.agent.workspaceRoot, rel);
        const st = await stat(abs);
        if (st.size > 2_000_000) return json(res, { error: 'Dosya çok büyük (>2 MB)' }, 400);
        const text = (await readFile(abs, 'utf8')).replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
        if (lines.length < 2) return json(res, { error: 'CSV en az başlık + 1 satır içermeli' }, 400);
        const columns = lines[0].split(',').map((h) => h.trim());
        const rows = lines.slice(1, 5001).map((l) => l.split(','));
        const numeric = {};
        columns.forEach((col, i) => {
          const nums = rows.map((r) => Number(r[i])).filter((v) => Number.isFinite(v));
          if (nums.length >= Math.max(2, Math.floor(rows.length * 0.6))) numeric[col] = nums;
        });
        return json(res, { path: rel, columns, rowCount: rows.length, numeric });
      }

      if (url.pathname === '/api/chat' && req.method === 'POST') {
        if (state.busy) return json(res, { error: 'Ajan şu an meşgul' }, 409);
        const b = await readBody(req);
        const message = String(b.message ?? '').trim();
        if (!message) return json(res, { error: 'Boş mesaj' }, 400);

        state.busy = true;
        res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache', connection: 'keep-alive' });
        res.flushHeaders?.();
        state.res = res;
        req.on('close', () => {
          state.res = null;
        });

        emit({ type: 'start' });
        state.messages.push({ role: 'user', content: message });
        try {
          const provider = createProvider(cfg.model);
          // eq-layer yönlendirmesi: model çağrısından önce niyet/duygu politikası çıkar;
          // hata olursa /api/chat hiçbir koşulda patlamaz (systemExtra tanımsız kalır).
          let systemExtra;
          try {
            const steer = await buildSteering({ messages: state.messages.slice(-6), workspaceRoot: cfg.agent.workspaceRoot });
            if (steer?.steering) {
              systemExtra = steer.steering;
              emit({ type: 'info', text: `eq-layer yönlendirmesi: ${steer.source}` });
            }
          } catch {}
          await runAgentLoop({ provider, registry, messages: state.messages, maxSteps: cfg.agent.maxSteps, onEvent: emit, systemExtra });
          emit({ type: 'done' });
        } catch (e) {
          emit({ type: 'error', text: e.message });
          emit({ type: 'done' });
        } finally {
          state.busy = false;
          state.res = null;
          saveHistory();
          res.end();
        }
        return;
      }

      if (req.method === 'GET') {
        const rel = url.pathname === '/' ? 'index.html' : url.pathname.slice(1);
        const abs = path.resolve(UI_DIR, rel);
        if (abs.startsWith(UI_DIR) && existsSync(abs)) {
          res.writeHead(200, { 'content-type': MIME[path.extname(abs)] ?? 'application/octet-stream' });
          return res.end(await readFile(abs));
        }
      }

      res.writeHead(404, { 'content-type': 'application/json' });
      res.end(JSON.stringify({ error: 'bulunamadı' }));
    } catch (e) {
      json(res, { error: e.message }, 500);
    }
  });

  await new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(port, host, resolve);
  });
  return { port: server.address().port, close: () => new Promise((r) => server.close(r)) };
}

function json(res, data, code = 200) {
  res.writeHead(code, { 'content-type': 'application/json' });
  res.end(JSON.stringify(data));
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    let d = '';
    req.on('data', (c) => {
      d += c;
      if (d.length > 5e6) reject(new Error('Gövde çok büyük'));
    });
    req.on('end', () => {
      try {
        resolve(d ? JSON.parse(d) : {});
      } catch {
        reject(new Error('Geçersiz JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** Yalnızca verilen alanları yapılandırma dosyasına yazar (dosya .gitignore'dadır). */
function persistModel(workspaceRoot, updates) {
  if (!Object.keys(updates).length) return;
  const file = path.join(workspaceRoot, 'sci-agent.config.json');
  let cur = {};
  try {
    cur = JSON.parse(readFileSync(file, 'utf8'));
  } catch {}
  cur.model = { ...(cur.model ?? {}), ...updates };
  writeFileSync(file, JSON.stringify(cur, null, 2));
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  const port = Number(process.env.SCI_AGENT_PORT) || 8765;
  const { port: p } = await startServer({ port });
  console.log(`SciAgent arayüzü: http://127.0.0.1:${p}`);
}
