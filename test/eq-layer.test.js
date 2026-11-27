import { test } from 'node:test';
import assert from 'node:assert/strict';
import { MockProvider, runAgentLoop } from '@sci/core';
import { buildSteering } from '../packages/core/src/eq/eq-layer.js';

// Minimal mock registry for runAgentLoop: only schemas() is used.
const fakeRegistry = { schemas: () => [] };

test('runAgentLoop appends systemExtra to copied context without changing history', async () => {
  const provider = new MockProvider([{ content: 'tamam' }]);
  const messages = [
    { role: 'system', content: 'sistem istemi' },
    { role: 'user', content: 'selam' },
  ];
  await runAgentLoop({ provider, registry: fakeRegistry, messages, maxSteps: 3, grounding: false, systemExtra: 'STEER-TEST-123' });

  // The provider receives a copied context with the system-message suffix.
  const sent = provider.calls[0].messages;
  assert.notEqual(sent, messages);
  assert.equal(sent[0].content, 'sistem istemi\n\nSTEER-TEST-123');
  assert.equal(sent[1].content, 'selam');

  // The suffix does not leak into persistent history.
  assert.equal(messages[0].content, 'sistem istemi');
  assert.ok(!JSON.stringify(messages).includes('STEER-TEST-123'));
});

test('runAgentLoop behavior is unchanged without systemExtra', async () => {
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

test('buildSteering returns null when disabled', async () => {
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

test('buildSteering returns string or null without throwing', async () => {
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

test('buildSteering filters tool messages and returns null without user messages', async () => {
  const r = await buildSteering({
    messages: [
      { role: 'system', content: 'sistem' },
      { role: 'tool', tool_call_id: '1', content: 'araç çıktısı' },
    ],
  });
  assert.equal(r, null);
});
