import { createServer } from 'node:http';
import { existsSync, mkdirSync, readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { loadConfig, createProvider, createRegistry, runAgentLoop, buildSystemPrompt, resolveSafe, toolGroup, fetchSkill, skillsSystemText } from '@sci/core';
import { buildSteering } from '../core/src/eq/eq-layer.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const UI_DIR = path.join(__dirname, 'ui');
const VERSION = JSON.parse(readFileSync(path.join(__dirname, '../../package.json'), 'utf8')).version;
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
    abort: null,
    messages: [{ role: 'system', content: buildSystemPrompt(cfg) }],
  };

  // Oturum kalıcılığı: her oturum .sci-agent-sessions/<id>.json (CLI ile paylaşımlı, git'e girmez)
  const sessionsDir = path.join(cfg.agent.workspaceRoot, '.sci-agent-sessions');
  mkdirSync(sessionsDir, { recursive: true });
  const legacy = path.join(cfg.agent.workspaceRoot, '.sci-agent-history.json');
  const readSession = (id) => {
    try {
      const d = JSON.parse(readFileSync(path.join(sessionsDir, `${id}.json`), 'utf8'));
      return Array.isArray(d.messages) ? d : null;
    } catch {
      return null;
    }
  };
  const writeSession = (id, title, messages) => {
    try {
      writeFileSync(path.join(sessionsDir, `${id}.json`), JSON.stringify({ id, title, updatedAt: new Date().toISOString(), messages }));
    } catch {}
  };
  const listSessions = () => {
    try {
      return readdirSync(sessionsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            return JSON.parse(readFileSync(path.join(sessionsDir, f), 'utf8'));
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => String(b.updatedAt ?? '').localeCompare(String(a.updatedAt ?? '')));
    } catch {
      return [];
    }
  };
  // Geçiş: eski .sci-agent-history.json → "varsayılan" oturumu
  if (!listSessions().length && existsSync(legacy)) {
    try {
      const msgs = JSON.parse(readFileSync(legacy, 'utf8'));
      if (Array.isArray(msgs)) writeSession('default', 'varsayılan', msgs);
    } catch {}
  }
  const first = listSessions()[0];
  if (first?.messages) state.messages = first.messages;
  state.sessionId = first?.id ?? 'default';
  state.sessionTitle = first?.title ?? 'varsayılan';
  if (!first) writeSession(state.sessionId, state.sessionTitle, state.messages);
  const saveActive = () => writeSession(state.sessionId, state.sessionTitle, state.messages);
  const setActive = (id) => {
    const s = readSession(id);
    if (!s) return false;
    state.sessionId = s.id;
    state.sessionTitle = s.title;
    state.messages = s.messages;
    return true;
  };

  // GitHub becerileri: yapılandırmadaki kaynakları yükler (hatalar nazikçe raporlanır)
  state.skills = [];
  state.skillErrors = [];
  let skillsLoading = false;
  const ensureSkills = async () => {
    if (skillsLoading) return;
    skillsLoading = true;
    try {
      for (const source of cfg.skills?.sources ?? []) {
        if (state.skills.some((s) => s.source === source)) continue;
        if (state.skillErrors.some((x) => x.source === source)) continue;
        try {
          state.skills.push(await fetchSkill(source));
        } catch (e) {
          state.skillErrors.push({ source, error: String(e.message).slice(0, 200) });
        }
      }
    } finally {
      skillsLoading = false;
    }
  };
  const persistSkills = (sources) => {
    const file = path.join(cfg.agent.workspaceRoot, 'sci-agent.config.json');
    let cur = {};
    try {
      cur = JSON.parse(readFileSync(file, 'utf8'));
    } catch {}
    cur.skills = { sources };
    writeFileSync(file, JSON.stringify(cur, null, 2));
  };
  ensureSkills(); // açılışta arka planda yükle

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
            emit({ type: 'approval_result', id, approved: false, timeout: true });
            resolve(false);
          }
        }, 5 * 60_000).unref();
      }),
  });


  const server = createServer(async (req, res) => {
    const url = new URL(req.url, 'http://localhost');
    try {
      if (url.pathname === '/api/health') return json(res, { ok: true, version: VERSION });

      if (url.pathname === '/api/config' && req.method === 'GET') {
        return json(res, {
          model: { provider: cfg.model.provider, baseUrl: cfg.model.baseUrl, name: cfg.model.name, hasKey: Boolean(cfg.model.apiKey) },
          workspaceRoot: cfg.agent.workspaceRoot,
          tools: registry.list().map((t) => ({ ...t, group: toolGroup(t.name) })),
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
        if (state.busy) return json(res, { error: 'Ajan çalışıyor; temizlenemez' }, 409);
        state.messages = [{ role: 'system', content: buildSystemPrompt(cfg) }];
        saveActive();
        return json(res, { ok: true });
      }

      if (url.pathname === '/api/stop' && req.method === 'POST') {
        if (!state.abort) return json(res, { ok: false, error: 'Çalışan görev yok' }, 409);
        state.abort.abort();
        return json(res, { ok: true });
      }

      if (url.pathname === '/api/agent-skills' && req.method === 'GET') {
        await ensureSkills();
        return json(res, {
          sources: cfg.skills?.sources ?? [],
          loaded: state.skills.map(({ source, name, description }) => ({ source, name, description })),
          errors: state.skillErrors,
        });
      }

      if (url.pathname === '/api/agent-skills' && req.method === 'POST') {
        const b = await readBody(req);
        const source = String(b.source ?? '').trim();
        if (!source.startsWith('github:')) return json(res, { error: 'Kaynak "github:kullanici/depo" biçiminde olmalı' }, 400);
        try {
          const skill = await fetchSkill(source);
          if (!cfg.skills?.sources.includes(source)) {
            cfg.skills = cfg.skills ?? { sources: [] };
            cfg.skills.sources.push(source);
            persistSkills(cfg.skills.sources);
          }
          if (!state.skills.some((s) => s.source === source)) state.skills.push(skill);
          return json(res, { ok: true, skill: { source, name: skill.name, description: skill.description } });
        } catch (e) {
          return json(res, { error: String(e.message).slice(0, 300) }, 502);
        }
      }

      if (url.pathname === '/api/agent-skills/remove' && req.method === 'POST') {
        const b = await readBody(req);
        const source = String(b.source ?? '');
        cfg.skills = cfg.skills ?? { sources: [] };
        cfg.skills.sources = cfg.skills.sources.filter((s) => s !== source);
        state.skills = state.skills.filter((s) => s.source !== source);
        persistSkills(cfg.skills.sources);
        return json(res, { ok: true });
      }

      if (url.pathname === '/api/approve' && req.method === 'POST') {
        const b = await readBody(req);
        const resolve = state.pending.get(b.id);
        if (!resolve) return json(res, { ok: false, error: 'Bekleyen onay yok' }, 404);
        state.pending.delete(b.id);
        // "Bu oturumda bu araca izin ver": araç bu çalışmada bir daha onay sormaz.
        if (b.remember && b.approved && typeof b.tool === 'string' && !registry.autoApprove.includes(b.tool)) {
          registry.autoApprove.push(b.tool);
        }
        resolve(Boolean(b.approved));
        emit({ type: 'approval_result', id: b.id, approved: Boolean(b.approved) });
        return json(res, { ok: true });
      }

      if (url.pathname === '/api/sessions' && req.method === 'GET') {
        return json(res, {
          active: state.sessionId,
          sessions: listSessions().map(({ id, title, updatedAt, messages }) => ({
            id,
            title,
            updatedAt,
            count: Array.isArray(messages) ? Math.max(0, messages.length - 1) : 0,
          })),
        });
      }

      if (url.pathname === '/api/sessions' && req.method === 'POST') {
        if (state.busy) return json(res, { error: 'Ajan çalışıyor; oturum değiştirilemez' }, 409);
        const b = await readBody(req).catch(() => ({}));
        const id = crypto.randomUUID();
        const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim() : 'yeni oturum';
        state.messages = [{ role: 'system', content: buildSystemPrompt(cfg) }];
        state.sessionId = id;
        state.sessionTitle = title;
        writeSession(id, title, state.messages);
        return json(res, { ok: true, id, title });
      }

      if (url.pathname === '/api/sessions/switch' && req.method === 'POST') {
        if (state.busy) return json(res, { error: 'Ajan çalışıyor; oturum değiştirilemez' }, 409);
        const b = await readBody(req);
        if (!setActive(String(b.id ?? ''))) return json(res, { error: 'Oturum bulunamadı' }, 404);
        return json(res, { ok: true, id: state.sessionId, title: state.sessionTitle });
      }

      if (url.pathname === '/api/sessions/rename' && req.method === 'POST') {
        if (state.busy) return json(res, { error: 'Ajan çalışıyor; oturum yeniden adlandırılamaz' }, 409);
        const b = await readBody(req);
        const s = readSession(String(b.id ?? ''));
        if (!s) return json(res, { error: 'Oturum bulunamadı' }, 404);
        const title = typeof b.title === 'string' && b.title.trim() ? b.title.trim().slice(0, 60) : s.title;
        writeSession(String(b.id), title, s.messages);
        if (state.sessionId === b.id) state.sessionTitle = title;
        return json(res, { ok: true, title });
      }

      if (url.pathname === '/api/sessions/delete' && req.method === 'POST') {
        if (state.busy) return json(res, { error: 'Ajan çalışıyor; oturum silinemez' }, 409);
        const b = await readBody(req);
        const file = path.join(sessionsDir, `${String(b.id ?? '')}.json`);
        if (existsSync(file)) unlinkSync(file);
        if (state.sessionId === b.id) {
          const rest = listSessions();
          if (rest.length) setActive(rest[0].id);
          else {
            state.messages = [{ role: 'system', content: buildSystemPrompt(cfg) }];
            state.sessionId = crypto.randomUUID();
            state.sessionTitle = 'yeni oturum';
            writeSession(state.sessionId, state.sessionTitle, state.messages);
          }
        }
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
        if (!rel.trim()) return json(res, { error: 'path gerekli' }, 400);
        const abs = resolveSafe(cfg.agent.workspaceRoot, rel);
        const st = await stat(abs);
        if (st.isDirectory()) return json(res, { error: 'Bu bir dizin; dosya bekleniyor' }, 400);
        if (st.size > 2_000_000) return json(res, { error: 'Dosya çok büyük (>2 MB)' }, 400);
        const text = (await readFile(abs, 'utf8')).replace(/^\uFEFF/, '');
        const lines = text.split(/\r?\n/).filter((l) => l.trim() !== '');
        if (lines.length < 2) return json(res, { error: 'CSV en az başlık + 1 satır içermeli' }, 400);
        const columns = lines[0].split(',').map((h) => h.trim());
        const rows = lines.slice(1, 5001).map((l) => l.split(','));
        const numeric = {};
        columns.forEach((col, i) => {
          const nums = rows.map((r) => Number(r[i])).filter((v) => Number.isFinite(v));
          if (nums.length >= Math.max(1, Math.floor(rows.length * 0.6))) numeric[col] = nums;
        });
        // X ekseni etiketleri: ilk sayısal olmayan (metin) sütun
        let labelName = null;
        let labels = [];
        for (let i = 0; i < columns.length; i++) {
          if (numeric[columns[i]]) continue;
          const vals = rows.map((r) => (r[i] ?? '').trim()).filter(Boolean);
          if (vals.length >= Math.floor(rows.length * 0.5)) {
            labelName = columns[i];
            labels = vals;
            break;
          }
        }
        const sampleRows = rows.slice(0, 20).map((r) => {
          const o = {};
          columns.forEach((c, i) => (o[c] = (r[i] ?? '').trim()));
          return o;
        });
        return json(res, { path: rel, columns, rowCount: rows.length, numeric, labelName, labels, sample: { columns, rows: sampleRows } });
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
        // İlk mesaj oturum başlığı olur.
        if (state.sessionTitle === 'yeni oturum' || !state.sessionTitle) {
          state.sessionTitle = message.slice(0, 40);
        }
        const ac = new AbortController();
        state.abort = ac;
        try {
          const provider = createProvider(cfg.model);
          // eq-layer yönlendirmesi: model çağrısından önce niyet/duygu politikası çıkar;
          // hata olursa /api/chat hiçbir koşulda patlamaz (systemExtra tanımsız kalır).
          let systemExtra;
          const skillText = skillsSystemText(state.skills);
          try {
            const steer = await buildSteering({ messages: state.messages.slice(-6), workspaceRoot: cfg.agent.workspaceRoot });
            systemExtra = [skillText, steer?.steering].filter(Boolean).join('\n\n') || undefined;
            if (steer?.steering) {
              emit({ type: 'info', text: `eq-layer yönlendirmesi: ${steer.source}` });
            }
          } catch {
            systemExtra = skillText || undefined;
          }
          await runAgentLoop({ provider, registry, messages: state.messages, maxSteps: cfg.agent.maxSteps, onEvent: emit, systemExtra, signal: ac.signal });
          emit({ type: 'done' });
        } catch (e) {
          const aborted = e?.name === 'AbortError' || /abort/i.test(String(e?.message));
          emit({ type: 'error', text: aborted ? 'Görev kullanıcı tarafından durduruldu.' : e.message });
          emit({ type: 'done' });
        } finally {
          state.busy = false;
          state.res = null;
          state.abort = null;
          saveActive();
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
