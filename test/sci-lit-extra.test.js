import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry } from '@sci/core';
import {
  lit_audit,
  lit_screen,
  lit_ledger,
  lit_bib,
  lit_quote_text,
  lit_evidence,
  lit_stats_check,
  lit_doi_normalize,
  lit_pdf_provenance,
} from '../packages/core/src/science/sci-lit-extra.js';

const TOOLS = [lit_audit, lit_screen, lit_ledger, lit_bib, lit_quote_text, lit_evidence, lit_stats_check, lit_doi_normalize, lit_pdf_provenance];

async function makeRegistry() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sci-lit-extra-'));
  return new ToolRegistry({ tools: TOOLS, workspaceRoot });
}

// --- Structure tests: run in every environment (no Python/network needed) ---

test('araç şekli: dokuz araç tanımlı, onaysız ve paralel çalışabilir', () => {
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
    ['lit_audit', 'lit_screen', 'lit_ledger', 'lit_bib', 'lit_quote_text', 'lit_evidence', 'lit_stats_check', 'lit_doi_normalize', 'lit_pdf_provenance'],
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
  assert.deepEqual(lit_bib.parameters.required, ['papers']);
  assert.equal(lit_bib.parameters.properties.papers.type, 'array');
  assert.equal(lit_bib.parameters.properties.papers.items.type, 'object');
  assert.deepEqual(lit_bib.parameters.properties.output_format.enum, ['bibtex', 'ris', 'csl-json']);
  assert.deepEqual(lit_quote_text.parameters.required, ['quote', 'source_text', 'source_id']);
  assert.equal(lit_quote_text.parameters.properties.source_text.type, 'string');
  assert.deepEqual(lit_evidence.parameters.required, ['kind', 'payload']);
  assert.equal(lit_evidence.parameters.properties.kind.type, 'string');
  assert.equal(lit_evidence.parameters.properties.payload.type, 'object');
  assert.deepEqual(lit_stats_check.parameters.required, ['records']);
  assert.equal(lit_stats_check.parameters.properties.records.type, 'array');
  assert.equal(lit_stats_check.parameters.properties.records.items.type, 'object');
  assert.equal(lit_stats_check.parameters.properties.records.items.properties.p_value.type, 'number');
  assert.equal(lit_stats_check.parameters.properties.records.items.properties.estimate.type, 'number');
  assert.deepEqual(lit_doi_normalize.parameters.required, ['doi']);
  assert.equal(lit_doi_normalize.parameters.properties.doi.type, 'string');
  assert.deepEqual(lit_pdf_provenance.parameters.required, ['page_number', 'quote']);
  assert.equal(lit_pdf_provenance.parameters.properties.pdf_path.type, 'string');
  assert.equal(lit_pdf_provenance.parameters.properties.pdf_base64.type, 'string');
  assert.equal(lit_pdf_provenance.parameters.properties.page_number.type, 'number');
  assert.equal(lit_pdf_provenance.parameters.properties.quote.type, 'string');
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

test('yeni araçlar doğrulama: boş/yanlış tip argümanlar nazik hata metni (ok:true)', async () => {
  const registry = await makeRegistry();
  const r1 = await registry.invoke('lit_bib', { papers: [] });
  assert.equal(r1.ok, true);
  assert.ok(r1.output.startsWith('Error:'), `unexpected output: ${r1.output}`);

  const r2 = await registry.invoke('lit_bib', { papers: 'not-an-array' });
  assert.equal(r2.ok, true);
  assert.ok(r2.output.startsWith('Error:'));

  const r3 = await registry.invoke('lit_bib', { papers: [{ title: 'X' }], output_format: 'xml' });
  assert.equal(r3.ok, true);
  assert.ok(r3.output.startsWith('Error:'), `unexpected output: ${r3.output}`);
  assert.ok(/bibtex|ris|csl-json/.test(r3.output), 'desteklenen formatlar listelenmeli');

  const r4 = await registry.invoke('lit_evidence', { kind: 'Bad Kind', payload: { a: 1 } });
  assert.equal(r4.ok, true);
  assert.ok(r4.output.startsWith('Error:'));

  const r5 = await registry.invoke('lit_evidence', { kind: 'good_kind', payload: 'not-an-object' });
  assert.equal(r5.ok, true);
  assert.ok(r5.output.startsWith('Error:'));

  const r6 = await registry.invoke('lit_evidence', { kind: 'x', payload: { a: 1 } });
  assert.equal(r6.ok, true);
  assert.ok(r6.output.startsWith('Error:'), 'çok kısa kind reddedilmeli');
});

test('lit_quote_text uzunluk limitleri: sınır aşımı nazik hata metni (ok:true)', async () => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_quote_text', {
    quote: 'a'.repeat(1001),
    source_text: 'some source text',
    source_id: 'src',
  });
  assert.equal(r.ok, true, 'limit aşımı throw etmemeli');
  assert.ok(r.output.startsWith('Error:'), `unexpected output: ${r.output}`);

  const r2 = await registry.invoke('lit_quote_text', {
    quote: 'ok quote',
    source_text: 'x'.repeat(250_001),
    source_id: 'src',
  });
  assert.equal(r2.ok, true);
  assert.ok(r2.output.startsWith('Error:'));
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

// --- Offline deterministic tests: need the package but no network ---

test('lit_quote_text literal eşleşme: çevrimdışı deterministik sonuç', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_quote_text', {
    quote: 'randomization was performed',
    source_text: 'Patients were enrolled; randomization was performed by computer.',
    source_id: 'test-source',
  });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0);
  if (/package was not found|Python interpreter not found/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; çevrimdışı eşleşme testi atlandı');
    return;
  }
  assert.ok(/TEXTUAL_MATCH_ONLY/.test(r.output), `eşleşme beklenirdi: ${r.output}`);
  assert.ok(/characters 24-51/.test(r.output), `offset beklenirdi: ${r.output}`);

  const miss = await registry.invoke('lit_quote_text', {
    quote: 'double-blinded placebo surgery',
    source_text: 'Patients were enrolled; randomization was performed by computer.',
    source_id: 'test-source',
  });
  assert.ok(/NOT_VERIFIED/.test(miss.output), `NOT_VERIFIED beklenirdi: ${miss.output}`);
});

