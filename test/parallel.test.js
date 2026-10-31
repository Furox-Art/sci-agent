import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, MockProvider, runAgentLoop } from '@sci/core';

function gateTool(name, registry) {
  return {
    name,
    description: 'paralellik testi aracı',
    parameters: { type: 'object' },
    parallel: true,
    needsApproval: false,
    async execute() {
      registry.started.add(name);
      // İki araç da başlamadan hiçbiri bitmez: sıralı yürütme zaman aşımına düşer.
      if (registry.started.size >= 2) registry.release();
      await Promise.race([
        registry.gate,
        new Promise((_, rej) => {
          const t = setTimeout(() => rej(new Error('paralel çalışmadı')), 2000);
          t.unref?.();
        }),
      ]);
      return `${name} tamam`;
    },
  };
}

function makeGate() {
  const registry = { started: new Set() };
  registry.gate = new Promise((r) => {
    registry.release = r;
  });
  return registry;
}

test('aynı adımdaki paralel araçlar eşzamanlı yürütülür', async () => {
  const gate = makeGate();
  const tools = [gateTool('a', gate), gateTool('b', gate)];
  const registry = new ToolRegistry({ tools, workspaceRoot: '.' });
  const provider = new MockProvider([
    { toolCalls: [{ name: 'a', arguments: {} }, { name: 'b', arguments: {} }] },
    { content: 'tamam' },
  ]);
  const messages = [{ role: 'user', content: 'x' }];
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e) });
  assert.equal(res.done, true);
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  assert.deepEqual([...gate.started].sort(), ['a', 'b']);
  for (const m of toolMsgs) assert.match(m.content, /tamam/);
});

test('task aracı alt ajanı çalıştırır ve özetini döndürür', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'task', arguments: { prompt: 'alt görev A' } }] },
    'alt ajanın özeti',
    { content: 'ana ajan bitti' },
  ]);
  const registry = new ToolRegistry({ workspaceRoot: '.' });
  const messages = [{ role: 'user', content: 'görevi böl' }];
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 5 });
  assert.equal(res.done, true);
  assert.equal(messages.at(-1).content, 'ana ajan bitti');
  const toolMsg = messages.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /Alt ajan bitti/);
  assert.match(toolMsg.content, /alt ajanın özeti/);
  assert.equal(events.filter((e) => e.type === 'task_start').length, 1);
  assert.equal(events.filter((e) => e.type === 'task_end').length, 1);
  assert.ok(events.some((e) => e.type === 'sub_event' && e.ev?.type === 'text'));
});

test('birden çok task çağrısı paralel yürütülür', async () => {
  const provider = new MockProvider([
    {
      toolCalls: [
        { name: 'task', arguments: { prompt: 'görev A' } },
        { name: 'task', arguments: { prompt: 'görev B' } },
      ],
    },
    'özet A',
    'özet B',
    { content: 'ikisi de tamam' },
  ]);
  const registry = new ToolRegistry({ workspaceRoot: '.' });
  const messages = [{ role: 'user', content: 'paralel çalış' }];
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 6 });
  assert.equal(res.done, true);
  assert.equal(messages.at(-1).content, 'ikisi de tamam');
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  const combined = toolMsgs.map((m) => m.content).join('\n');
  assert.match(combined, /özet A/);
  assert.match(combined, /özet B/);
  assert.equal(events.filter((e) => e.type === 'task_end').length, 2);
});

test('alt ajan task aracını göremez (iç içe derinlik sınırlı)', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'task', arguments: { prompt: 'iç görev' } }] },
    'ok',
    { content: 'bitti' },
  ]);
  const registry = new ToolRegistry({ workspaceRoot: '.' });
  const messages = [{ role: 'user', content: 'x' }];
  await runAgentLoop({ provider, registry, messages, maxSteps: 4 });
  const childCall = provider.calls[1]; // alt ajanın ilk çağrısı
  const childTools = childCall.tools.map((t) => t.name);
  assert.ok(childTools.includes('read_file'));
  assert.equal(childTools.includes('task'), false);
});
