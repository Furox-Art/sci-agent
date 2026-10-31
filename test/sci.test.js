import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_CONFIG, createRegistry, getPlugin, listPlugins } from '@sci/core';

test('sci-tools eklentisi kayıtlı ve araçları yükleniyor', () => {
  assert.ok(listPlugins().some((p) => p.name === 'sci-tools'));
  assert.ok(getPlugin('sci-tools').systemPrompt.includes('python_eval'));
  const cfg = structuredClone(DEFAULT_CONFIG);
  const r = createRegistry({ cfg });
  const names = r.tools.map((t) => t.name);
  assert.ok(names.includes('python_eval'));
  assert.ok(names.includes('csv_stats'));
});

test('csv_stats temel istatistikleri hesaplar', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  await fs.writeFile(path.join(root, 'veri.csv'), 'x,y,etiket\n1,10,a\n2,20,b\n3,40,c\n', 'utf8');
  const r = createRegistry({
    cfg: { agent: { workspaceRoot: root }, plugins: ['sci-tools'], policies: DEFAULT_CONFIG.policies },
  });
  const s = await r.invoke('csv_stats', { path: 'veri.csv' });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /x: n=3, ortalama=2\.0000/);
  assert.match(s.output, /y: n=3, ortalama=23\.3333/);
  assert.match(s.output, /maks=40/);
  assert.match(s.output, /etiket: sayısal veri yok/);
});

const pyCheck = spawnSync(process.platform === 'win32' ? 'python' : 'python3', ['-I', '-c', 'print(1)'], {
  timeout: 15000,
});
const hasPython = pyCheck.status === 0;

test('python_eval çıktı döndürür', { skip: hasPython ? false : 'Sistemde Python yok' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const r = createRegistry({
    cfg: { agent: { workspaceRoot: root }, plugins: ['sci-tools'], policies: DEFAULT_CONFIG.policies },
    approve: async () => true,
  });
  const s = await r.invoke('python_eval', { code: 'print(6*7)' });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /42/);
});
