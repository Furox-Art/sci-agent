import { test, beforeEach } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '@sci/core';

let root;
beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
});

const reg = (approve = async () => true) => new ToolRegistry({ workspaceRoot: root, approve });

test('write_file + read_file döngüsü', async () => {
  const r = reg();
  const w = await r.invoke('write_file', { path: 'a/b.txt', content: 'merhaba' });
  assert.ok(w.ok, w.output);
  const rd = await r.invoke('read_file', { path: 'a/b.txt' });
  assert.equal(rd.output, 'merhaba');
});

test('çalışma alanı dışına yazım engellenir', async () => {
  const r = reg();
  const w = await r.invoke('write_file', { path: '../disari.txt', content: 'x' });
  assert.equal(w.ok, false);
  assert.match(w.output, /engellendi/);
});

test('onay verilmeyen yazma işlemi yapılmaz', async () => {
  const r = reg(async () => false);
  const w = await r.invoke('write_file', { path: 'x.txt', content: 'x' });
  assert.equal(w.ok, false);
  await assert.rejects(fs.readFile(path.join(root, 'x.txt')));
});

test('run_command çıktı döndürür', async () => {
  const r = reg();
  const out = await r.invoke('run_command', { command: 'echo selam' });
  assert.ok(out.ok, out.output);
  assert.match(out.output, /selam/);
});

test('search_files içerikte arar', async () => {
  const r = reg();
  const w = await r.invoke('write_file', { path: 'notes.md', content: 'hızlı tilki\nbilimsel not' });
  assert.ok(w.ok, w.output);
  const s = await r.invoke('search_files', { pattern: 'tilki' });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /notes\.md/);
});

test('edit_file tek eşleşmeyi değiştirir', async () => {
  const r = reg();
  await r.invoke('write_file', { path: 'kod.js', content: 'const a = 1;\nconst b = 2;\n' });
  const e = await r.invoke('edit_file', { path: 'kod.js', oldText: 'const a = 1;', newText: 'const a = 42;' });
  assert.ok(e.ok, e.output);
  const rd = await r.invoke('read_file', { path: 'kod.js' });
  assert.match(rd.output, /const a = 42;/);
  assert.match(rd.output, /const b = 2;/);
});

test('edit_file çoklu eşleşmede hata verir, replaceAll ile değiştirir', async () => {
  const r = reg();
  await r.invoke('write_file', { path: 'c.txt', content: 'x y x' });
  const e1 = await r.invoke('edit_file', { path: 'c.txt', oldText: 'x', newText: 'z' });
  assert.equal(e1.ok, false);
  assert.match(e1.output, /2 kez geçiyor/);
  const e2 = await r.invoke('edit_file', { path: 'c.txt', oldText: 'x', newText: 'z', replaceAll: true });
  assert.ok(e2.ok, e2.output);
  const rd = await r.invoke('read_file', { path: 'c.txt' });
  assert.equal(rd.output, 'z y z');
});

test('edit_file eşleşme yoksa hata verir', async () => {
  const r = reg();
  await r.invoke('write_file', { path: 'd.txt', content: 'abc' });
  const e = await r.invoke('edit_file', { path: 'd.txt', oldText: 'yok', newText: 'x' });
  assert.equal(e.ok, false);
  assert.match(e.output, /bulunamadı/);
});
