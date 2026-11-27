import { test } from 'node:test';
import assert from 'node:assert/strict';
import { ToolRegistry, MockProvider, runAgentLoop } from '@sci/core';

function gateTool(name, registry) {
  return {
    name,
    description: 'parallel execution test tool',
    parameters: { type: 'object' },
    parallel: true,
    needsApproval: false,
    async execute() {
      registry.started.add(name);
      // Neither tool finishes until both start; serial execution would time out.
      if (registry.started.size >= 2) registry.release();
      await Promise.race([
        registry.gate,
        new Promise((_, rej) => {
          const t = setTimeout(() => rej(new Error('did not execute in parallel')), 2000);
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

test('parallel-safe tools execute concurrently in one step', async () => {
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

test('task runs a sub-agent and returns its summary', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'task', arguments: { prompt: 'subtask A' } }] },
    'sub-agent summary',
    { content: 'ana ajan bitti' },
  ]);
  const registry = new ToolRegistry({ workspaceRoot: '.' });
  const messages = [{ role: 'user', content: 'split the task' }];
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 5 });
  assert.equal(res.done, true);
  assert.equal(messages.at(-1).content, 'ana ajan bitti');
  const toolMsg = messages.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /Sub-agent finished/);
  assert.match(toolMsg.content, /sub-agent summary/);
  assert.equal(events.filter((e) => e.type === 'task_start').length, 1);
  assert.equal(events.filter((e) => e.type === 'task_end').length, 1);
  assert.ok(events.some((e) => e.type === 'sub_event' && e.ev?.type === 'text'));
});

test('multiple task calls execute concurrently', async () => {
  const provider = new MockProvider([
    {
      toolCalls: [
        { name: 'task', arguments: { prompt: 'task A' } },
        { name: 'task', arguments: { prompt: 'task B' } },
      ],
    },
    'summary A',
    'summary B',
    { content: 'ikisi de tamam' },
  ]);
  const registry = new ToolRegistry({ workspaceRoot: '.' });
  const messages = [{ role: 'user', content: 'execute concurrently' }];
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 6 });
  assert.equal(res.done, true);
  assert.equal(messages.at(-1).content, 'ikisi de tamam');
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  const combined = toolMsgs.map((m) => m.content).join('\n');
  assert.match(combined, /summary A/);
  assert.match(combined, /summary B/);
  assert.equal(events.filter((e) => e.type === 'task_end').length, 2);
});

test('sub-agents cannot recursively invoke task', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'task', arguments: { prompt: 'nested task' } }] },
    'ok',
    { content: 'bitti' },
  ]);
  const registry = new ToolRegistry({ workspaceRoot: '.' });
  const messages = [{ role: 'user', content: 'x' }];
  await runAgentLoop({ provider, registry, messages, maxSteps: 4 });
  const childCall = provider.calls[1]; // first sub-agent call
  const childTools = childCall.tools.map((t) => t.name);
  assert.ok(childTools.includes('read_file'));
  assert.equal(childTools.includes('task'), false);
});
