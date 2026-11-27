import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry, MockProvider, OpenAICompatProvider, runAgentLoop } from '@sci/core';

test('agent loop calls tools and responds', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const provider = new MockProvider([
    { toolCalls: [{ name: 'write_file', arguments: { path: 'rapor.txt', content: 'veri' } }] },
    { content: 'report written' },
  ]);
  const events = [];
  const registry = new ToolRegistry({ workspaceRoot: root, approve: async () => true });
  const messages = [
    { role: 'system', content: 'test' },
    { role: 'user', content: 'raporu yaz' },
  ];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 5 });
  assert.equal(res.done, true);
  assert.equal(await fs.readFile(path.join(root, 'rapor.txt'), 'utf8'), 'veri');
  assert.equal(messages.at(-1).content, 'report written');
  assert.equal(messages.at(-2).role, 'tool');
  assert.equal(events.find((e) => e.type === 'tool_call')?.name, 'write_file');
  // Step events are emitted sequentially for each turn.
  const stepEvents = events.filter((e) => e.type === 'step').map((e) => e.step);
  assert.deepEqual(stepEvents, [1, 2]);
});

test('stops at the step limit', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const script = Array.from({ length: 5 }, () => ({ toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }] }));
  const provider = new MockProvider(script);
  const registry = new ToolRegistry({ workspaceRoot: root });
  const res = await runAgentLoop({ provider, registry, messages: [{ role: 'user', content: 'x' }], maxSteps: 2 });
  assert.equal(res.done, false);
  assert.equal(res.steps, 2);
});

test('OpenAI provider request format and parsing', async () => {
  let captured;
  const fakeFetch = async (url, opts) => {
    captured = { url, body: JSON.parse(opts.body) };
    return {
      ok: true,
      json: async () => ({
        choices: [{
          message: {
            content: 'selam',
            tool_calls: [{ id: '1', function: { name: 'list_dir', arguments: '{"path":"."}' } }],
          },
        }],
      }),
    };
  };
  const p = new OpenAICompatProvider({ baseUrl: 'http://x/v1/', model: 'm', stream: false, fetchImpl: fakeFetch });
  const out = await p.chat({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'list_dir', description: 'd', parameters: { type: 'object' } }],
  });
  assert.equal(captured.url, 'http://x/v1/chat/completions');
  assert.equal(captured.body.tools[0].type, 'function');
  assert.equal(captured.body.tools[0].function.name, 'list_dir');
  assert.deepEqual(out.toolCalls[0].arguments, { path: '.' });
  assert.equal(out.content, 'selam');
});

test('tool execution errors return observations without stopping the loop', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const boom = {
    name: 'boom',
    description: 'tool that throws on each call',
    parameters: { type: 'object' },
    needsApproval: false,
    async execute() {
      throw new Error('tool exploded');
    },
  };
  const registry = new ToolRegistry({ tools: [boom], workspaceRoot: root });
  const provider = new MockProvider([
    { toolCalls: [{ name: 'boom', arguments: {} }] },
    { content: 'hata tolere edildi' },
  ]);
  const events = [];
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 5 });
  assert.equal(res.done, true);
  const toolMsg = messages.find((m) => m.role === 'tool');
  assert.match(toolMsg.content, /Error: tool exploded/);
  assert.equal(events.find((e) => e.type === 'tool_result')?.ok, false);
  assert.equal(messages.at(-1).content, 'hata tolere edildi');
});

test('registry exceptions produce JSON error observations without stopping the loop', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'boom', arguments: {} }] },
    { content: 'devam etti' },
  ]);
  // A throwing mock registry should produce a clean observation.
  const registry = {
    schemas: () => [{ name: 'boom', description: 'd', parameters: { type: 'object' } }],
    get: (n) => (n === 'boom' ? { name: 'boom' } : null),
    invoke: async () => {
      throw new Error('invoke exploded');
    },
  };
  const events = [];
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 5 });
  assert.equal(res.done, true);
  const toolMsg = messages.find((m) => m.role === 'tool');
  assert.deepEqual(JSON.parse(toolMsg.content), { error: 'invoke exploded' });
  assert.equal(events.find((e) => e.type === 'tool_result')?.ok, false);
  assert.equal(messages.at(-1).content, 'devam etti');
});

