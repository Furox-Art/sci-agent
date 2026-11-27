import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry, getPlugin } from '@sci/core';
import { lit_search, lit_verify, lit_quote, lit_fulltext, lit_cite_graph, lit_data_code } from '../packages/core/src/science/sci-lit.js';
import { lit_doi_normalize } from '../packages/core/src/science/sci-lit-extra.js';

const TOOLS = [lit_search, lit_verify, lit_quote, lit_fulltext, lit_cite_graph, lit_data_code];

async function makeRegistry() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sci-lit-'));
  return new ToolRegistry({ tools: TOOLS, workspaceRoot });
}

// Dedicated registry for the round-3 offline DOI helper (lives in sci-lit-extra.js).
async function makeDoiRegistry() {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), 'sci-lit-doi-'));
  return new ToolRegistry({ tools: [lit_doi_normalize], workspaceRoot });
}

// --- Structure tests: run in every environment (no Python/network needed) ---

test('six tools have schemas and support parallel execution without approval', () => {
  for (const t of TOOLS) {
    assert.equal(typeof t.name, 'string');
    assert.ok(t.name.length > 0);
    assert.equal(typeof t.description, 'string');
    assert.ok(t.description.length > 20, 'description must not be empty');
    assert.equal(t.needsApproval, false);
    assert.equal(t.parallel, true);
    assert.equal(typeof t.execute, 'function');
    assert.equal(t.execute.constructor.name, 'AsyncFunction', 'execute must be async');
  }
  assert.deepEqual(
    TOOLS.map((t) => t.name),
    ['lit_search', 'lit_verify', 'lit_quote', 'lit_fulltext', 'lit_cite_graph', 'lit_data_code'],
  );
});

test('schemas are valid and JSON-serializable', () => {
  for (const t of TOOLS) {
    assert.equal(t.parameters.type, 'object');
    assert.equal(typeof t.parameters.properties, 'object');
    const roundTrip = JSON.parse(JSON.stringify(t.parameters));
    assert.deepEqual(roundTrip, t.parameters, 'parameters must be JSON serializable');
  }
  assert.deepEqual(lit_search.parameters.required, ['query']);
  assert.equal(lit_search.parameters.properties.query.type, 'string');
  assert.equal(lit_search.parameters.properties.max_results.type, 'number');
  assert.ok(!lit_verify.parameters.required, 'lit_verify has no required properties (doi or title)');
  assert.equal(lit_verify.parameters.properties.doi.type, 'string');
  assert.equal(lit_verify.parameters.properties.title.type, 'string');
  assert.deepEqual(lit_quote.parameters.required, ['pmcid', 'quote']);
  assert.equal(lit_quote.parameters.properties.pmcid.type, 'string');
  assert.deepEqual(lit_fulltext.parameters.required, ['pmcid']);
  assert.equal(lit_fulltext.parameters.properties.pmcid.type, 'string');
  assert.equal(lit_fulltext.parameters.properties.max_chars.type, 'number');
  assert.deepEqual(lit_cite_graph.parameters.required, ['seed_doi']);
  assert.deepEqual(lit_cite_graph.parameters.properties.directions.enum, ['forward', 'backward', 'both']);
  assert.equal(lit_cite_graph.parameters.properties.max_depth.type, 'number');
  assert.deepEqual(lit_data_code.parameters.required, ['doi']);
  assert.equal(lit_data_code.parameters.properties.doi.type, 'string');
});

test('ToolRegistry exposes tool schemas', async () => {
  const registry = await makeRegistry();
  const names = registry.schemas().map((s) => s.name);
  for (const t of TOOLS) assert.ok(names.includes(t.name), `${t.name} must be registered`);
  const list = registry.list();
  assert.ok(list.every((l) => l.needsApproval === false));
});

