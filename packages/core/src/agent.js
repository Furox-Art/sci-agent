/**
 * Ajan döngüsü: modeli çağırır, araç çağrılarını çalıştırır, sonuçları modele geri verir.
 * onEvent ile akış olayları yayınlanır: reasoning | text | tool_call | tool_result | error
 * systemExtra verilirse bu turun model çağrılarında sistem mesajına eklenir
 * (kalıcı messages dizisi değişmez; örn. eq-layer yönlendirmesi için kullanılır).
 *
 * Sağlamlık: araç/kayıt hataları döngüyü çökertmez (modele temiz hata gözlemi döner),
 * abort sinyali düzenli biçimde durdurulur ve nedeni bildirilir; bozuk araç çağrıları
 * (eksik/bilinmeyen ad, geçersiz JSON) gözlemlenir, 3 ardışık bozuk çağrıda döngü durur.
 * Paralel araç batch'leri sınırlı eşzamanlılıkla yürütülür (DEFAULT_MAX_CONCURRENT = 4;
 * runAgentLoop'un isteğe bağlı maxConcurrent seçeneğiyle geçilebilir).
 */

// Argümanları güvenle dizgeleştirir; döngüsel yapı gibi sorunlu değerlerde '{}' döner.
const stringifyArgs = (args) => {
  try {
    return JSON.stringify(args ?? {});
  } catch {
    return '{}';
  }
};

// Maximum number of tool calls executed at the same time within one step. A model can
// emit many tool calls in a single turn; each one may spawn child processes
// (python/shell), which can exhaust CPU and memory on small machines. Bounding parallel
// batches at 4 keeps runaway turns safe; callers can override it with the optional
// `maxConcurrent` option of runAgentLoop (positive integer).
const DEFAULT_MAX_CONCURRENT = 4;

// Bounded-concurrency worker pool: runs `worker` over `items` with at most `limit`
// workers in flight; each queued item starts only when a running one finishes, so the
// pool never exceeds `limit` simultaneous executions. Mirrors Promise.all semantics:
// resolves when every item is processed and rejects as soon as a worker rejects.
const runWithConcurrency = async (items, worker, limit) => {
  let next = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const index = next++;
      await worker(items[index], index);
    }
  });
  await Promise.all(runners);
};

