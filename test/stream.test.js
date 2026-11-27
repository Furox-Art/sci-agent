import { test } from 'node:test';
import assert from 'node:assert/strict';
import { OpenAICompatProvider, MockProvider, runAgentLoop, ToolRegistry } from '@sci/core';

function sseBody(lines) {
  const enc = new TextEncoder();
  return new ReadableStream({
    start(c) {
      c.enqueue(enc.encode(lines.join('\n\n') + '\n\n'));
      c.close();
    },
  });
}

test('streaming response emits deltas and assembles tool calls', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"hello "}}]}',
    'data: {"choices":[{"delta":{"content":"world"}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"id":"1","function":{"name":"list_dir","arguments":"{\\"path\\""}}]}}]}',
    'data: {"choices":[{"delta":{"tool_calls":[{"index":0,"function":{"arguments":":\\".\\"}"}}]}}]}',
    'data: {"choices":[{"delta":{}}]}',
    'data: [DONE]',
  ];
  const fakeFetch = async () => ({ ok: true, body: sseBody(sse) });
  const p = new OpenAICompatProvider({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: fakeFetch });
  const deltas = [];
  const out = await p.chat({
    messages: [{ role: 'user', content: 'hi' }],
    tools: [{ name: 'list_dir', description: 'd', parameters: { type: 'object' } }],
    onChunk: (c) => deltas.push(c),
  });
  assert.equal(out.content, 'hello world');
  assert.equal(out.streamed, true);
  assert.deepEqual(out.toolCalls[0].arguments, { path: '.' });
  assert.deepEqual(deltas.filter((d) => d.type === 'text_delta').map((d) => d.text), ['hello ', 'world']);
});

test('unsupported streaming falls back to nonstreaming mode', async () => {
  let calls = 0;
  const fakeFetch = async (url, opts) => {
    calls++;
    if (JSON.parse(opts.body).stream) {
      return { ok: false, status: 400, text: async () => 'stream unsupported', body: null };
    }
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: 'tamam' } }] }),
    };
  };
  const p = new OpenAICompatProvider({ baseUrl: 'http://x/v1', model: 'm', fetchImpl: fakeFetch });
  const deltas = [];
  const out = await p.chat({ messages: [], onChunk: (c) => deltas.push(c) });
  assert.equal(calls, 2);
  assert.equal(out.content, 'tamam');
  assert.equal(out.streamed, false);
  assert.equal(deltas.find((d) => d.type === 'info')?.text.includes('without streaming'), true);
});

test('provider accepts the configured name field as model', async () => {
  const fakeFetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    return {
      ok: true,
      json: async () => ({ choices: [{ message: { content: `model=${body.model}` } }] }),
    };
  };
  const p = new OpenAICompatProvider({ baseUrl: 'http://x/v1', name: 'scientific-model', stream: false, fetchImpl: fakeFetch });
  const out = await p.chat({ messages: [{ role: 'user', content: 'hi' }] });
  assert.equal(out.content, 'model=scientific-model');
});

test('agent loop emits text deltas without repeating the full streamed text', async () => {
  const provider = new MockProvider([{ content: 'hello world' }]);
  const events = [];
  const registry = new ToolRegistry({ workspaceRoot: '.' });
  const res = await runAgentLoop({
    provider,
    registry,
    messages: [{ role: 'user', content: 'x' }],
    onEvent: (e) => events.push(e),
  });
  assert.equal(res.done, true);
  const deltaText = events.filter((e) => e.type === 'text_delta').map((e) => e.text).join('');
  assert.equal(deltaText, 'hello world');
  assert.equal(events.some((e) => e.type === 'text'), false);
});
