import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { startServer } from '../packages/desktop/server.js';

process.env.SCI_AGENT_PROVIDER = 'mock';

async function makeServer(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-srv-'));
  const handle = await startServer({ workspace: root, port: 0 });
  t.after(() => handle.close());
  return { base: `http://127.0.0.1:${handle.port}`, root, handle };
}

const jpost = (base, p, body) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

test('health uç noktası çalışır', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/health');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('oturum oluştur / listele / geç / sil akışı', async (t) => {
  const { base } = await makeServer(t);
  const s0 = await (await fetch(base + '/api/sessions')).json();
  assert.ok(s0.sessions.length >= 1);

  const created = await (await jpost(base, '/api/sessions')).json();
  const s1 = await (await fetch(base + '/api/sessions')).json();
  assert.equal(s1.active, created.id);
  assert.equal(s1.sessions.length, s0.sessions.length + 1);

  const sw = await (await jpost(base, '/api/sessions/switch', { id: s0.active })).json();
  assert.equal(sw.ok, true);

  const del = await (await jpost(base, '/api/sessions/delete', { id: created.id })).json();
  assert.equal(del.ok, true);
  const s2 = await (await fetch(base + '/api/sessions')).json();
  assert.equal(s2.sessions.some((x) => x.id === created.id), false);
});

test('sohbet sonrası geçmiş kaydedilir ve okunur', async (t) => {
  const { base } = await makeServer(t);
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'geçmiş testi' }),
  });
  assert.equal(res.status, 200);
  const text = await res.text();
  assert.match(text, /"type":"done"/);

  const h = await (await fetch(base + '/api/history')).json();
  const roles = h.messages.map((m) => m.role);
  assert.ok(roles.includes('user'));
  assert.ok(roles.includes('assistant'));
});

test('mock sağlayıcı ile sohbet SSE olayları tam', async (t) => {
  const { base } = await makeServer(t);
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'sse testi' }),
  });
  const text = await res.text();
  const types = [...text.matchAll(/"type":"([a-z_]+)"/g)].map((m) => m[1]);
  assert.equal(types[0], 'start');
  assert.ok(types.includes('tool_call'));
  assert.ok(types.includes('tool_result'));
  assert.equal(types.at(-1), 'done');
});

test('boş mesaj 400 döner', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  });
  assert.equal(r.status, 400);
});

test('csv uç noktası sayısal sütun ve etiket döndürür', async (t) => {
  const { base, root } = await makeServer(t);
  await fs.writeFile(path.join(root, 'veri.csv'), 'donem,deger\nOca,10\nSub,20\nMar,30\n', 'utf8');
  const r = await fetch(base + '/api/csv?path=' + encodeURIComponent('veri.csv'));
  const d = await r.json();
  assert.equal(d.rowCount, 3);
  assert.deepEqual(d.numeric.deger, [10, 20, 30]);
  assert.equal(d.labelName, 'donem');
  assert.deepEqual(d.labels, ['Oca', 'Sub', 'Mar']);
});

test('bilinmeyen API 404 döner', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/yok');
  assert.equal(r.status, 404);
});