export async function runAgentLoop({ provider, registry, messages, onEvent = () => {}, maxSteps = 25, signal, systemExtra, maxConcurrent } = {}) {
  // Effective tool-concurrency limit for this run: caller-provided `maxConcurrent` when
  // it is a positive integer, otherwise DEFAULT_MAX_CONCURRENT (4).
  const concurrency = Number.isInteger(maxConcurrent) && maxConcurrent >= 1 ? maxConcurrent : DEFAULT_MAX_CONCURRENT;
  // Ardışık bozuk araç çağrısı sayacı: 3'e ulaşınca döngü sonlanır (sonsuz döngü koruması).
  let malformedStreak = 0;
  // Abort: nedeni olay olarak bildir ve düzenli sonuçla dön (hata fırlatma).
  const abortRun = (steps) => {
    onEvent({ type: 'error', text: 'Run aborted before completion.', reason: 'aborted' });
    return { done: false, aborted: true, steps };
  };
  for (let step = 0; step < maxSteps; step++) {
    if (signal?.aborted) return abortRun(step);
    onEvent({ type: 'step', step: step + 1, maxSteps });
    // systemExtra yalnızca model çağrılarına eklenir; kalıcı geçmiş kopya üzerinden korunur.
    const chatMessages =
      systemExtra && messages.length && typeof messages[0]?.content === 'string'
        ? messages.map((m, i) => (i === 0 ? { ...m, content: `${m.content}\n\n${systemExtra}` } : m))
        : messages;
    let res;
    try {
      res = await provider.chat({
        messages: chatMessages,
        tools: registry.schemas(),
        signal,
        onChunk: (c) => {
          if (c.type === 'text_delta') onEvent({ type: 'text_delta', text: c.text });
          else if (c.type === 'reasoning_delta') onEvent({ type: 'reasoning_delta', text: c.text });
          else if (c.type === 'info') onEvent({ type: 'info', text: c.text });
        },
      });
    } catch (e) {
      // Abort hatası döngüyü çökertmez: nedeni bildirip çık; diğer sağlayıcı hataları aynen yayılır.
      if (signal?.aborted || e?.name === 'AbortError' || /abort/i.test(String(e?.message ?? ''))) return abortRun(step);
      throw e;
    }

    const toolCalls = res.toolCalls ?? [];
    const assistant = { role: 'assistant', content: res.content ?? '' };
    if (toolCalls.length) {
      assistant.tool_calls = toolCalls.map((tc) => ({
        id: tc?.id,
        type: 'function',
        function: { name: typeof tc?.name === 'string' ? tc.name : String(tc?.name ?? ''), arguments: stringifyArgs(tc?.arguments) },
      }));
    }
    messages.push(assistant);

    // Deltalar akış sırasında gösterildi; yalnızca akışsız yanıtta tam metni yayınla.
    if (res.reasoning && !res.streamed) onEvent({ type: 'reasoning', text: res.reasoning });
    if (res.content && !res.streamed) onEvent({ type: 'text', text: res.content });
    if (!toolCalls.length) return { done: true, steps: step + 1 };

    // Bozuk çağrı: adı eksik/bilinmiyor veya argümanlar geçersiz JSON. Çalıştırılmaz;
    // o çağrı için temiz hata gözlemi modele döner ve döngü sürer.
    const isMalformed = (tc) => {
      if (!tc || typeof tc !== 'object') return true;
      if (typeof tc.name !== 'string' || !tc.name.trim()) return true;
      if (!registry.get(tc.name)) return true;
      const args = tc.arguments;
      if (args == null) return false;
      if (typeof args !== 'object' || Array.isArray(args)) return true;
      const keys = Object.keys(args);
      return keys.length === 1 && keys[0] === '_raw'; // sağlayıcının JSON ayrıştırma hatası işareti
    };
    const malformedMessage = (tc) => {
      if (typeof tc?.name !== 'string' || !tc.name.trim()) return 'Malformed tool call: missing or empty tool name.';
      if (!registry.get(tc.name)) return `Malformed tool call: unknown tool "${tc.name}".`;
      return 'Malformed tool call: tool arguments are not valid JSON.';
    };
    // Her yardımcı, modele gidecek araç yanıtını (output dizgesi) döndürür; messages'a
    // yazma çağrı yerine yapılır (sıralı akışta hemen, havuzda asistan sırasına göre).
    const runMalformed = (tc) => {
      onEvent({ type: 'tool_call', id: tc?.id, name: tc?.name, args: tc?.arguments });
      const output = JSON.stringify({ error: malformedMessage(tc) });
      onEvent({ type: 'tool_result', id: tc?.id, name: tc?.name, ok: false, output });
      return output;
    };
    const runOne = async (tc) => {
      onEvent({ type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments });
      // Kayıt çoğu araç hatasını {ok:false} ile döndürür; invoke'un kendisi fırlarsa veya
      // geçersiz sonuç dönerse de döngü ölmesin: temiz hata gözlemi modele geri beslenir.
      let result;
      try {
        result = await registry.invoke(tc.name, tc.arguments, { provider, onEvent, maxSteps, signal });
        if (!result || typeof result !== 'object' || typeof result.output !== 'string') {
          result = { ok: false, output: JSON.stringify({ error: 'Tool returned an invalid result.' }) };
        }
      } catch (e) {
        result = { ok: false, output: JSON.stringify({ error: String(e?.message ?? e) }) };
      }
      onEvent({ type: 'tool_result', id: tc.id, name: tc.name, ok: result.ok, output: result.output });
      return result.output;
    };
    // Abort arada tetiklendiyse kalan çağrılar çalıştırılmaz; geçmiş tutarlı kalsın diye
    // her biri için 'aborted' gözlemi yazılır.
    const runAborted = (tc) => {
      const output = JSON.stringify({ error: 'Aborted before execution.' });
      onEvent({ type: 'tool_call', id: tc?.id, name: tc?.name, args: tc?.arguments });
      onEvent({ type: 'tool_result', id: tc?.id, name: tc?.name, ok: false, output });
      return output;
    };

    // Tüm çağrılar paralel-güvenli araçlara aitse aynı adımda sınırlı eşzamanlılıkla yürüt.
    const parallel = toolCalls.length > 1 && toolCalls.every((tc) => registry.get(tc?.name)?.parallel);
    let malformedThisStep = 0;
    if (parallel) {
      // Bounded-concurrency pool: at most `concurrency` tool calls run at once; each
      // queued call starts only when a running one finishes, so a turn with many calls
      // cannot exhaust CPU by spawning every child process simultaneously. tool_call /
      // tool_result events stream as calls start and complete, but the resulting tool
      // messages are appended afterwards in the assistant message's tool_calls order, so
      // every result stays paired with its own tool_call id. If abort fires mid-batch,
      // not-yet-started calls are never executed and each gets an 'Aborted before
      // execution.' observation; malformed calls likewise never execute.
      const outputs = new Array(toolCalls.length);
      let abortedMidBatch = false;
      await runWithConcurrency(toolCalls, async (tc, i) => {
        if (signal?.aborted) {
          abortedMidBatch = true;
          outputs[i] = runAborted(tc);
        } else if (isMalformed(tc)) {
          malformedThisStep++;
          outputs[i] = runMalformed(tc);
        } else {
          outputs[i] = await runOne(tc);
        }
      }, concurrency);
      for (let i = 0; i < toolCalls.length; i++) {
        if (outputs[i] !== undefined) {
          messages.push({ role: 'tool', tool_call_id: toolCalls[i]?.id, content: outputs[i] });
        }
      }
      if (abortedMidBatch) return abortRun(step);
    } else {
      let abortedMidBatch = false;
      for (const tc of toolCalls) {
        if (signal?.aborted) {
          abortedMidBatch = true;
          messages.push({ role: 'tool', tool_call_id: tc?.id, content: runAborted(tc) });
        } else if (isMalformed(tc)) {
          malformedThisStep++;
          messages.push({ role: 'tool', tool_call_id: tc?.id, content: runMalformed(tc) });
        } else {
          messages.push({ role: 'tool', tool_call_id: tc.id, content: await runOne(tc) });
        }
      }
      if (abortedMidBatch) return abortRun(step);
    }
    malformedStreak = malformedThisStep > 0 ? malformedStreak + malformedThisStep : 0;
    if (malformedStreak >= 3) {
      onEvent({ type: 'error', text: 'Stopped after 3 consecutive malformed tool calls.', reason: 'malformed_tool_calls' });
      return { done: false, steps: step + 1 };
    }
  }
  onEvent({ type: 'error', text: `Step limit exceeded (${maxSteps}); loop stopped.` });
  return { done: false, steps: maxSteps };
}

export function buildSystemPrompt(cfg) {
  const os = `${process.platform} / ${process.arch}`;
  return [
    'You are SciAgent, a scientific coding agent.',
    'Your job: complete the user\u2019s scientific and software tasks step by step using tools when needed.',
    `Workspace root: ${cfg.agent.workspaceRoot}`,
    `System: ${os}, date: ${new Date().toISOString().slice(0, 10)}`,
    'Rules: briefly explain before changing files; keep commands within the workspace; never invent — check files first; follow existing code style; respond in English.',
  ].join('\n');
}
