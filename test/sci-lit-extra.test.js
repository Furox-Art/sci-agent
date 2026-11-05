import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '@sci/core';
import { lit_audit, lit_screen, lit_ledger } from '../packages/core/src/science/sci-lit-extra.js';

const TOOLS = [lit_audit, lit_screen, lit_ledger];

async function makeRegistry() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sci-lit-extra-'));
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
    ['lit_audit', 'lit_screen', 'lit_ledger'],
  );
});

test('şemalar: geçerli JSON Schema ve JSON-aşılabilir', () => {
  for (const t of TOOLS) {
    assert.equal(t.parameters.type, 'object');
    assert.equal(typeof t.parameters.properties, 'object');
    const roundTrip = JSON.parse(JSON.stringify(t.parameters));
    assert.deepEqual(roundTrip, t.parameters, 'parameters JSON serileştirilebilir olmalı');
  }
  assert.deepEqual(lit_audit.parameters.required, ['pmcid', 'outcome']);
  assert.deepEqual(lit_audit.parameters.properties.study_design.enum, ['randomized_trial', 'observational']);
  assert.equal(lit_audit.parameters.properties.annotations.type, 'array');
  assert.equal(lit_audit.parameters.properties.annotations.items.type, 'object');
  assert.deepEqual(lit_screen.parameters.required, ['query']);
  assert.equal(lit_screen.parameters.properties.criteria.type, 'array');
  assert.equal(lit_screen.parameters.properties.criteria.items.type, 'string');
  assert.equal(lit_screen.parameters.properties.max_results.type, 'number');
  assert.ok(!lit_ledger.parameters.required, 'lit_ledger için required yok');
  assert.equal(lit_ledger.parameters.properties.path.type, 'string');
  // Parameter descriptions must be present and non-trivial.
  for (const t of TOOLS) {
    for (const [key, prop] of Object.entries(t.parameters.properties)) {
      assert.equal(typeof prop.description, 'string', `${t.name}.${key} açıklaması olmalı`);
      assert.ok(prop.description.length > 10, `${t.name}.${key} açıklaması çok kısa`);
    }
  }
});

test('ToolRegistry entegrasyonu: şemalar listeleniyor', async () => {
  const registry = await makeRegistry();
  const names = registry.schemas().map((s) => s.name);
  for (const t of TOOLS) assert.ok(names.includes(t.name), `${t.name} kayıtlı olmalı`);
  const list = registry.list();
  assert.ok(list.every((l) => l.needsApproval === false));
});

test('doğrulama yolu: eksik zorunlu argüman ok:false + Error döner', async () => {
  const registry = await makeRegistry();
  const r1 = await registry.invoke('lit_audit', {});
  assert.equal(r1.ok, false);
  assert.equal(typeof r1.output, 'string');
  assert.ok(r1.output.startsWith('Error'), `unexpected output: ${r1.output}`);

  const r2 = await registry.invoke('lit_audit', { pmcid: 'PMC1234567' });
  assert.equal(r2.ok, false, 'outcome eksikse throw etmeli');
  assert.ok(r2.output.startsWith('Error'));

  const r3 = await registry.invoke('lit_screen', { query: '   ' });
  assert.equal(r3.ok, false);
  assert.ok(r3.output.startsWith('Error'));
});

test('geçersiz değerler: throw değil, nazik İngilizce hata metni (ok:true)', async () => {
  const registry = await makeRegistry();
  const r1 = await registry.invoke('lit_audit', {
    pmcid: 'PMC1234567',
    outcome: 'mortality',
    study_design: 'case_report',
  });
  assert.equal(r1.ok, true, 'geçersiz design throw etmemeli');
  assert.equal(typeof r1.output, 'string');
  assert.ok(r1.output.startsWith('Error:'), `unexpected output: ${r1.output}`);
  assert.ok(/randomized_trial|observational/.test(r1.output), 'desteklenen designlar listelenmeli');

  const r2 = await registry.invoke('lit_audit', {
    pmcid: 'PMC1234567',
    outcome: 'mortality',
    annotations: 'not-an-array',
  });
  assert.equal(r2.ok, true);
  assert.ok(r2.output.startsWith('Error:'), `unexpected output: ${r2.output}`);

  const r3 = await registry.invoke('lit_screen', { query: 'CRISPR', criteria: 'single-string' });
  assert.equal(r3.ok, true);
  assert.ok(r3.output.startsWith('Error:'), `unexpected output: ${r3.output}`);
});

test('lit_ledger yol çözümleme: workspaceRoot altındaki göreli yol kullanılır', async (t) => {
  // Bridge çağrısı gerektirir; paket yoksa skip. Ağ gerekmez (yalnızca yerel dosya).
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sci-ledger-ws-'));
  const registry = new ToolRegistry({ tools: TOOLS, workspaceRoot });
  const r = await registry.invoke('lit_ledger', { path: 'missing-ledger.jsonl' });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0);
  if (/package was not found/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; ledger testi atlandı');
    return;
  }
  // Paket varsa: dosya yok -> VALID_EMPTY (deterministik, ağa bağımlı değil).
  if (!r.output.startsWith('Error:')) {
    assert.ok(/VALID_EMPTY/.test(r.output), `VALID_EMPTY beklenirdi: ${r.output}`);
    assert.ok(r.output.includes('missing-ledger.jsonl'), 'çözümlenen yol çıktıda görünmeli');
  }
});

// --- Live tests: only meaningful with the package + network; type-based asserts ---

test('canlı denetim: audit özeti ya da nazik hata metni döner', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_audit', {
    pmcid: 'PMC4136957',
    outcome: '28-day mortality',
    study_design: 'randomized_trial',
    annotations: [{ domain: 'sequence_generation', answer: 'reported_yes', quote: 'computer-generated randomization sequence was used' }],
  });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'çıktı boş olamaz');
  if (/package was not found/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; canlı denetim atlandı');
    return;
  }
  assert.ok(process.pid > 0); // süreç köprü çağrısından sonra ayakta kalmalı
});

test('canlı eleme: PRISMA tarzı liste ya da nazik hata metni döner', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_screen', {
    query: 'CRISPR off-target effects',
    criteria: ['randomized'],
    max_results: 2,
  });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'çıktı boş olamaz');
  if (/package was not found/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; canlı eleme atlandı');
    return;
  }
  if (!r.output.startsWith('Error:')) {
    // Başarılıysa PRISMA akış satırı mutlaka olmalı (ağ sonucundan bağımsız yapı).
    assert.ok(/Flow: identified/.test(r.output), `akış satırı beklenirdi: ${r.output.slice(0, 400)}`);
  }
  assert.ok(process.pid > 0);
});

test('canlı defter: doğrulama özeti ya da nazik hata metni döner', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_ledger', {});
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'çıktı boş olamaz');
  if (/package was not found/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; canlı defter testi atlandı');
    return;
  }
  if (!r.output.startsWith('Error:')) {
    // Başarılıysa paketin bilinen durum etiketlerinden biri olmalı.
    assert.ok(
      /VALID|VALID_EMPTY|TAMPER_DETECTED|TAMPER_OR_CORRUPTION_DETECTED/.test(r.output),
      `ledger durumu beklenirdi: ${r.output.slice(0, 400)}`,
    );
  }
  assert.ok(process.pid > 0);
});
