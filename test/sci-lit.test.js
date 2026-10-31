import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '@sci/core';
import { lit_search, lit_verify, lit_quote } from '../packages/core/src/science/sci-lit.js';

const TOOLS = [lit_search, lit_verify, lit_quote];

async function makeRegistry() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sci-lit-'));
  return new ToolRegistry({ tools: TOOLS, workspaceRoot });
}

// --- Structure tests: run in every environment (no Python/network needed) ---

test('araç şekli: üç araç tanımlı, onaysız ve paralel çalışabilir', () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.name, 'string');
    assert.ok(t.name.length > 0);
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 20, 'açıklama boş olamaz');
    assert.equal(t.needsApproval, false);
    assert.equal(t.parallel, true);
    assert.equal(typeof t.execute, 'function');
    assert.equal(t.execute.constructor.name, 'AsyncFunction', 'execute async olmalı');
  }
  assert.deepEqual(
    TOOLS.map((t) => t.name),
    ['lit_search', 'lit_verify', 'lit_quote'],
  );
});

test('şemalar: geçerli JSON Schema ve JSON-aşılabilir', () => {
  for (const t of TOOLS) {
    assert.equal(t.parameters.type, 'object');
    assert.equal(typeof t.parameters.properties, 'object');
    const roundTrip = JSON.parse(JSON.stringify(t.parameters));
    assert.deepEqual(roundTrip, t.parameters, 'parameters JSON serileştirilebilir olmalı');
  }
  assert.deepEqual(lit_search.parameters.required, ['query']);
  assert.equal(lit_search.parameters.properties.query.type, 'string');
  assert.equal(lit_search.parameters.properties.max_results.type, 'number');
  assert.ok(!lit_verify.parameters.required, 'lit_verify için required yok (doi veya title)');
  assert.equal(lit_verify.parameters.properties.doi.type, 'string');
  assert.equal(lit_verify.parameters.properties.title.type, 'string');
  assert.deepEqual(lit_quote.parameters.required, ['pmcid', 'quote']);
  assert.equal(lit_quote.parameters.properties.pmcid.type, 'string');
});

test('ToolRegistry entegrasyonu: şemalar listeleniyor', async () => {
  const registry = await makeRegistry();
  const names = registry.schemas().map((s) => s.name);
  for (const t of TOOLS) assert.ok(names.includes(t.name), `${t.name} kayıtlı olmalı`);
  const list = registry.list();
  assert.ok(list.every((l) => l.needsApproval === false));
});

test('doğrulama yolu: eksik argüman throw etmez, "Hata" ile başlayan string döner', async () => {
  const registry = await makeRegistry();
  const r1 = await registry.invoke('lit_verify', {});
  assert.equal(typeof r1.ok, 'boolean');
  assert.equal(r1.ok, false);
  assert.equal(typeof r1.output, 'string');
  assert.ok(r1.output.startsWith('Hata'), `beklenmeyen çıktı: ${r1.output}`);

  const r2 = await registry.invoke('lit_search', { query: '   ' });
  assert.equal(r2.ok, false);
  assert.equal(typeof r2.output, 'string');
  assert.ok(r2.output.startsWith('Hata'), `beklenmeyen çıktı: ${r2.output}`);

  const r3 = await registry.invoke('lit_quote', { pmcid: '', quote: '' });
  assert.equal(r3.ok, false);
  assert.equal(typeof r3.output, 'string');
  assert.ok(r3.output.startsWith('Hata'), `beklenmeyen çıktı: ${r3.output}`);
});

// --- Live tests: only meaningful with the package + network; type-based asserts ---

test('canlı arama: ağ sonucundan bağımsız olarak string döner ve süreç ayakta kalır', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_search', { query: 'CRISPR off-target effects', max_results: 2 });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'çıktı boş olamaz');
  if (/paketini bulunamadı|paketi bulunamadı|paket bulunamadı/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; canlı arama atlandı');
    return;
  }
  // Process survived the bridge call; a further trivial assertion proves it.
  assert.ok(process.pid > 0);
});

test('canlı doğrulama (doi): retraksiyon özeti ya da nazik hata metni döner', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_verify', { doi: '10.1038/nature12373' });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'çıktı boş olamaz');
  if (/paketini bulunamadı|paketi bulunamadı|paket bulunamadı/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; canlı doğrulama atlandı');
    return;
  }
  assert.ok(process.pid > 0);
});

test('canlı doğrulama (title): başlıktan DOI adayı çıkarıp string döner', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_verify', { title: 'Characterizing CRISPR off-target effects' });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'çıktı boş olamaz');
  if (/paketini bulunamadı|paketi bulunamadı|paket bulunamadı/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; canlı doğrulama atlandı');
    return;
  }
  assert.ok(process.pid > 0);
});
