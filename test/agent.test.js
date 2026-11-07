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
  // Adım olayları: her tur için sıralı step olayı yayınlanır
  const stepEvents = events.filter((e) => e.type === 'step').map((e) => e.step);
  assert.deepEqual(stepEvents, [1, 2]);
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

test('araç execute hatası döngüyü durdurmaz, gözlem olarak geri beslenir', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const boom = {
    name: 'boom',
    description: 'her çağrıda patlayan araç',
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

test('registry.invoke fırlarsa döngü ölmez, JSON hata gözlemi modele döner', async () => {
  const provider = new MockProvider([
    { toolCalls: [{ name: 'boom', arguments: {} }] },
    { content: 'devam etti' },
  ]);
  // invoke'un kendisi fırlatan sahte kayıt: ajan döngüsü bunu temiz gözleme çevirmeli.
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

test('abort: model çağrısı sırasında neden bildirilir ve düzenli sonuç döner', async () => {
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

test('abort: araç ortasında tetiklenirse kalan çağrılar çalıştırılmaz ve gözlemlenir', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const ac = new AbortController();
  const stopper = {
    name: 'stopper',
    description: 'abort tetikleyen araç',
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
  assert.equal(provider.calls.length, 1); // ikinci model çağrısı hiç yapılmadı
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  assert.deepEqual(JSON.parse(toolMsgs[1].content), { error: 'Aborted before execution.' });
  assert.ok(events.some((e) => e.type === 'error' && /abort/i.test(e.text)));
});

test('bozuk araç çağrıları temiz gözlemle karşılanır ve döngü sürer', async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-'));
  const registry = new ToolRegistry({ workspaceRoot: root });
  const provider = new MockProvider([
    {
      toolCalls: [
        { name: 'yok_boyle_arac', arguments: {} }, // bilinmeyen araç adı
        { name: 'list_dir', arguments: { _raw: '{"path":' } }, // geçersiz JSON argüman
      ],
    },
    { content: 'toparlandı' },
  ]);
  const events = [];
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxSteps: 5 });
  assert.equal(res.done, true);
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 2);
  assert.match(toolMsgs[0].content, /unknown tool/);
  assert.match(toolMsgs[1].content, /not valid JSON/);
  assert.equal(messages.at(-1).content, 'toparlandı');
  // Assistant mesajı bozuk çağrıları da kaydeder: araç çağrısı/yanıt eşleşmesi (protokol) tutarlı kalır.
  const assistant = messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.tool_calls.length, 2);
  const trs = events.filter((e) => e.type === 'tool_result');
  assert.equal(trs.length, 2);
  assert.equal(trs.every((e) => e.ok === false), true);
});

test('üç ardışık bozuk araç çağrısında döngü durur', async () => {
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
  assert.equal(provider.calls.length, 3); // 4. tur hiç çağrılmadı
  assert.ok(events.some((e) => e.type === 'error' && /malformed/i.test(e.text)));
});

test('bozuk çağrı sayacı geçerli bir adımda sıfırlanır', async () => {
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
  // Sayaç sıfırlanmasaydı toplam 3 bozuk çağrıda dururdu; sıfırlama sayesinde tur tamamlandı.
  assert.equal(res.done, true);
  assert.equal(provider.calls.length, 5);
});

// Eşzamanlılık ölçen sahte paralel araç: aktif yürütme sayısını izler, aynı anda en
// yüksek kaç çağrının çalıştığını (peak) kaydeder; her çağrı kısa gecikmeyle döner.
const concurrencyTool = (state) => ({
  name: 'slow_paralel',
  description: 'eşzamanlılık ölçen araç',
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

test('paralel havuz: aynı anda en fazla maxConcurrent araç çalışır', async () => {
  const state = { active: 0, peak: 0 };
  const registry = new ToolRegistry({ tools: [concurrencyTool(state)], workspaceRoot: '.' });
  const provider = new MockProvider([{ toolCalls: concurrencyCalls(10) }, { content: 'havuz bitti' }]);
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: () => {}, maxConcurrent: 4, maxSteps: 5 });
  assert.equal(res.done, true);
  // 10 çağrının hiçbiri 4 eşzamanlı sınırı aşamaz; sınır tam dolulukla kullanılır.
  assert.equal(state.peak, 4);
  assert.equal(state.active, 0); // döngü bittiğinde sızan yürütme kalmaz
});

test('paralel havuz: sonuçlar doğru tool_call kimlikleriyle ve asistan sırasıyla eşleşir', async () => {
  const state = { active: 0, peak: 0 };
  const registry = new ToolRegistry({ tools: [concurrencyTool(state)], workspaceRoot: '.' });
  const provider = new MockProvider([{ toolCalls: concurrencyCalls(10) }, { content: 'eşleşme tamam' }]);
  const messages = [{ role: 'user', content: 'x' }];
  const events = [];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: (e) => events.push(e), maxConcurrent: 4, maxSteps: 5 });
  assert.equal(res.done, true);
  const assistant = messages.find((m) => m.role === 'assistant');
  assert.equal(assistant.tool_calls.length, 10);
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 10);
  // Her araç yanıtı, asistan mesajındaki tool_call sırasına ve kimliğine göre birebir eşleşir.
  toolMsgs.forEach((m, idx) => {
    assert.equal(m.tool_call_id, assistant.tool_calls[idx].id);
    assert.equal(m.content, `sonuc-${idx}`);
  });
  // tool_result olayları tamamlanma sırasında gelebilir; kimlikler birebir eşleşmeli.
  const trs = events.filter((e) => e.type === 'tool_result');
  assert.equal(trs.length, 10);
  assert.ok(trs.every((e) => e.ok === true));
  assert.deepEqual(trs.map((e) => e.id).sort(), assistant.tool_calls.map((tc) => tc.id).sort());
});

