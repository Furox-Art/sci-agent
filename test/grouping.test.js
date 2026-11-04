import { test } from 'node:test';
import assert from 'node:assert/strict';
import { groupTools, toolGroup } from '@sci/core';

test('toolGroup kategorileri doğru eşler', () => {
  assert.equal(toolGroup('task'), 'Yapay zekâ ajanları');
  assert.equal(toolGroup('lit_search'), 'Literatür (kanıt zinciri)');
  assert.equal(toolGroup('plan_audit'), 'Plan doğrulama');
  assert.equal(toolGroup('furox_compute'), 'Bilimsel paket köprüleri');
  assert.equal(toolGroup('molar_mass'), 'Bilimsel hesaplama');
  assert.equal(toolGroup('read_file'), 'Dosya & kod');
  assert.equal(toolGroup('cds1_cli'), 'Bilimsel paket köprüleri');
  assert.equal(toolGroup('repocraft_cli'), 'Bilimsel paket köprüleri');
  assert.equal(toolGroup('nomosguard_cli'), 'Bilimsel paket köprüleri');
  assert.equal(toolGroup('eq_route'), 'Bilimsel paket köprüleri');
});

test('groupTools araçları gruplara ayırır', () => {
  const tools = [
    { name: 'read_file' },
    { name: 'task' },
    { name: 'molar_mass' },
    { name: 'read_file2' },
  ];
  const g = groupTools(tools);
  assert.equal(g.get('Yapay zekâ ajanları').length, 1);
  assert.equal(g.get('Bilimsel hesaplama').length, 1);
  assert.equal(g.get('Dosya & kod').length, 2);
});
