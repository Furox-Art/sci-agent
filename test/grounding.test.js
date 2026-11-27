import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry, MockProvider, runAgentLoop, findUngroundedClaims } from '@sci/core';

// Deterministik kanıt kapısı ("uydurmaya yasak"): bir koşuda hiç araç çalışmadan
// sayısal/literatür iddiası içeren final yanıt, doğrulanmamış olarak işaretlenir.

test('findUngroundedClaims: istatistik, ölçüm ve literatür iddialarını yakalar', () => {
  const kinds = (t) => findUngroundedClaims(t).map((c) => c.kind);
  assert.ok(kinds('The effect was significant (p = 0.03).').includes('statistics'));
  assert.ok(kinds('n = 48 katılımcı vardı').includes('statistics'));
  assert.ok(kinds('Doz 25 mg/kg olarak verildi.').includes('measurement'));
  assert.ok(kinds('Verim %87.5 bulundu.').includes('measurement'));
  assert.ok(kinds('E = 2.718 sonucu elde edilir.').includes('equation'));
  assert.ok(kinds('See doi:10.1038/s41586-020-2649-2 for details.').includes('literature'));
});

test('findUngroundedClaims: iddia içermeyen düz metinde boş döner', () => {
  assert.deepEqual(findUngroundedClaims('Merhaba, bugün nasılsın?'), []);
  assert.deepEqual(findUngroundedClaims('Dosyayı okudum ve özeti aşağıya yazdım.'), []);
  assert.deepEqual(findUngroundedClaims(''), []);
  assert.deepEqual(findUngroundedClaims(undefined), []);
});

test('kanıt kapısı: araç çalışmadan sayısal iddia -> uyarı + doğrulama isteği', async () => {
  const provider = new MockProvider([{ content: 'Ortalama 12.4 mg/L ve p = 0.01.' }, { content: 'Araçla doğruladım.' }]);
  const messages = [
    { role: 'system', content: 'test' },
    { role: 'user', content: 'ölçümü söyle' },
  ];
  const events = [];
  const res = await runAgentLoop({
    provider,
    registry: { schemas: () => [], get: () => null },
    messages,
    onEvent: (e) => events.push(e),
    maxSteps: 4,
  });

  assert.equal(res.done, true);
  assert.equal(res.unverified, undefined);
  assert.equal(provider.calls.length, 2, 'kanıt kapısı ikinci bir model turu ister');
  const warnings = events.filter((e) => e.type === 'warning');
  assert.equal(warnings.length, 1);
  assert.equal(warnings[0].reason, 'ungrounded_claims');
  assert.ok(warnings[0].claims.length >= 1);
  // Uyarı yalnızca o turun sistem istemine eklenir; kalıcı geçmiş kirlenmez.
  assert.match(provider.calls[1].messages[0].content, /Grounding check/);
  assert.ok(!JSON.stringify(messages).includes('Grounding check'));
});

test('kanıt kapısı: uyarıdan sonra da araç yoksa yanıt doğrulanmamış işaretlenir', async () => {
  const provider = new MockProvider([{ content: 'p = 0.04, n = 30.' }, { content: 'p = 0.04, n = 30.' }]);
  const messages = [
    { role: 'system', content: 'test' },
    { role: 'user', content: 'sonucu ver' },
  ];
  const events = [];
  const res = await runAgentLoop({
    provider,
    registry: { schemas: () => [], get: () => null },
    messages,
    onEvent: (e) => events.push(e),
    maxSteps: 4,
  });

  assert.equal(res.done, false);
  assert.equal(res.unverified, true);
  assert.ok(res.unverifiedClaims.length >= 1);
  assert.equal(provider.calls.length, 2, 'düzeltici tur yalnızca bir kez yapılır');
  assert.equal(events.filter((e) => e.type === 'warning').length, 2);
});

test('unrelated write is not evidence', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-grounding-'));
  const provider = new MockProvider([
    { toolCalls: [{ name: 'write_file', arguments: { path: 'olcum.txt', content: '12.4' } }] },
    { content: 'p = 0.01 [E1].' },
    { content: 'p = 0.01 [E1].' },
  ]);
  const registry = new ToolRegistry({ workspaceRoot: root, approve: async () => true });
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages: [{ role: 'system', content: 'test' }, { role: 'user', content: 'x' }], onEvent: e => events.push(e), maxSteps: 4 });
  assert.equal(res.done, false);
  assert.equal(res.unverified, true);
  assert.equal(res.research.evidence.length, 0);
  assert.equal(events.filter(e => e.type === 'text_delta' || e.type === 'text').length, 0);
});

test('kanıt kapısı: grounding:false ile kapatılabilir', async () => {
  const provider = new MockProvider([{ content: 'Ortalama 12.4 mg/L.' }]);
  const events = [];
  const res = await runAgentLoop({
    provider,
    registry: { schemas: () => [], get: () => null },
    messages: [
      { role: 'system', content: 'test' },
      { role: 'user', content: 'x' },
    ],
    onEvent: (e) => events.push(e),
    maxSteps: 4,
    grounding: false,
  });

  assert.equal(res.done, true);
  assert.equal(provider.calls.length, 1);
  assert.equal(events.some((e) => e.type === 'warning'), false);
});