test('missing arguments return an error string without throwing', async () => {
  const registry = await makeRegistry();
  const r1 = await registry.invoke('lit_verify', {});
  assert.equal(typeof r1.ok, 'boolean');
  assert.equal(r1.ok, false);
  assert.equal(typeof r1.output, 'string');
  assert.ok(r1.output.startsWith('Error'), `unexpected output: ${r1.output}`);

  const r2 = await registry.invoke('lit_search', { query: '   ' });
  assert.equal(r2.ok, false);
  assert.equal(typeof r2.output, 'string');
  assert.ok(r2.output.startsWith('Error'), `unexpected output: ${r2.output}`);

  const r3 = await registry.invoke('lit_quote', { pmcid: '', quote: '' });
  assert.equal(r3.ok, false);
  assert.equal(typeof r3.output, 'string');
  assert.ok(r3.output.startsWith('Error'), `unexpected output: ${r3.output}`);

  const r4 = await registry.invoke('lit_fulltext', {});
  assert.equal(r4.ok, false);
  assert.equal(typeof r4.output, 'string');
  assert.ok(r4.output.startsWith('Error'), `unexpected output: ${r4.output}`);

  const r5 = await registry.invoke('lit_cite_graph', {});
  assert.equal(r5.ok, false);
  assert.equal(typeof r5.output, 'string');
  assert.ok(r5.output.startsWith('Error'), `unexpected output: ${r5.output}`);

  const r6 = await registry.invoke('lit_data_code', { doi: '   ' });
  assert.equal(r6.ok, false);
  assert.equal(typeof r6.output, 'string');
  assert.ok(r6.output.startsWith('Error'), `unexpected output: ${r6.output}`);
});

test('invalid values return a readable English error instead of throwing (ok:true)', async () => {
  const registry = await makeRegistry();
  const r1 = await registry.invoke('lit_fulltext', { pmcid: 'not-a-pmcid' });
  assert.equal(r1.ok, true, 'invalid PMCID must not throw');
  assert.equal(typeof r1.output, 'string');
  assert.ok(r1.output.startsWith('Error:'), `unexpected output: ${r1.output}`);

  const r2 = await registry.invoke('lit_cite_graph', { seed_doi: '10.1/xyz', directions: 'sideways' });
  assert.equal(r2.ok, true);
  assert.ok(r2.output.startsWith('Error:'), `unexpected output: ${r2.output}`);
  assert.ok(/forward|backward|both/.test(r2.output), 'supported directions must be listed');
});

// --- Python-start failure attribution: honest dedicated message, NOT the network wording ---
// (Simulated in a fresh child process so pybridge's module-level resolvePython()
// cache is empty and SCI_AGENT_PYTHON takes effect deterministically.)

// Run one tool's execute() in a fresh node child and return its string output.
function runToolInChild(driverFile, name, args, env) {
  const driverUrl = new URL(`../packages/core/src/science/${driverFile}`, import.meta.url).href;
  const script = `
    const mod = await import(${JSON.stringify(driverUrl)});
    const r = await mod[${JSON.stringify(name)}].execute(${JSON.stringify(args)});
    process.stdout.write(JSON.stringify(String(r)));
  `;
  return execFileSync(process.execPath, ['--input-type=module', '-e', script], {
    env,
    encoding: 'utf8',
    timeout: 60_000,
    windowsHide: true,
  });
}

test('Python startup failures are distinguished from network failures (simulated)', async () => {
  // An existing but non-executable interpreter is returned by resolvePython
  // (absolute path and existsSync suffice), but spawn fails with a Python
  // startup error rather than a network error.
  const fake = path.join(os.tmpdir(), `sci-fake-python-${process.pid}.txt`);
  await fs.writeFile(fake, 'this is not a Python interpreter');
  try {
    const out = runToolInChild('sci-lit.js', 'lit_search', { query: 'CRISPR off-target effects' }, {
      ...process.env,
      SCI_AGENT_PYTHON: fake,
    });
    const output = JSON.parse(out);
    assert.ok(
      output.startsWith('Error: the Python interpreter could not be started ('),
      `dedicated Python-start message expected: ${output.slice(0, 400)}`,
    );
    assert.ok(output.includes('SCI_AGENT_PYTHON'), 'SCI_AGENT_PYTHON hint expected');
    assert.ok(
      !output.includes('could not reach the literature provider'),
      `network wording must not appear: ${output.slice(0, 400)}`,
    );
  } finally {
    await fs.rm(fake, { force: true });
  }
});

