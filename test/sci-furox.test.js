import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { DEFAULT_CONFIG, createRegistry } from '@sci/core';
import { resolvePython } from '../packages/core/src/science/pybridge.js';
import { sra_cli, polyguard_cli, polyglot_cli } from '../packages/core/src/science/sci-furox.js';

const pyExe = resolvePython();
const hasPython = pyExe && spawnSync(pyExe, ['-I', '-c', 'print(1)'], { timeout: 15000 }).status === 0;

let hasAxiomize = false;
let hasCds2 = false;
if (hasPython) {
  hasAxiomize = spawnSync(pyExe, ['-I', '-c', 'import axiomize'], { timeout: 30000 }).status === 0;
  hasCds2 = spawnSync(pyExe, ['-I', '-c', 'import cds2'], { timeout: 30000 }).status === 0;
}

function makeRegistry(root) {
  return createRegistry({
    cfg: { agent: { workspaceRoot: root }, plugins: DEFAULT_CONFIG.plugins, policies: DEFAULT_CONFIG.policies },
    approve: async () => true,
  });
}

test('scientific_compute reports installed packages and computes a result', { skip: hasPython ? false : 'Python is not installed' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const r = makeRegistry(root);
  const s = await r.invoke('scientific_compute', { code: 'print(round(6*7, 3)); print(__import__("numpy").__version__.split(".")[0])' });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /LOADED PACKAGES: /);
  assert.match(s.output, /42/);
});

test('axiomize_cli lists capabilities', { skip: hasAxiomize ? false : 'axiomize is not installed' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const r = makeRegistry(root);
  const s = await r.invoke('axiomize_cli', { args: ['capabilities'] });
  assert.ok(s.ok || /usage|command/i.test(s.output), s.output.slice(0, 400));
  assert.ok(s.output.trim().length > 20);
});

test('cds2_cli info subcommand works', { skip: hasCds2 ? false : 'cds2 is not installed' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const r = makeRegistry(root);
  const s = await r.invoke('cds2_cli', { args: ['info'] });
  assert.ok(s.ok || /usage|info/i.test(s.output), s.output.slice(0, 400));
});

test('python_eval resolves Python independently of PATH', { skip: hasPython ? false : 'Python is not installed' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const r = makeRegistry(root);
  const s = await r.invoke('python_eval', { code: 'print("ok-pybridge")' });
  assert.ok(s.ok, s.output);
  assert.match(s.output, /ok-pybridge/);
});

test('sra_cli --help usage verir', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const r = createRegistry({
    cfg: { agent: { workspaceRoot: root }, plugins: ['sci-furox'], policies: DEFAULT_CONFIG.policies },
    approve: async () => true,
  });
  const s = await r.invoke('sra_cli', { args: ['--help'] });
  assert.ok(s.output.trim().length > 20, s.output.slice(0, 200));
});

test('polyguard_cli --help usage verir', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const r = createRegistry({
    cfg: { agent: { workspaceRoot: root }, plugins: ['sci-furox'], policies: DEFAULT_CONFIG.policies },
    approve: async () => true,
  });
  const s = await r.invoke('polyguard_cli', { args: ['--help'] });
  assert.ok(s.output.trim().length > 20, s.output.slice(0, 200));
});

test('polyglot_cli --help usage verir', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const r = createRegistry({
    cfg: { agent: { workspaceRoot: root }, plugins: ['sci-furox'], policies: DEFAULT_CONFIG.policies },
    approve: async () => true,
  });
  const s = await r.invoke('polyglot_cli', { args: ['--help'] });
  assert.ok(s.output.trim().length > 20, s.output.slice(0, 200));
});