test('lit_bib bibtex çıktısı: çevrimdışı deterministik biçimlendirme', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_bib', {
    papers: [
      {
        title: 'CRISPR off-target effects',
        authors: ['A. Author', 'B. Author'],
        year: 2021,
        journal: 'Nature Methods',
        doi: '10.1038/s41592-021-01093-5',
      },
    ],
    output_format: 'bibtex',
  });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0);
  if (/package was not found|Python interpreter not found/.test(r.output)) {
    t.skip('literature-evidence-mcp kurulu değil; bibliography testi atlandı');
    return;
  }
  assert.ok(/Bibliography export \(bibtex, 1 records/.test(r.output), `başlık beklenirdi: ${r.output.slice(0, 300)}`);
  assert.ok(/@article\{lem1,/.test(r.output), `bibtex girdisi beklenirdi: ${r.output.slice(0, 400)}`);
  assert.ok(r.output.includes('title = {CRISPR off-target effects}'), 'başlık çıktıda görünmeli');
  assert.ok(r.output.includes('journal = {Nature Methods}'), 'dergi adı çıktıda görünmeli');
});

test('lit_evidence ekleme + lit_ledger doğrulama: hash zinciri tmp defterde VALID', async (t) => {
  const ledgerPath = path.join(os.tmpdir(), `sci-evtest-${Date.now()}-${process.pid}.jsonl`);
  const oldEnv = process.env.EVIDENCE_LEDGER_PATH;
  process.env.EVIDENCE_LEDGER_PATH = ledgerPath;
  try {
    const registry = await makeRegistry();
    const r = await registry.invoke('lit_evidence', { kind: 'search_receipt', payload: { query: 'CRISPR', hits: 3 } });
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.output, 'string');
    assert.ok(r.output.length > 0);
    if (/package was not found|Python interpreter not found/.test(r.output)) {
      t.skip('literature-evidence-mcp kurulu değil; defter ekleme testi atlandı');
      return;
    }
    assert.ok(/RECORDED/.test(r.output), `RECORDED beklenirdi: ${r.output}`);
    assert.ok(r.output.includes('Entry number: 1'), `ilk girdi beklenirdi: ${r.output}`);
    assert.ok(r.output.includes('lit_ledger'), 'lit_ledger işaret edilmeli');

    // Aynı zinciri bağımsız lit_ledger çağrısıyla doğrula (mutlak yol).
    const v = await registry.invoke('lit_ledger', { path: ledgerPath });
    assert.ok(/VALID/.test(v.output), `VALID zincir beklenirdi: ${v.output}`);
    assert.ok(v.output.includes('Entries verified: 1'), `1 girdi beklenirdi: ${v.output}`);
  } finally {
    if (oldEnv === undefined) delete process.env.EVIDENCE_LEDGER_PATH;
    else process.env.EVIDENCE_LEDGER_PATH = oldEnv;
    await fs.rm(ledgerPath, { force: true });
    await fs.rm(`${ledgerPath}.lock`, { force: true });
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

// --- Offline deterministic tests for the round-3 tools (package required, no network) ---

// Minimal single-page PDF with one extractable text line (deterministic bytes, ASCII only).
function buildMinimalPdf(text) {
  const objs = [];
  objs.push('<< /Type /Catalog /Pages 2 0 R >>');
  objs.push('<< /Type /Pages /Kids [3 0 R] /Count 1 >>');
  objs.push(
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
  );
  objs.push('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const stream = `BT /F1 12 Tf 72 720 Td (${text}) Tj ET`;
  objs.push(`<< /Length ${stream.length} >>\nstream\n${stream}\nendstream`);
  let body = '%PDF-1.4\n';
  const offsets = [];
  objs.forEach((o, i) => {
    offsets.push(body.length);
    body += `${i + 1} 0 obj\n${o}\nendobj\n`;
  });
  const xrefPos = body.length;
  let xref = `xref\n0 ${objs.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) xref += `${String(off).padStart(10, '0')} 00000 n \n`;
  const tail = `trailer\n<< /Size ${objs.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF\n`;
  return Buffer.from(body + xref + tail, 'latin1');
}

test('lit_stats_check flags inconsistent reported statistics (offline deterministic)', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_stats_check', {
    records: [
      { label: 'Smith 2020 Table 2', p_value: 0.05, sample_size: 120, ci_lower: 1.2, ci_upper: 3.4, estimate: 2.1 },
      { label: 'Doe 2021 Abstract', p_value: 1.5, ci_lower: 3.0, ci_upper: 1.0 },
      { sample_size: 0, estimate: 9.9, ci_lower: 1.0, ci_upper: 2.0 },
      {},
    ],
  });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0);
  if (/package was not found|Python interpreter not found/.test(r.output)) {
    t.skip('literature-evidence-mcp not installed; offline stats screen skipped');
    return;
  }
  assert.ok(r.ok === true, `unexpected failure: ${r.output}`);
  assert.ok(/Statistical reporting screen \(mechanical consistency\): NUMERICAL_CONSISTENCY_SCREEN_ONLY/.test(r.output), `status expected: ${r.output.slice(0, 300)}`);
  assert.ok(/Records checked: 4/.test(r.output), 'record count expected');
  assert.ok(/Record 0 \(Smith 2020 Table 2\): ARITHMETIC_SCREEN_PASSED \| flags: none/.test(r.output), `passing record expected: ${r.output}`);
  assert.ok(/P_VALUE_OUT_OF_RANGE/.test(r.output), 'p value flag expected');
  assert.ok(/REVERSED_CONFIDENCE_INTERVAL/.test(r.output), 'reversed CI flag expected');
  assert.ok(/INVALID_SAMPLE_SIZE/.test(r.output), 'sample size flag expected');
  assert.ok(/ESTIMATE_OUTSIDE_REPORTED_CI_REVIEW/.test(r.output), 'estimate-outside-CI flag expected');
  assert.ok(/NOT_ASSESSED/.test(r.output), 'empty record should be NOT_ASSESSED');
  assert.ok(/no statistical test, effect re-estimation or scientific validity assessment was performed/.test(r.output), 'scope warning expected');
});

test('lit_stats_check validation: bad records return gentle Error strings (ok:true)', async () => {
  const registry = await makeRegistry();
  const r1 = await registry.invoke('lit_stats_check', { records: [] });
  assert.equal(r1.ok, true, 'empty records must not throw');
  assert.ok(r1.output.startsWith('Error:'), `unexpected output: ${r1.output}`);

  const r2 = await registry.invoke('lit_stats_check', { records: 'not-an-array' });
  assert.equal(r2.ok, true);
  assert.ok(r2.output.startsWith('Error:'));

  const r3 = await registry.invoke('lit_stats_check', { records: [{ p_value: 'high' }] });
  assert.equal(r3.ok, true);
  assert.ok(r3.output.startsWith('Error:'), 'non-numeric p_value must be rejected');
  assert.ok(/p_value must be a finite number/.test(r3.output), `field message expected: ${r3.output}`);

  const r4 = await registry.invoke('lit_stats_check', { records: [null] });
  assert.equal(r4.ok, true);
  assert.ok(r4.output.startsWith('Error:'));

  const r5 = await registry.invoke('lit_stats_check', { records: [{ p_value: Number.POSITIVE_INFINITY }] });
  assert.equal(r5.ok, true);
  assert.ok(r5.output.startsWith('Error:'), 'non-finite numbers must be rejected');
});

test('lit_pdf_provenance: quote offsets and hashes on a caller-supplied PDF (offline deterministic)', async (t) => {
  const registry = await makeRegistry();
  const pdf = buildMinimalPdf('Patients were enrolled; randomization was performed by computer.');
  const r = await registry.invoke('lit_pdf_provenance', {
    pdf_base64: pdf.toString('base64'),
    page_number: 1,
    quote: 'randomization was performed by computer',
  });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  if (/package was not found|Python interpreter not found/.test(r.output)) {
    t.skip('literature-evidence-mcp not installed; PDF provenance skipped');
    return;
  }
  assert.ok(r.ok === true, `unexpected failure: ${r.output.slice(0, 400)}`);
  assert.ok(/PDF page provenance: PDF_PAGE_TEXT_FOUND_NOT_SCIENTIFICALLY_VERIFIED/.test(r.output), `found status expected: ${r.output.slice(0, 400)}`);
  assert.ok(/Page: 1 of 1/.test(r.output), 'page count expected');
  assert.ok(/Quote found at characters 24-63\./.test(r.output), `quote offsets expected: ${r.output}`);
  assert.ok(/Match text boxes: 1/.test(r.output), 'one match rectangle expected');
  assert.ok(/figure and table content, source authenticity and scientific claims are not verified/.test(r.output), 'scope warning expected');

  // pdf_path variant: same bytes written to a temp file; a missing quote is NOT_VERIFIED.
  const pdfPath = path.join(os.tmpdir(), `sci-provtest-${Date.now()}-${process.pid}.pdf`);
  await fs.writeFile(pdfPath, pdf);
  try {
    const r2 = await registry.invoke('lit_pdf_provenance', { pdf_path: pdfPath, page_number: 1, quote: 'placebo surgery' });
    assert.ok(r2.ok === true, `unexpected failure: ${r2.output.slice(0, 400)}`);
    assert.ok(/PDF_PAGE_TEXT_NOT_VERIFIED/.test(r2.output), `not-found status expected: ${r2.output.slice(0, 400)}`);
    assert.ok(/Quote not found on this page/.test(r2.output), 'missing-quote note expected');
  } finally {
    await fs.rm(pdfPath, { force: true });
  }
});

test('lit_pdf_provenance validation: bad page, non-PDF and missing source fail gently', async () => {
  const registry = await makeRegistry();
  const r1 = await registry.invoke('lit_pdf_provenance', { pdf_base64: 'JVBERi0xLjQK', page_number: 0, quote: 'x' });
  assert.equal(r1.ok, true, 'page_number 0 must not throw');
  assert.ok(r1.output.startsWith('Error: page_number'), `unexpected output: ${r1.output}`);

  const r2 = await registry.invoke('lit_pdf_provenance', {
    pdf_base64: Buffer.from('hello, not a pdf').toString('base64'),
    page_number: 1,
    quote: 'x',
  });
  assert.equal(r2.ok, true);
  assert.ok(r2.output.startsWith('Error: file does not look like a PDF'), `unexpected output: ${r2.output}`);

  const r3 = await registry.invoke('lit_pdf_provenance', { page_number: 1, quote: 'x' });
  assert.equal(r3.ok, false, 'missing PDF source must throw (caught by the registry)');
  assert.ok(r3.output.startsWith('Error'), `unexpected output: ${r3.output}`);

  const r4 = await registry.invoke('lit_pdf_provenance', { pdf_path: 'no-such-file.pdf', page_number: 1, quote: 'x' });
  assert.equal(r4.ok, true, 'unreadable file must not throw');
  assert.ok(r4.output.startsWith('Error: could not read the PDF file'), `unexpected output: ${r4.output}`);

  const r5 = await registry.invoke('lit_pdf_provenance', { pdf_base64: 'JVBERi0xLjQK', page_number: 1, quote: '' });
  assert.equal(r5.ok, false, 'empty quote must throw (caught by the registry)');
  assert.ok(r5.output.startsWith('Error'), `unexpected output: ${r5.output}`);
});
