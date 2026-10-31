import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { molar_mass, ATOMIC_MASSES } from '../packages/core/src/science/sci-chem.js';
import { ToolRegistry } from '@sci/core';

const TOL = 0.05;

async function makeRegistry(t) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-chem-'));
  if (t && typeof t.after === 'function') {
    t.after(async () => {
      await fs.rm(root, { recursive: true, force: true });
    });
  }
  return new ToolRegistry({ tools: [molar_mass], workspaceRoot: root });
}

function massOf(output) {
  const m = /mol kütlesi: ([0-9.eE+-]+) g\/mol/.exec(output);
  assert.ok(m, `çıktıda mol kütlesi bulunamadı: ${output}`);
  return Number(m[1]);
}

test('araç şekli doğru tanımlı', () => {
  assert.equal(molar_mass.name, 'molar_mass');
  assert.equal(typeof molar_mass.description, 'string');
  assert.ok(molar_mass.description.length > 10);
  assert.equal(molar_mass.needsApproval, false);
  assert.equal(molar_mass.parallel, true);
  assert.equal(molar_mass.parameters.type, 'object');
  assert.deepEqual(Object.keys(molar_mass.parameters.properties), ['formula']);
  assert.deepEqual(molar_mass.parameters.required, ['formula']);
  assert.equal(typeof molar_mass.execute, 'function');
});

test('bilinen formüllerin mol kütlesi doğru hesaplanır', async (t) => {
  const r = await makeRegistry(t);
  const cases = [
    ['H2O', 18.015],
    ['CO2', 44.009],
    ['Ca(OH)2', 74.092],
    ['Al2(SO4)3', 342.15],
    ['CuSO4·5H2O', 249.68],
    ['(NH4)2SO4', 132.14],
    ['C6H12O6', 180.156],
    ['NaCl', 58.443],
  ];
  for (const [formula, expected] of cases) {
    const res = await r.invoke('molar_mass', { formula });
    assert.ok(res.ok, `${formula} → ${res.output}`);
    const got = massOf(res.output);
    assert.ok(
      Math.abs(got - expected) < TOL,
      `${formula}: beklenen ≈${expected}, bulunan ${got}`,
    );
  }
});

test('hidrat ayırıcı varyantları aynı sonucu verir', async (t) => {
  const r = await makeRegistry(t);
  const values = [];
  for (const formula of ['CuSO4·5H2O', 'CuSO4*5H2O', 'CuSO4.5H2O']) {
    const res = await r.invoke('molar_mass', { formula });
    assert.ok(res.ok, `${formula} → ${res.output}`);
    values.push(massOf(res.output));
  }
  assert.ok(Math.abs(values[0] - 249.68) < TOL, `CuSO4·5H2O: ${values[0]}`);
  assert.equal(values[1], values[0]);
  assert.equal(values[2], values[0]);
});

test('çıkış biçimi: başlık ve element dökümü', async (t) => {
  const r = await makeRegistry(t);
  const res = await r.invoke('molar_mass', { formula: 'H2O' });
  assert.ok(res.ok, res.output);
  assert.match(res.output, /^H2O mol kütlesi: [0-9.]+ g\/mol$/m);
  assert.match(res.output, /H ×2 = 2\.016/);
  assert.match(res.output, /O ×1 = 15\.999/);
});

test('baştaki katsayı hidratın tamamına çarpılır', async (t) => {
  const r = await makeRegistry(t);
  const res = await r.invoke('molar_mass', { formula: '2CuSO4·5H2O' });
  assert.ok(res.ok, res.output);
  const got = massOf(res.output);
  assert.ok(Math.abs(got - 2 * 249.68) < TOL, `beklenen ≈${2 * 249.68}, bulunan ${got}`);
  assert.match(res.output, /Cu ×2 =/);
  assert.match(res.output, /H ×20 =/);
  assert.match(res.output, /O ×18 =/);
  const single = await r.invoke('molar_mass', { formula: '2H2O' });
  assert.ok(single.ok, single.output);
  assert.ok(Math.abs(massOf(single.output) - 36.03) < TOL);
});

test('hata durumları: bilinmeyen sembol ve dengesiz parantez', async (t) => {
  const r = await makeRegistry(t);
  const unknown = await r.invoke('molar_mass', { formula: 'Xx2' });
  assert.equal(unknown.ok, false);
  assert.match(unknown.output, /Bilinmeyen element sembolü/);
  assert.match(unknown.output, /Xx/);
  assert.match(unknown.output, /konum/i);

  const unbalanced = await r.invoke('molar_mass', { formula: '(H2O' });
  assert.equal(unbalanced.ok, false);
  assert.match(unbalanced.output, /Dengesiz parantez/);
  assert.match(unbalanced.output, /konum/i);
});

test('hata durumları: boş/eksik formül', async (t) => {
  const r = await makeRegistry(t);
  const missing = await r.invoke('molar_mass', {});
  assert.equal(missing.ok, false);
  assert.match(missing.output, /formula parametresi/);
  const blank = await r.invoke('molar_mass', { formula: '   ' });
  assert.equal(blank.ok, false);
});

test('element tablosu bütünlüğü: 118 element, hepsinde sayısal kütle', async (t) => {
  const entries = Object.entries(ATOMIC_MASSES);
  assert.equal(entries.length, 118);
  const symbols = entries.map(([s]) => s);
  assert.equal(new Set(symbols).size, symbols.length, 'semboller benzersiz olmalı');
  assert.ok(symbols.every((s) => /^[A-Z][a-z]?$/.test(s)), 'semboller 1-2 harf olmalı');
  // Seçme doğruluk kontrolü (IUPAC standart değerleri)
  assert.equal(ATOMIC_MASSES.H, 1.008);
  assert.equal(ATOMIC_MASSES.C, 12.011);
  assert.equal(ATOMIC_MASSES.O, 15.999);
  assert.equal(ATOMIC_MASSES.Cl, 35.45);
  assert.equal(ATOMIC_MASSES.S, 32.06);
  assert.equal(ATOMIC_MASSES.U, 238.03);
  // Tüm tablo araç üzerinden tek tek doğrulanır (döngüyle)
  const r = await makeRegistry(t);
  for (const [sym, mass] of entries) {
    assert.equal(typeof mass, 'number', `${sym}: kütle sayısal değil`);
    assert.ok(Number.isFinite(mass) && mass > 0, `${sym}: geçersiz kütle ${mass}`);
    const res = await r.invoke('molar_mass', { formula: sym });
    assert.ok(res.ok, `${sym} → ${res.output}`);
    assert.equal(
      massOf(res.output),
      mass,
      `${sym}: araç çıktısı tablo değeriyle uyuşmuyor`,
    );
  }
});
