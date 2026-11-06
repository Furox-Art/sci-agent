import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { startServer, resolveWorkspace } from '../packages/desktop/server.js';

process.env.SCI_AGENT_PROVIDER = 'mock';

test('resolveWorkspace: --workspace arg beats env, env beats cwd', () => {
  const cwd = process.cwd();
  const a = resolveWorkspace({ argv: ['--workspace', 'C:\\tmp\\ws'], env: { SCI_AGENT_WORKSPACE: 'C:\\tmp\\env' } });
  assert.equal(a, path.resolve('C:\\tmp\\ws'));
  const b = resolveWorkspace({ argv: [], env: { SCI_AGENT_WORKSPACE: 'C:\\tmp\\env' } });
  assert.equal(b, path.resolve('C:\\tmp\\env'));
  const c = resolveWorkspace({ argv: [], env: {} });
  assert.equal(c, cwd);
});

async function makeServer(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-srv-'));
  const handle = await startServer({ workspace: root, port: 0 });
  t.after(() => handle.close());
  return { base: `http://127.0.0.1:${handle.port}`, root, handle };
}

const jpost = (base, p, body) =>
  fetch(base + p, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body ?? {}) });

test('health endpoint works', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/health');
  assert.equal(r.status, 200);
  assert.equal((await r.json()).ok, true);
});

test('session create/list/switch/delete flow', async (t) => {
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

test('history saved and readable after chat', async (t) => {
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

test('chat SSE events complete with mock provider', async (t) => {
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

test('empty message returns 400', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: '' }),
  });
  assert.equal(r.status, 400);
});

test('clear resets history', async (t) => {
  const { base } = await makeServer(t);
  const res = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ message: 'doldur' }),
  });
  await res.text(); // wait until the SSE stream ends
  let h = await (await fetch(base + '/api/history')).json();
  assert.ok(h.messages.length >= 2);
  const c = await (await jpost(base, '/api/clear')).json();
  assert.equal(c.ok, true);
  h = await (await fetch(base + '/api/history')).json();
  assert.equal(h.messages.length, 0);
});

test('single-row CSV works with numeric column', async (t) => {
  const { base, root } = await makeServer(t);
  await fs.writeFile(path.join(root, 'tek.csv'), 'deger\n42\n', 'utf8');
  const d = await (await fetch(base + '/api/csv?path=' + encodeURIComponent('tek.csv'))).json();
  assert.deepEqual(d.numeric.deger, [42]);
  assert.equal(d.rowCount, 1);
});

test('csv endpoint returns numeric column and labels', async (t) => {
  const { base, root } = await makeServer(t);
  await fs.writeFile(path.join(root, 'veri.csv'), 'donem,deger\nOca,10\nSub,20\nMar,30\n', 'utf8');
  const r = await fetch(base + '/api/csv?path=' + encodeURIComponent('veri.csv'));
  const d = await r.json();
  assert.equal(d.rowCount, 3);
  assert.deepEqual(d.numeric.deger, [10, 20, 30]);
  assert.equal(d.labelName, 'donem');
  assert.deepEqual(d.labels, ['Oca', 'Sub', 'Mar']);
});

test('csv missing path returns 400', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/csv');
  assert.equal(r.status, 400);
});

test('csv directory path returns 400', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/csv?path=' + encodeURIComponent('.'));
  assert.equal(r.status, 400);
});

test('unknown API returns 404', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/yok');
  assert.equal(r.status, 404);
});

// ===== Security audit fixes =====

test('session id traversal is rejected (no arbitrary .json read/write/delete)', async (t) => {
  const { base, root } = await makeServer(t);
  const victim = path.join(root, 'keep.json');
  await fs.writeFile(victim, '{"keep":true}', 'utf8');

  const del = await jpost(base, '/api/sessions/delete', { id: '../keep' });
  assert.equal(del.status, 400);
  assert.equal(await fs.readFile(victim, 'utf8'), '{"keep":true}', 'delete must not escape .sci-agent-sessions');

  const sw = await jpost(base, '/api/sessions/switch', { id: '../../keep' });
  assert.equal(sw.status, 404);

  const rn = await jpost(base, '/api/sessions/rename', { id: '../keep', title: 'pwn' });
  assert.equal(rn.status, 404);
  assert.equal(await fs.readFile(victim, 'utf8'), '{"keep":true}', 'rename must not write outside .sci-agent-sessions');
});

