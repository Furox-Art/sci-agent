import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '@sci/core';
import { math_eval, unit_convert, physical_constants } from '../packages/core/src/science/sci-extra.js';

async function makeRegistry() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sci-extra-'));
  return new ToolRegistry({ tools: [math_eval, unit_convert, physical_constants], workspaceRoot });
}

// extract the numeric result from '<expr> = <value>' output
function valueOf(output) {
  const i = output.lastIndexOf(' = ');
  assert.ok(i > 0, `beklenmeyen çıktı: ${output}`);
  return Number(output.slice(i + 3).trim());
}

// extract the target value from '<value> <from> = <result> <to>' output
function targetValueOf(output) {
  const i = output.lastIndexOf(' = ');
  assert.ok(i > 0, `beklenmeyen çıktı: ${output}`);
  return Number(output.slice(i + 3).trim().split(/\s+/)[0]);
}

test('araç şekli: üç araç tanımlı, onaysız ve paralel çalışabilir', () => {
  for (const t of [math_eval, unit_convert, physical_constants]) {
    assert.equal(typeof t.name, 'string');
    assert.ok(t.description.length > 20);
    assert.equal(t.parameters.type, 'object');
    assert.equal(t.needsApproval, false);
    assert.equal(t.parallel, true);
    assert.equal(typeof t.execute, 'function');
  }
});

test('math_eval parantez ve üs işlemleri', async () => {
  const r = await makeRegistry();
  const s = await r.invoke('math_eval', { expression: '2*(3+4)^2' });
  assert.ok(s.ok, s.output);
  assert.equal(valueOf(s.output), 98);
  const t = await r.invoke('math_eval', { expression: '(2+3)*(4-1)' });
  assert.ok(t.ok, t.output);
  assert.equal(valueOf(t.output), 15);
  const u = await r.invoke('math_eval', { expression: '2^3^2' });
  assert.ok(u.ok, u.output);
  assert.equal(valueOf(u.output), 512); // right-associative power
});

test('math_eval fonksiyonlar ve sabitler', async () => {
  const r = await makeRegistry();
  const cases = [
    ['sqrt(2)', 1.4142135623730951],
    ['sin(pi/2)', 1],
    ['cos(0)', 1],
    ['tan(pi/4)', Math.tan(Math.PI / 4)],
    ['asin(0.5)*2', Math.PI / 3],
    ['ln(e)', 1],
    ['log(1000)', 3],
    ['exp(1)', Math.E],
    ['abs(-3.5)+floor(2.7)+ceil(2.1)+round(2.5)', 11.5],
  ];
  for (const [expr, expected] of cases) {
    const s = await r.invoke('math_eval', { expression: expr });
    assert.ok(s.ok, `${expr}: ${s.output}`);
    const v = valueOf(s.output);
    assert.ok(Math.abs(v - expected) < 1e-9, `${expr}: ${v} ≉ ${expected}`);
  }
});

test('math_eval unary eksi ve modulo', async () => {
  const r = await makeRegistry();
  const cases = [
    ['-2^2', -4], // unary minus binds looser than ^
    ['2^-2', 0.25],
    ['10%3', 1],
    ['--5', 5],
  ];
  for (const [expr, expected] of cases) {
    const s = await r.invoke('math_eval', { expression: expr });
    assert.ok(s.ok, `${expr}: ${s.output}`);
    assert.equal(valueOf(s.output), expected);
  }
});

test('math_eval float gürültüsü 12 basamağa yuvarlanır', async () => {
  const r = await makeRegistry();
  for (const expr of ['0.1+0.2', '0.1*3']) {
    const s = await r.invoke('math_eval', { expression: expr });
    assert.ok(s.ok, s.output);
    assert.ok(s.output.endsWith('= 0.3'), s.output);
  }
});

test('math_eval geçersiz ifadeler hata verir', async () => {
  const r = await makeRegistry();
  for (const expression of ['', '2+', '((1)', 'foo(1)', '2 pi', '2+@', '1/0', 'sqrt(-1)']) {
    const s = await r.invoke('math_eval', { expression });
    assert.equal(s.ok, false, `${expression}: beklenmedik başarı`);
    assert.match(s.output, /^Hata: /);
  }
});

test('unit_convert uzunluk ve takma adlar', async () => {
  const r = await makeRegistry();
  const cases = [
    [{ value: 1, from: 'mi', to: 'km' }, 1.609344],
    [{ value: 1, from: 'MILE', to: 'KM' }, 1.609344],
    [{ value: 1, from: 'mil', to: 'kilometre' }, 1.609344],
    [{ value: 1, from: 'metre', to: 'm' }, 1],
    [{ value: 1, from: 'ft', to: 'in' }, 12],
  ];
  for (const [args, expected] of cases) {
    const s = await r.invoke('unit_convert', args);
    assert.ok(s.ok, `${JSON.stringify(args)}: ${s.output}`);
    assert.equal(targetValueOf(s.output), expected);
  }
});

