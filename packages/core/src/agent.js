/**
 * Ajan döngüsü: modeli çağırır, araç çağrılarını çalıştırır, sonuçları modele geri verir.
 * onEvent ile akış olayları yayınlanır: reasoning | text | tool_call | tool_result | error
 * systemExtra verilirse bu turun model çağrılarında sistem mesajına eklenir
 * (kalıcı messages dizisi değişmez; örn. eq-layer yönlendirmesi için kullanılır).
 */
export async function runAgentLoop({ provider, registry, messages, onEvent = () => {}, maxSteps = 25, signal, systemExtra } = {}) {
  for (let step = 0; step < maxSteps; step++) {
    // systemExtra yalnızca model çağrılarına eklenir; kalıcı geçmiş kopya üzerinden korunur.
    const chatMessages =
      systemExtra && messages.length && typeof messages[0]?.content === 'string'
        ? messages.map((m, i) => (i === 0 ? { ...m, content: `${m.content}\n\n${systemExtra}` } : m))
        : messages;
    const res = await provider.chat({
      messages: chatMessages,
      tools: registry.schemas(),
      signal,
      onChunk: (c) => {
        if (c.type === 'text_delta') onEvent({ type: 'text_delta', text: c.text });
        else if (c.type === 'reasoning_delta') onEvent({ type: 'reasoning_delta', text: c.text });
        else if (c.type === 'info') onEvent({ type: 'info', text: c.text });
      },
    });

    const assistant = { role: 'assistant', content: res.content ?? '' };
    if (res.toolCalls?.length) {
      assistant.tool_calls = res.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      }));
    }
    messages.push(assistant);

    // Deltalar akış sırasında gösterildi; yalnızca akışsız yanıtta tam metni yayınla.
    if (res.reasoning && !res.streamed) onEvent({ type: 'reasoning', text: res.reasoning });
    if (res.content && !res.streamed) onEvent({ type: 'text', text: res.content });
    if (!res.toolCalls?.length) return { done: true, steps: step + 1 };

    const runOne = async (tc) => {
      onEvent({ type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments });
      const result = await registry.invoke(tc.name, tc.arguments, { provider, onEvent, maxSteps });
      onEvent({ type: 'tool_result', id: tc.id, name: tc.name, ok: result.ok, output: result.output });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result.output });
    };
    // Tüm çağrılar paralel-güvenli araçlara aitse aynı adımda eşzamanlı yürüt.
    const parallel = res.toolCalls.length > 1 && res.toolCalls.every((tc) => registry.get(tc.name)?.parallel);
    if (parallel) {
      await Promise.all(res.toolCalls.map(runOne));
    } else {
      for (const tc of res.toolCalls) await runOne(tc);
    }
  }
  onEvent({ type: 'error', text: `Adım sınırı aşıldı (${maxSteps}); döngü durduruldu.` });
  return { done: false, steps: maxSteps };
}

export function buildSystemPrompt(cfg) {
  const os = `${process.platform} / ${process.arch}`;
  return [
    'Sen SciAgent adlı bir bilimsel kodlama ajanısın.',
    'Görevin: kullanıcının bilimsel ve yazılım görevlerini, gerektiğinde araçları kullanarak adım adım tamamlamak.',
    `Çalışma alanı kökü: ${cfg.agent.workspaceRoot}`,
    `Sistem: ${os}, tarih: ${new Date().toISOString().slice(0, 10)}`,
    'Kurallar: dosya değişikliğinden önce ne yapacağını kısaca açıkla; komutları çalışma alanına sadık tut; bilmediğin şeyi uydurma, önce dosyalara bak; mevcut kodun biçimine uy; yanıtlarını Türkçe ver.',
  ].join('\n');
}