test('paralel havuz: maxConcurrent verilmezse varsayılan sınır 4 uygulanır', async () => {
  const state = { active: 0, peak: 0 };
  const registry = new ToolRegistry({ tools: [concurrencyTool(state)], workspaceRoot: '.' });
  const provider = new MockProvider([{ toolCalls: concurrencyCalls(10) }, { content: 'varsayılan bitti' }]);
  const messages = [{ role: 'user', content: 'x' }];
  const res = await runAgentLoop({ provider, registry, messages, onEvent: () => {}, maxSteps: 5 });
  assert.equal(res.done, true);
  assert.equal(state.peak, 4); // seçenek yokken DEFAULT_MAX_CONCURRENT devrede
  assert.equal(state.active, 0);
});

test('paralel havuzda abort: başlamayan çağrılar çalıştırılmaz ve gözlemlenir', async () => {
  const ac = new AbortController();
  const pabort = {
    name: 'pabort',
    description: 'ilk çağrıda abort tetikleyen paralel araç',
    parameters: { type: 'object' },
    parallel: true,
    needsApproval: false,
    async execute() {
      ac.abort();
      return 'ilk çalıştı';
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
  assert.equal(provider.calls.length, 1); // ikinci model çağrısı hiç yapılmadı
  const assistant = messages.find((m) => m.role === 'assistant');
  const toolMsgs = messages.filter((m) => m.role === 'tool');
  assert.equal(toolMsgs.length, 6); // her çağrı için yanıt var: geçmiş protokolü tutarlı
  toolMsgs.forEach((m, idx) => assert.equal(m.tool_call_id, assistant.tool_calls[idx].id));
  assert.equal(toolMsgs[0].content, 'ilk çalıştı');
  for (const m of toolMsgs.slice(1)) {
    assert.deepEqual(JSON.parse(m.content), { error: 'Aborted before execution.' });
  }
  assert.ok(events.some((e) => e.type === 'error' && /abort/i.test(e.text)));
});
