import { test } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { ToolRegistry, MockProvider, OpenAICompatProvider, runAgentLoop } from '@sci/core';

test('ajan döngüsü: araç çağırır ve yanıtlar', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const provider = new MockProvider([
    { toolCalls: [{ name: 'write_file', arguments: { path: 'rapor.txt', content: 'veri' } }] },
    { content: 'rapor yazıldı' },
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
  assert.equal(messages.at(-1).content, 'rapor yazıldı');
  assert.equal(messages.at(-2).role, 'tool');
  assert.equal(events.find((e) => e.type === 'tool_call')?.name, 'write_file');
});

test('adım sınırında durur', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const script = Array.from({ length: 5 }, () => ({ toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }] }));
  const provider = new MockProvider(script);
  const registry = new ToolRegistry({ workspaceRoot: root });
  const res = await runAgentLoop({ provider, registry, messages: [{ role: 'user', content: 'x' }], maxSteps: 2 });
  assert.equal(res.done, false);
  assert.equal(res.steps, 2);
});

test('OpenAI sağlayıcı istek biçimi ve ayrıştırma', async () => {
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
  const p = new OpenAICompatProvider({ baseUrl: 'http://x/v1/', model: 'm', fetchImpl: fakeFetch });
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