test('abort during a model call reports the reason and returns a structured result', async () => {
  const provider = {
    chat: async () => {
      const e = new Error('The operation was aborted');
      e.name = 'AbortError';
      throw e;
    },
  };
  const registry = { schemas: () => [] };
  const events = [];
  const ac = new AbortController();
  const res = await runAgentLoop({
    provider,
    registry,
    messages: [{ role: 'user', content: 'x' }],
    onEvent: (e) => events.push(e),
    signal: ac.signal,
    maxSteps: 3,
  });
  assert.equal(res.done, false);
  assert.equal(res.aborted, true);
  const err = events.find((e) => e.type === 'error');
  assert.match(err.text, /abort/i);
  assert.equal(err.reason, 'aborted');
});

test('abort during tool execution skips remaining calls and records observations', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const ac = new AbortController();
  const stopper = {
    name: 'stopper',
    description: 'tool triggering cancellation',
    parameters: { type: 'object' },
    needsApproval: false,
    async execute() {
      ac.abort();
      return 'durduruldu';
    },
  };
  const registry = new ToolRegistry({ tools: [stopper], workspaceRoot: root });
  const provider = new MockProvider([
    { toolCalls: [{ name: 'stopper', arguments: {} }, { name: 'stopper', arguments: {} }] },
    { content: 'buraya gelinmemeli' },
  ]);
  const events = [];
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), signal: ac.signal, maxSteps: 5 });
  assert.equal(res.done, false);
  assert.equal(res.aborted, true);
  assert.equal(provider.calls.length, 1); // the second model call never occurred
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  assert.deepEqual(JSON.parse(toolMsgs[1].content), { error: 'Aborted before execution.' });
  assert.ok(events.some((e) => e.type === 'error' && /abort/i.test(e.text)));
});

test('malformed tool calls produce clean observations and the loop continues', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const registry = new ToolRegistry({ workspaceRoot: root });
  const provider = new MockProvider([
    {
      toolCalls: [
        { name: 'nonexistent_tool', arguments: {} }, // unknown tool name
        { name: 'list_dir', arguments: { _raw: '{"path":' } }, // invalid JSON arguments
      ],
    },
    { content: 'recovered' },
  ]);
  const events = [];
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 5 });
  assert.equal(res.done, true);
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  assert.match(toolMsgs[0].content, /unknown tool/);
  assert.match(toolMsgs[1].content, /not valid JSON/);
  assert.equal(messages.at(-1).content, 'recovered');
  // Preserve malformed calls in assistant history for protocol-consistent response matching.
  const assistant = messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.tool_calls.length, 2);
  const trs = events.filter((e) => e.type === 'tool_result');
  assert.equal(trs.length, 2);
  assert.equal(trs.every((e) => e.ok === false), true);
});

test('three consecutive malformed tool calls stop the loop', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'yok1', arguments: {} }] },
    { toolCalls: [{ name: 'yok2', arguments: {} }] },
    { toolCalls: [{ name: 'yok3', arguments: {} }] },
    { content: 'buraya gelinmemeli' },
  ]);
  const registry = new ToolRegistry({ workspaceRoot: '.' });
  const events = [];
  const res = await runAgentLoop({
    provider,
    registry,
    messages: [{ role: 'user', content: 'x' }],
    onEvent: (e) => events.push(e),
    maxSteps: 10,
  });
  assert.equal(res.done, false);
  assert.equal(res.steps, 3);
  assert.equal(provider.calls.length, 3); // the fourth turn was never called
  assert.ok(events.some((e) => e.type === 'error' && /malformed/i.test(e.text)));
});

test('a valid step resets the malformed-call counter', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const registry = new ToolRegistry({ workspaceRoot: root });
  const provider = new MockProvider([
    { toolCalls: [{ name: 'yok1', arguments: {} }] },
    { toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }] },
    { toolCalls: [{ name: 'yok2', arguments: {} }] },
    { toolCalls: [{ name: 'yok3', arguments: {} }] },
    { content: 'betik bitti turu' },
  ]);
  const res = await runAgentLoop({ provider, registry, messages: [{ role: 'user', content: 'x' }], maxSteps: 10 });
  // Resetting the counter allows the turn to finish instead of stopping at three total malformed calls.
  assert.equal(res.done, true);
  assert.equal(provider.calls.length, 5);
});