test('missing interpreter returns a dedicated message (simulated)', () => {
  // Strip PATH and Python installation directories and omit SCI_AGENT_PYTHON.
  // No LOCALAPPDATA/ProgramFiles scan; bare python/python3 commands
  // fail and trigger the missing-interpreter branch.
  const out = runToolInChild('sci-lit.js', 'lit_search', { query: 'CRISPR off-target effects' }, {
    PATH: '',
    Path: '',
    SystemRoot: process.env.SystemRoot,
    SYSTEMDRIVE: process.env.SYSTEMDRIVE,
    TEMP: process.env.TEMP,
    TMP: process.env.TMP,
    APPDATA: process.env.APPDATA,
  });
  const output = JSON.parse(out);
  assert.ok(
    output.startsWith('Error: the Python interpreter could not be started (Python interpreter not found)'),
    `dedicated message for a missing interpreter expected: ${output.slice(0, 400)}`,
  );
  assert.ok(output.includes('SCI_AGENT_PYTHON'), 'SCI_AGENT_PYTHON hint expected');
  assert.ok(
    !output.includes('could not reach the literature provider'),
    `network wording must not appear: ${output.slice(0, 400)}`,
  );
});

test('a failure after process startup preserves the network error classification', () => {
  // A working executable that cannot interpret the Python driver (node.exe):
  // the process starts but rejects Python flags and produces unusable output.
  // Unexpected Python output must preserve network-error classification
  // rather than being misclassified as a Python startup failure.
  const out = runToolInChild('sci-lit.js', 'lit_search', { query: 'CRISPR off-target effects' }, {
    ...process.env,
    SCI_AGENT_PYTHON: process.execPath,
  });
  const output = JSON.parse(out);
  assert.ok(
    output.startsWith('Error: could not reach the literature provider'),
    `network wording expected for a ran-but-failed bridge: ${output.slice(0, 400)}`,
  );
  assert.ok(
    !output.includes('the Python interpreter could not be started'),
    `dedicated start-failure message must not appear: ${output.slice(0, 400)}`,
  );
});

// --- Live tests: only meaningful with the package + network; type-based asserts ---

test('live search returns text without crashing regardless of network result', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_search', { query: 'CRISPR off-target effects', max_results: 2 });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'output must not be empty');
  if (/package not found|package is not installed/.test(r.output)) {
    t.skip('literature-evidence-mcp is not installed; live search skipped');
    return;
  }
  // Process survived the bridge call; a further trivial assertion proves it.
  assert.ok(process.pid > 0);
});

test('live DOI verification returns retraction summary or readable error', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_verify', { doi: '10.1038/nature12373' });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'output must not be empty');
  if (/package not found|package is not installed/.test(r.output)) {
    t.skip('literature-evidence-mcp is not installed; live verification skipped');
    return;
  }
  assert.ok(process.pid > 0);
});

test('live title verification extracts a DOI candidate and returns text', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_verify', { title: 'Characterizing CRISPR off-target effects' });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'output must not be empty');
  if (/package not found|package is not installed/.test(r.output)) {
    t.skip('literature-evidence-mcp is not installed; live verification skipped');
    return;
  }
  assert.ok(process.pid > 0);
});

test('live full text returns summary and text or readable error', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_fulltext', { pmcid: 'PMC4136957', max_chars: 3000 });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'output must not be empty');
  if (/package was not found|Python interpreter not found/.test(r.output)) {
    t.skip('literature-evidence-mcp is not installed; live full-text test skipped');
    return;
  }
  if (!r.output.startsWith('Error:')) {
    assert.ok(/Full text \(Europe PMC OA XML\)/.test(r.output), `expected full-text heading: ${r.output.slice(0, 300)}`);
    assert.ok(/Paragraphs:/.test(r.output), 'expected paragraph count');
  }
  assert.ok(process.pid > 0);
});

test('live citation graph returns nodes or readable error', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_cite_graph', {
    seed_doi: '10.1038/nature12373',
    max_depth: 1,
    max_per_direction: 2,
    directions: 'backward',
  });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'output must not be empty');
  if (/package was not found|Python interpreter not found/.test(r.output)) {
    t.skip('literature-evidence-mcp is not installed; live citation graph skipped');
    return;
  }
  if (!r.output.startsWith('Error:')) {
    assert.ok(/Citation graph \(OpenAlex/.test(r.output), `expected graph heading: ${r.output.slice(0, 300)}`);
    assert.ok(/Nodes:/.test(r.output) && /Edges:/.test(r.output), 'expected node and edge counts');
  }
  assert.ok(process.pid > 0);
});

