import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '@sci/core';
import { stats_calc, matrix_ops } from '../packages/core/src/science/sci-data.js';

// Registry with only the sci-data tools, workspace root in a temp dir.
async function makeRegistry() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'scidata-'));
  const r = new ToolRegistry({ tools: [stats_calc, matrix_ops], workspaceRoot: root });
  return { r, root };
}

test('stats_calc: numbers ile betimsel istatistik', async () => {
  const { r } = await makeRegistry();
  const s = await r.invoke('stats_calc', { numbers: [2, 4, 4, 4, 5, 5, 7, 9] });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /n=8/);
  assert.match(s.output, /ortalama=5\.00000/);
  assert.match(s.output, /medyan=4\.50000/);
  // Sample sd (n-1): sqrt(32/7) = 2.13809... (2 would be the population sd)
  assert.match(s.output, /ss=2\.13809/);
  assert.match(s.output, /varyans=4\.57143/);
  assert.match(s.output, /min=2\.00000/);
  assert.match(s.output, /maks=9\.00000/);
});

test('stats_calc: CSV iki sütun, korelasyon ve regresyon', async () => {
  const { r, root } = await makeRegistry();
  await fs.writeFile(path.join(root, 'duz.csv'), 'x,y\n1,2\n2,4\n3,6\n4,8\n5,10\n', 'utf8');
  const s = await r.invoke('stats_calc', { path: 'duz.csv', columns: ['x', 'y'] });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /x: n=5, ortalama=3\.00000/);
  assert.match(s.output, /Pearson korelasyonu r = 1\.00000/);
  assert.match(s.output, /eğim a=2\.00000/);
  assert.match(s.output, /kesişim b=0\.00000/);
  assert.match(s.output, /r² = 1\.00000/);
});

test('stats_calc: sayısal olmayan hücreler o sütunda atlanır', async () => {
  const { r, root } = await makeRegistry();
  await fs.writeFile(path.join(root, 'karisik.csv'), 'x,y\n1,2\n2,4\n3,elma\n4,8\n5,10\n', 'utf8');
  const s = await r.invoke('stats_calc', { path: 'karisik.csv', columns: ['x', 'y'] });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /x: n=5/);
  assert.match(s.output, /y: n=4/); // 'elma' skipped
  assert.match(s.output, /Pearson korelasyonu r = 1\.00000/);
  assert.match(s.output, /eğim a=2\.00000/);
});

test('stats_calc: sayısal olmayan sütun ve az veri hatası', async () => {
  const { r, root } = await makeRegistry();
  // Fully non-numeric column -> n=0 -> error
  await fs.writeFile(path.join(root, 'metin.csv'), 'ad,not\nAli,80\nVeli,90\n', 'utf8');
  const e1 = await r.invoke('stats_calc', { path: 'metin.csv', columns: ['ad'] });
  assert.ok(!e1.ok);
  assert.match(e1.output, /Hata:/);
  assert.match(e1.output, /en az 2 sayısal veri/);
  // Too few numbers -> error
  const e2 = await r.invoke('stats_calc', { numbers: [5] });
  assert.ok(!e2.ok);
  assert.match(e2.output, /Hata:/);
  assert.match(e2.output, /en az 2 sayısal veri/);
});

test('matrix_ops: determinant 3x3', async () => {
  const { r } = await makeRegistry();
  const s = await r.invoke('matrix_ops', { op: 'det', a: [[6, 1, 1], [4, -2, 5], [2, 8, 7]] });
  assert.ok(s.ok, s.output);
  const m = s.output.match(/determinant = (-?[0-9.]+)/);
  assert.ok(m, s.output);
  assert.ok(Math.abs(Number(m[1]) + 306) < 1e-6, s.output);
});

test('matrix_ops: inverse 2x2', async () => {
  const { r } = await makeRegistry();
  const s = await r.invoke('matrix_ops', { op: 'inverse', a: [[4, 7], [2, 6]] });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /matris = \[\[0\.6,-0\.7\],\[-0\.2,0\.4\]\]/);
  assert.match(s.output, /0\.6000000000/); // toPrecision(10) lines
});

test('matrix_ops: multiply', async () => {
  const { r } = await makeRegistry();
  const s = await r.invoke('matrix_ops', { op: 'multiply', a: [[1, 2], [3, 4]], b: [[5, 6], [7, 8]] });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /matris = \[\[19,22\],\[43,50\]\]/);
});

test('matrix_ops: tekil matris hatası', async () => {
  const { r } = await makeRegistry();
  const s = await r.invoke('matrix_ops', { op: 'inverse', a: [[1, 2], [2, 4]] });
  assert.ok(!s.ok);
  assert.match(s.output, /Hata:/);
  assert.match(s.output, /tekil/);
});

test('matrix_ops: boyut uyumsuzluk ve 10x10 sınır hatası', async () => {
  const { r } = await makeRegistry();
  const e1 = await r.invoke('matrix_ops', {
    op: 'multiply',
    a: [[1, 2], [3, 4]],
    b: [[1, 2, 3], [4, 5, 6], [7, 8, 9]],
  });
  assert.ok(!e1.ok);
  assert.match(e1.output, /Hata:/);
  assert.match(e1.output, /boyut uyumsuz/);
  // 11 rows exceeds the 10x10 limit
  const big = Array.from({ length: 11 }, (_, i) => [i, 1]);
  const e2 = await r.invoke('matrix_ops', { op: 'det', a: big });
  assert.ok(!e2.ok);
  assert.match(e2.output, /Hata:/);
  assert.match(e2.output, /10x10/);
});