// Mock parallel tool measures active executions and
// records peak concurrency; each call completes after a short delay.
const concurrencyTool = (state) => ({
  name: 'slow_paralel',
  description: 'concurrency measuring tool',
  parameters: { type: 'object' },
  parallel: true,
  needsApproval: false,
  async execute(args) {
    state.active++;
    state.peak = Math.max(state.peak, state.active);
    await new Promise((r) => setTimeout(r, 20));
    state.active--;
    return `sonuc-${args.i}`;
  },
});

const concurrencyCalls = (n) => Array.from({ length: n }, (_, i) => ({ id: `c${i}`, name: 'slow_paralel', arguments: { i } }));

test('parallel pool respects maxConcurrent', async () => {
  const state = { active: 0, peak: 0 };
  const registry = new ToolRegistry({ tools: [concurrencyTool(state)], workspaceRoot: '.' });
  const provider = new MockProvider([{ toolCalls: concurrencyCalls(10) }, { content: 'havuz bitti' }]);
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: () => {}, maxConcurrent: 4, maxSteps: 5 });
  assert.equal(res.done, true);
  // Ten calls respect and fully utilize the concurrency limit of four.
  assert.equal(state.peak, 4);
  assert.equal(state.active, 0); // no active execution remains when the loop ends
});

test('parallel results preserve tool-call IDs and assistant order', async () => {
  const state = { active: 0, peak: 0 };
  const registry = new ToolRegistry({ tools: [concurrencyTool(state)], workspaceRoot: '.' });
  const provider = new MockProvider([{ toolCalls: concurrencyCalls(10) }, { content: 'matching completed' }]);
  const messages = [{ role: 'user', content: 'x' }];
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxConcurrent: 4, maxSteps: 5 });
  assert.equal(res.done, true);
  const assistant = messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.tool_calls.length, 10);
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 10);
  // Each response matches its assistant tool-call ID and order.
  toolMsgs.forEach((m, idx) => {
    assert.equal(m.tool_call_id, assistant.tool_calls[idx].id);
    assert.equal(m.content, `sonuc-${idx}`);
  });
  // Tool-result events may arrive in completion order; their IDs must match.
  const trs = events.filter((e) => e.type === 'tool_result');
  assert.equal(trs.length, 10);
  assert.ok(trs.every((e) => e.ok === true));
  assert.deepEqual(trs.map((e) => e.id).sort(), assistant.tool_calls.map((tc) => tc.id).sort());
});

test('parallel pool defaults to four concurrent calls', async () => {
  const state = { active: 0, peak: 0 };
  const registry = new ToolRegistry({ tools: [concurrencyTool(state)], workspaceRoot: '.' });
  const provider = new MockProvider([{ toolCalls: concurrencyCalls(10) }, { content: 'default completed' }]);
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: () => {}, maxSteps: 5 });
  assert.equal(res.done, true);
  assert.equal(state.peak, 4); // DEFAULT_MAX_CONCURRENT applies when omitted
  assert.equal(state.active, 0);
});

test('parallel cancellation skips and records unstarted calls', async () => {
  const ac = new AbortController();
  const pabort = {
    name: 'pabort',
    description: 'parallel tool that cancels on the first call',
    parameters: { type: 'object' },
    parallel: true,
    needsApproval: false,
    async execute() {
      ac.abort();
      return 'first executed';
    },
  };
  const registry = new ToolRegistry({ tools: [pabort], workspaceRoot: '.' });
  const calls = Array.from({ length: 6 }, (_, i) => ({ id: `c${i}`, name: 'pabort', arguments: { i } }));
  const provider = new MockProvider([{ toolCalls: calls }, { content: 'buraya gelinmemeli' }]);
  const messages = [{ role: 'user', content: 'x' }];
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), signal: ac.signal, maxConcurrent: 4, maxSteps: 5 });
  assert.equal(res.done, false);
  assert.equal(res.aborted, true);
  assert.equal(provider.calls.length, 1); // the second model call never occurred
  const assistant = messages.find((m) => m.role === 'assistant');
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 6); // each call has a response; history remains consistent
  toolMsgs.forEach((m, idx) => assert.equal(m.tool_call_id, assistant.tool_calls[idx].id));
  assert.equal(toolMsgs[0].content, 'first executed');
  for (const m of toolMsgs.slice(1)) {
    assert.deepEqual(JSON.parse(m.content), { error: 'Aborted before execution.' });
  }
  assert.ok(events.some((e) => e.type === 'error' && /abort/i.test(e.text)));
});
