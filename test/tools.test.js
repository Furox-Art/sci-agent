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
