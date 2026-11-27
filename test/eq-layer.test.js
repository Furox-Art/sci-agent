import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider, runAgentLoop } from '@sci/core';
import { buildSteering } from '../packages/core/src/eq/eq-layer.js';

// runAgentLoop için minimal sahte kayıt: yalnızca schemas() kullanılır (araç çağrısı yok).
const fakeRegistry = { schemas: () => [] };

test('runAgentLoop: systemExtra kopyadaki sistem mesajına eklenir, orijinal messages değişmez', async () => {
  const provider = new MockProvider([{ content: 'tamam' }]);
  const messages = [
    { role: 'system', content: 'sistem istemi' },
    { role: 'user', content: 'selam' },
  ];
  await runAgentLoop({ provider, registry: fakeRegistry, messages, maxSteps: 3, grounding: false, systemExtra: 'STEER-TEST-123' });

  // Provider'a giden liste bir kopya: sistem mesajı suffix taşır.
  const sent = provider.calls[0].messages;
  assert.notEqual(sent, messages);
  assert.equal(sent[0].content, 'sistem istemi\n\nSTEER-TEST-123');
  assert.equal(sent[1].content, 'selam');

  // Orijinal kalıcı geçmişte suffix sızması yok.
  assert.equal(messages[0].content, 'sistem istemi');
  assert.ok(!JSON.stringify(messages).includes('STEER-TEST-123'));
});

test('runAgentLoop: systemExtra verilmezse davranış değişmez', async () => {
  const provider = new MockProvider([{ content: 'tamam' }]);
  const messages = [
    { role: 'system', content: 'sistem istemi' },
    { role: 'user', content: 'selam' },
  ];
  await runAgentLoop({ provider, registry: fakeRegistry, messages, maxSteps: 3, grounding: false });

  assert.equal(provider.calls.length, 1);
  assert.equal(provider.calls[0].messages, messages); // birebir aynı dizi gönderilir
  assert.equal(provider.calls[0].messages[0].content, 'sistem istemi');
});

test('buildSteering: SCI_AGENT_EQ_DISABLE=1 ile null döner', async () => {
  const prev = process.env.SCI_AGENT_EQ_DISABLE;
  process.env.SCI_AGENT_EQ_DISABLE = '1';
  try {
    const r = await buildSteering({
      messages: [{ role: 'user', content: 'Randevum üç kez değiştirildi, devam et.' }],
    });
    assert.equal(r, null);
  } finally {
    if (prev === undefined) delete process.env.SCI_AGENT_EQ_DISABLE;
    else process.env.SCI_AGENT_EQ_DISABLE = prev;
  }
});

test('buildSteering: kurulu pakette gerçek çağrı string|null döner, throw etmez', async () => {
  const r = await buildSteering({
    messages: [
      { role: 'user', content: 'Randevum üç kez değiştirildi, artık sinirleniyorum.' },
      { role: 'assistant', content: 'Kontrol ediyorum.' },
      { role: 'user', content: 'devam et' },
    ],
  });
  if (r === null) return; // paket yoksa sessiz null kabul edilir
  assert.equal(typeof r.steering, 'string');
  assert.ok(r.steering.length > 0);
  assert.equal(typeof r.source, 'string');
  assert.ok(r.source.length > 0);
});

test('buildSteering: tool mesajları filtrelenir, kullanıcı mesajı kalmazsa null döner', async () => {
  const r = await buildSteering({
    messages: [
      { role: 'system', content: 'sistem' },
      { role: 'tool', tool_call_id: '1', content: 'araç çıktısı' },
    ],
  });
  assert.equal(r, null);
});