test('unit_convert zaman, enerji ve basınç', async () => {
  const r = await makeRegistry();
  const cases = [
    [{ value: 2, from: 'dk', to: 's' }, 120],
    [{ value: 1, from: 'kcal', to: 'J' }, 4184],
    [{ value: 1, from: 'kWh', to: 'J' }, 3600000],
    [{ value: 1, from: 'atm', to: 'Pa' }, 101325],
    [{ value: 2, from: 'bar', to: 'kPa' }, 200],
  ];
  for (const [args, expected] of cases) {
    const s = await r.invoke('unit_convert', args);
    assert.ok(s.ok, `${JSON.stringify(args)}: ${s.output}`);
    assert.equal(targetValueOf(s.output), expected);
  }
});

test('unit_convert sıcaklık (ofsetli dönüşüm)', async () => {
  const r = await makeRegistry();
  const cases = [
    [{ value: 100, from: 'C', to: 'F' }, 212],
    [{ value: 0, from: 'C', to: 'K' }, 273.15],
    [{ value: 32, from: 'F', to: 'C' }, 0],
    [{ value: -40, from: 'C', to: 'F' }, -40],
    [{ value: 100, from: 'santigrat', to: 'kelvin' }, 373.15],
  ];
  for (const [args, expected] of cases) {
    const s = await r.invoke('unit_convert', args);
    assert.ok(s.ok, `${JSON.stringify(args)}: ${s.output}`);
    assert.equal(targetValueOf(s.output), expected);
  }
});

test('unit_convert açı', async () => {
  const r = await makeRegistry();
  const s = await r.invoke('unit_convert', { value: 180, from: 'deg', to: 'rad' });
  assert.ok(s.ok, s.output);
  assert.ok(Math.abs(targetValueOf(s.output) - Math.PI) < 1e-9, s.output);
  const t = await r.invoke('unit_convert', { value: 90, from: 'deg', to: 'grad' });
  assert.ok(t.ok, t.output);
  assert.equal(targetValueOf(t.output), 100);
  const u = await r.invoke('unit_convert', { value: 1, from: 'rad', to: 'deg' });
  assert.ok(u.ok, u.output);
  assert.ok(Math.abs(targetValueOf(u.output) - 180 / Math.PI) < 1e-6, u.output);
});

test('unit_convert hatalar: kategori karışması, bilinmeyen birim, geçersiz değer', async () => {
  const r = await makeRegistry();
  const a = await r.invoke('unit_convert', { value: 1, from: 'm', to: 'kg' });
  assert.equal(a.ok, false);
  assert.match(a.output, /kategorileri uyuşmuyor/);
  const b = await r.invoke('unit_convert', { value: 1, from: 'parsec', to: 'km' });
  assert.equal(b.ok, false);
  assert.match(b.output, /Bilinmeyen birim/);
  const c = await r.invoke('unit_convert', { value: 'abc', from: 'm', to: 'km' });
  assert.equal(c.ok, false);
  assert.match(c.output, /sayısal değer/);
});

test('physical_constants tek sabit: c, h ve G/g büyük-küçük harf ayrımı', async () => {
  const r = await makeRegistry();
  const c = await r.invoke('physical_constants', { name: 'c' });
  assert.ok(c.ok, c.output);
  assert.match(c.output, /299792458/);
  assert.match(c.output, /m\/s/);
  const h = await r.invoke('physical_constants', { name: 'h' });
  assert.ok(h.ok, h.output);
  assert.match(h.output, /6\.62607015e-34/);
  const G = await r.invoke('physical_constants', { name: 'G' });
  assert.ok(G.ok, G.output);
  assert.match(G.output, /6\.6743e-11/);
  const g = await r.invoke('physical_constants', { name: 'g' });
  assert.ok(g.ok, g.output);
  assert.match(g.output, /9\.80665/);
});

test('physical_constants harf duyarsız arama ve takma adlar', async () => {
  const r = await makeRegistry();
  const na = await r.invoke('physical_constants', { name: 'NA' });
  assert.ok(na.ok, na.output);
  assert.match(na.output, /6\.02214076e\+23/);
  const eps = await r.invoke('physical_constants', { name: 'epsilon_0' });
  assert.ok(eps.ok, eps.output);
  assert.match(eps.output, /8\.8541878128e-12/);
  const amu = await r.invoke('physical_constants', { name: 'AMU' });
  assert.ok(amu.ok, amu.output);
  assert.match(amu.output, /1\.6605390666e-27/);
  const kb = await r.invoke('physical_constants', { name: 'Boltzmann' });
  assert.ok(kb.ok, kb.output);
  assert.match(kb.output, /1\.380649e-23/);
});

test('physical_constants liste modu 20+ satır döndürür', async () => {
  const r = await makeRegistry();
  for (const args of [{}, { name: 'liste' }]) {
    const s = await r.invoke('physical_constants', args);
    assert.ok(s.ok, s.output);
    const lines = s.output.split('\n').filter((l) => l.trim() !== '');
    assert.ok(lines.length >= 20, `${lines.length} satır`);
    assert.match(s.output, /c — vacuumda ışık hızı: 299792458 m\/s/);
  }
});

test('physical_constants bilinmeyen ad hata verir ve isimleri önerir', async () => {
  const r = await makeRegistry();
  const s = await r.invoke('physical_constants', { name: 'olmayan' });
  assert.equal(s.ok, false);
  assert.match(s.output, /Bilinmeyen sabit/);
  assert.match(s.output, /Kullanılabilir isimler/);
});
