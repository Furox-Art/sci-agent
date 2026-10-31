import { createServer } from 'node:http';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, createProvider, ToolRegistry, runAgentLoop, buildSystemPrompt } from '@sci/core';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');
const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.json': 'application/json',
};

export async function startServer({ port = 8765, host = '127.0.0.1', workspace = process.cwd() } = {}) {
  const cfg = loadConfig(workspace);
  const state = {
    busy: false,
    res: null,
    pending: new Map(),
    messages: [{ role: 'system', content: buildSystemPrompt(cfg) }],
  };

  const emit = (ev) => {
    const res = state.res;
    if (!res) return;
    try {
      res.write(`data: ${JSON.stringify(ev)}\n\n`);
    } catch {}
  };

  const registry = new ToolRegistry({
    workspaceRoot: cfg.agent.workspaceRoot,
    autoApprove: cfg.policies.autoApprove,
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
          await runAgentLoop({ provider, registry, messages: state.messages, maxSteps: cfg.agent.maxSteps, onEvent: emit });
          emit({ type: 'done' });
        } catch (e) {
          emit({ type: 'error', text: e.message });
          emit({ type: 'done' });
        } finally {
          state.busy = false;
          state.res = null;
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