test('csv path traversal and absolute paths are blocked with 400', async (t) => {
  const { base, root } = await makeServer(t);
  const outside = path.join(path.dirname(root), 'dis.csv');
  await fs.writeFile(outside, 'a,b\n1,2\n', 'utf8');
  t.after(() => fs.rm(outside, { force: true }));

  for (const p of ['../dis.csv', outside, 'sub/../../dis.csv']) {
    const r = await fetch(base + '/api/csv?path=' + encodeURIComponent(p));
    assert.equal(r.status, 400, p);
  }
});

test('csv missing file returns 404', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/csv?path=' + encodeURIComponent('yok.csv'));
  assert.equal(r.status, 404);
});

test('config POST writes only the four model fields', async (t) => {
  const { base, root } = await makeServer(t);
  const r = await jpost(base, '/api/config', {
    provider: 'mock',
    baseUrl: 'http://127.0.0.1:9/v1',
    name: 'test-model',
    apiKey: 'secret',
    workspaceRoot: '/attacker',
    tools: [],
    model: { provider: 'evil' },
  });
  assert.equal(r.status, 200);

  const cfg = await (await fetch(base + '/api/config')).json();
  assert.equal(cfg.model.provider, 'mock');
  assert.equal(cfg.model.name, 'test-model');
  assert.equal(cfg.workspaceRoot, root, 'workspaceRoot is not writable via the payload');

  const disk = JSON.parse(await fs.readFile(path.join(root, 'sci-agent.config.json'), 'utf8'));
  assert.deepEqual(Object.keys(disk.model ?? {}).sort(), ['apiKey', 'baseUrl', 'name', 'provider']);
  assert.ok(!('workspaceRoot' in disk));
  assert.ok(!('tools' in disk));
});

test('agent-skills source validation rejects malformed/traversal sources', async (t) => {
  const { base } = await makeServer(t);
  for (const bad of ['github:../../x', 'github:..%2F..%2Fx', 'not-github:x', 'github:', 'github:a b/c', 'github:a/']) {
    const r = await jpost(base, '/api/agent-skills', { source: bad });
    assert.equal(r.status, 400, bad);
  }
});

test('static server serves ui files but not dot-segment/percent-encoded escapes', async (t) => {
  const { base } = await makeServer(t);
  assert.equal((await fetch(base + '/app.js')).status, 200);
  assert.equal((await fetch(base + '/md.js')).status, 200);
  for (const p of ['/..%2f..%2fpackage.json', '/%2e%2e/package.json', '/..\\..\\package.json', '/../package.json']) {
    const r = await fetch(base + p);
    assert.notEqual(r.status, 200, p);
  }
});

test('cross-origin no-cors POST (non-JSON content-type) is rejected with 415', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/clear', {
    method: 'POST',
    headers: { 'content-type': 'text/plain' },
    body: JSON.stringify({}),
  });
  assert.equal(r.status, 415);

  const r2 = await fetch(base + '/api/clear', { method: 'POST', body: '{}' });
  assert.equal(r2.status, 415);
});

test('DNS-rebinding Host header is rejected with 403', async (t) => {
  const { base } = await makeServer(t);
  const status = await new Promise((resolve, reject) => {
    const rq = http.request(new URL(base + '/api/health'), { headers: { Host: 'evil.example' } }, (rs) => {
      rs.resume();
      rs.on('end', () => resolve(rs.statusCode));
    });
    rq.on('error', reject);
    rq.end();
  });
  assert.equal(status, 403);
});

test('invalid JSON body returns 400 (not 500)', async (t) => {
  const { base } = await makeServer(t);
  const r = await fetch(base + '/api/chat', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{nope',
  });
  assert.equal(r.status, 400);
});
