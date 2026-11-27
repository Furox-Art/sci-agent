import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTools, toolGroup } from '@sci/core';

test('toolGroup kategorileri doğru eşler', () => {
  assert.equal(toolGroup('task'), 'AI agents');
  assert.equal(toolGroup('lit_search'), 'Literature (evidence chain)');
  assert.equal(toolGroup('plan_audit'), 'Plan verification');
  assert.equal(toolGroup('scientific_compute'), 'Scientific package bridges');
  assert.equal(toolGroup('molar_mass'), 'Scientific computation');
  assert.equal(toolGroup('read_file'), 'File & code');
  assert.equal(toolGroup('cds1_cli'), 'Scientific package bridges');
  assert.equal(toolGroup('repocraft_cli'), 'Scientific package bridges');
  assert.equal(toolGroup('nomosguard_cli'), 'Scientific package bridges');
  assert.equal(toolGroup('sra_cli'), 'Scientific package bridges');
  assert.equal(toolGroup('polyguard_cli'), 'Scientific package bridges');
  assert.equal(toolGroup('polyglot_cli'), 'Scientific package bridges');
  assert.equal(toolGroup('eq_route'), 'Scientific package bridges');
});

test('groupTools araçları gruplara ayırır', () => {
  const tools = [
    { name: 'read_file' },
    { name: 'task' },
    { name: 'molar_mass' },
    { name: 'read_file2' },
  ];
  const g = groupTools(tools);
  assert.equal(g.get('AI agents').length, 1);
  assert.equal(g.get('Scientific computation').length, 1);
  assert.equal(g.get('File & code').length, 2);
});
