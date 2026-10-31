import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ToolRegistry } from '@sci/core';
import { resolvePython, pythonScriptsDir } from '../packages/core/src/science/pybridge.js';
import { plan_audit } from '../packages/core/src/science/sci-audit.js';

// plan-auditor kurulu mu? (exe yolu ya da python -m supervisor.cli ile kontrol)
const pyExe = resolvePython();
let hasPlanAuditor = false;
if (pyExe) {
  const exe = path.join(pythonScriptsDir(pyExe), 'plan-auditor.exe');
  if (existsSync(exe)) {
    hasPlanAuditor = spawnSync(exe, ['--help'], { timeout: 30000, windowsHide: true }).status === 0;
  } else {
    hasPlanAuditor =
      spawnSync(pyExe, ['-X', 'utf8', '-m', 'supervisor.cli', '--help'], { timeout: 30000, windowsHide: true })
        .status === 0;
  }
}

function makeRegistry(root) {
  return new ToolRegistry({ tools: [plan_audit], workspaceRoot: root, approve: async () => true });
}

test('plan_audit araç şekli ve açıklaması', () => {
  assert.equal(plan_audit.name, 'plan_audit');
  assert.equal(plan_audit.needsApproval, true);
  assert.equal(plan_audit.parallel, true);
  assert.equal(typeof plan_audit.execute, 'function');
  assert.equal(typeof plan_audit.description, 'string');
  assert.ok(plan_audit.description.trim().length >= 20);
  assert.deepEqual(plan_audit.parameters.required, ['args']);
  assert.equal(plan_audit.parameters.properties.args.type, 'array');
  assert.equal(plan_audit.parameters.properties.args.items.type, 'string');
  assert.equal(plan_audit.parameters.properties.timeoutMs.type, 'number');
  // açıklama --help'ten doğrulanmış gerçek alt komutları listelemeli (uydurma yok)
  const subcommands = [
    'supervisor',
    'task',
    'plan',
    'evidence',
    'integrity',
    'request',
    'agents',
    'audit',
    'doctor',
    'run',
    'validate',
  ];
  for (const c of subcommands) {
    assert.ok(plan_audit.description.includes(c), `açıklamada alt komut eksik: ${c}`);
  }
});

test('plan_audit --help usage çıktısı verir', { skip: hasPlanAuditor ? false : 'plan-auditor kurulu değil' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-audit-'));
  const r = makeRegistry(root);
  const s = await r.invoke('plan_audit', { args: ['--help'] });
  assert.ok(s.ok, s.output);
  assert.equal(typeof s.output, 'string');
  assert.ok(s.output.trim().length >= 20, 'çıktı 20+ karakter olmalı');
  assert.match(s.output.toLowerCase(), /usage/);
  // help çıktısı gerçek alt komutları da içermeli
  assert.match(s.output, /supervisor/);
  assert.match(s.output, /doctor/);
});

test('plan_audit boş args ile süreç patlamadan string döner', { skip: hasPlanAuditor ? false : 'plan-auditor kurulu değil' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-audit-'));
  const r = makeRegistry(root);
  const s = await r.invoke('plan_audit', { args: [] });
  assert.equal(typeof s.output, 'string');
  assert.ok(s.output.length > 0);
  assert.match(s.output, /usage|Hata/);
});

test('plan_audit bilinmeyen alt komutta string ve Hata/usage döner', { skip: hasPlanAuditor ? false : 'plan-auditor kurulu değil' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-audit-'));
  const r = makeRegistry(root);
  const s = await r.invoke('plan_audit', { args: ['bu-komut-yok'] });
  // CLI bu durumda sıfırdan farklı çıkış koduyla biter (doğrulandı: 2); araç yine de
  // ok:true|false fark etmeksizin dize döndürmeli ve hatayı/usage'ı içermeli.
  assert.equal(typeof s.output, 'string');
  assert.match(s.output, /Hata|usage/i);
  assert.match(s.output, /çıkış kodu: (?!0\b)/, 'çıkış kodu bildirimi sıfırdan farklı olmalı');
});
