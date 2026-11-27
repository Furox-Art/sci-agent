import { test } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync } from 'node:fs';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { ToolRegistry } from '@sci/core';
import { resolvePython, findPythonScript } from '../packages/core/src/science/pybridge.js';
import { plan_audit } from '../packages/core/src/science/sci-audit.js';

// plan-auditor kurulu mu? (exe yolu ya da python -m supervisor.cli ile kontrol)
const pyExe = resolvePython();
let hasPlanAuditor = false;
if (pyExe) {
  const exe = findPythonScript(pyExe, 'plan-auditor');
  if (exe) {
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

test('plan_audit schema and description', () => {
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
  // The description must list actual subcommands verified with --help.
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
    assert.ok(plan_audit.description.includes(c), `missing subcommand in description: ${c}`);
  }
});

test('plan_audit --help returns usage', { skip: hasPlanAuditor ? false : 'plan-auditor is not installed' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-audit-'));
  const r = makeRegistry(root);
  const s = await r.invoke('plan_audit', { args: ['--help'] });
  assert.ok(s.ok, s.output);
  assert.equal(typeof s.output, 'string');
  assert.ok(s.output.trim().length >= 20, 'output must contain at least 20 characters');
  assert.match(s.output.toLowerCase(), /usage/);
  // Help output must include the actual subcommands.
  assert.match(s.output, /supervisor/);
  assert.match(s.output, /doctor/);
});

test('plan_audit returns text for empty arguments without crashing', { skip: hasPlanAuditor ? false : 'plan-auditor is not installed' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-audit-'));
  const r = makeRegistry(root);
  const s = await r.invoke('plan_audit', { args: [] });
  assert.equal(typeof s.output, 'string');
  assert.ok(s.output.length > 0);
  assert.match(s.output, /usage|Hata/);
});

test('plan_audit returns a string and Error/usage on unknown subcommand', { skip: hasPlanAuditor ? false : 'plan-auditor is not installed' }, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-audit-'));
  const r = makeRegistry(root);
  const s = await r.invoke('plan_audit', { args: ['bu-komut-yok'] });
  // The CLI exits nonzero here (observed code: 2); the tool must still
  // return a string containing an error or usage message regardless of ok status.
  assert.equal(typeof s.output, 'string');
  assert.match(s.output, /Error|usage/i);
  assert.match(s.output, /exit code: (?!0\b)/, 'exit code must be reported as non-zero');
});