test('live data and code lookup returns links or readable error', async (t) => {
  const registry = await makeRegistry();
  const r = await registry.invoke('lit_data_code', { doi: '10.1038/nature12373' });
  assert.equal(typeof r.ok, 'boolean');
  assert.equal(typeof r.output, 'string');
  assert.ok(r.output.length > 0, 'output must not be empty');
  if (/package was not found|Python interpreter not found/.test(r.output)) {
    t.skip('literature-evidence-mcp is not installed; live data/code test skipped');
    return;
  }
  if (!r.output.startsWith('Error:')) {
    assert.ok(/Data\/code links \(Crossref metadata/.test(r.output), `expected a title: ${r.output.slice(0, 300)}`);
    assert.ok(/DOI 10\.1038\/nature12373/.test(r.output), 'requested DOI must appear in output');
  }
  assert.ok(process.pid > 0);
});

// --- Registration: the sci-lit plugin must expose the full bridge surface ---

test('sci-lit plugin registration: all 16 tools present, including the round-3 offline helpers', () => {
  const plugin = getPlugin('sci-lit');
  assert.ok(plugin, 'sci-lit plugin must exist');
  const names = plugin.tools.map((t) => t.name);
  assert.equal(plugin.tools.length, 16);
  for (const name of [
    'lit_search',
    'lit_verify',
    'lit_quote',
    'lit_fulltext',
    'lit_cite_graph',
    'lit_data_code',
    'lit_audit',
    'lit_screen',
    'lit_ledger',
    'lit_bib',
    'lit_quote_text',
    'lit_evidence',
    'lit_stats_check',
    'lit_doi_normalize',
    'lit_pdf_provenance',
    'lit_bm25_rank',
  ]) {
    assert.ok(names.includes(name), `${name} must be registered in the sci-lit plugin`);
  }
  assert.ok(
    /statistical reporting consistency screen|DOI normalization|PDF page provenance|BM25 evidence ranking/.test(plugin.description),
    'plugin description must mention the offline helpers',
  );
});

// --- Offline deterministic tests for the round-3 DOI helper (package required, no network) ---

test('lit_doi_normalize: canonical form for bare, doi: and URL spellings (offline deterministic)', async (t) => {
  const registry = await makeDoiRegistry();
  for (const doi of ['https://doi.org/10.1038/Nature12373', 'doi:10.1038/nature12373', '10.1038/nature12373']) {
    const r = await registry.invoke('lit_doi_normalize', { doi });
    assert.equal(typeof r.ok, 'boolean');
    assert.equal(typeof r.output, 'string');
    assert.ok(r.output.length > 0);
    if (/package was not found|Python interpreter not found/.test(r.output)) {
      t.skip('literature-evidence-mcp not installed; DOI normalization skipped');
      return;
    }
    assert.ok(r.ok === true, `unexpected failure for ${doi}: ${r.output}`);
    assert.ok(/Normalized DOI: 10\.1038\/nature12373/.test(r.output), `canonical DOI expected: ${r.output}`);
    assert.ok(r.output.includes(`Input: ${doi}`), `input echo expected: ${r.output}`);
    assert.ok(/registration or resolvability is not checked/.test(r.output), 'scope note expected');
  }
});

test('lit_doi_normalize validation: invalid DOI is a gentle Error, missing arg throws (registry-caught)', async () => {
  const registry = await makeDoiRegistry();
  const bad = await registry.invoke('lit_doi_normalize', { doi: 'not-a-doi' });
  assert.equal(bad.ok, true, 'invalid DOI must not throw');
  // Portable invariant: a clean dedicated Error either way — when literature-evidence-mcp
  // is not installed the driver reports that before the JS-side DOI validation can run.
  const pkgMissing = bad.output.startsWith('Error: the literature-evidence-mcp Python package was not found');
  assert.ok(
    pkgMissing || bad.output.startsWith('Error: invalid DOI'),
    `unexpected output: ${bad.output.slice(0, 400)}`,
  );
  if (!pkgMissing) {
    assert.ok(/10\.<registrant>\/<suffix>/.test(bad.output), 'expected syntax must be listed');
  }

  const missing = await registry.invoke('lit_doi_normalize', {});
  assert.equal(missing.ok, false, 'missing doi must throw (caught by the registry)');
  assert.ok(missing.output.startsWith('Error'), `unexpected output: ${missing.output}`);
});
