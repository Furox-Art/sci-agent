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

test('akışlı yanıt: deltalar yayınlanır ve araç çağrıları birleşir', async () => {
  const sse = [
    'data: {"choices":[{"delta":{"content":"selam "}}]}',
    'data: {"choices":[{"delta":{"content":"dünya"}}]}',
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
  assert.equal(out.content, 'selam dünya');
  assert.equal(out.streamed, true);
  assert.deepEqual(out.toolCalls[0].arguments, { path: '.' });
  assert.deepEqual(deltas.filter((d) => d.type === 'text_delta').map((d) => d.text), ['selam ', 'dünya']);
});

test('akış desteklenmezse akışsız moda geri düşer', async () => {
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
  assert.equal(deltas.find((d) => d.type === 'info')?.text.includes('akışsız'), true);
});

test('ajan döngüsü akışta text_delta yayınlar, tam metni tekrarlamaz', async () => {
  const provider = new MockProvider([{ content: 'merhaba dünya' }]);
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
  assert.equal(deltaText, 'merhaba dünya');
  assert.equal(events.some((e) => e.type === 'text'), false);
});
