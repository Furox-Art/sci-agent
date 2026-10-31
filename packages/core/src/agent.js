/**
 * Ajan döngüsü: modeli çağırır, araç çağrılarını çalıştırır, sonuçları modele geri verir.
 * onEvent ile akış olayları yayınlanır: reasoning | text | tool_call | tool_result | error
 */
export async function runAgentLoop({ provider, registry, messages, onEvent = () => {}, maxSteps = 25, signal } = {}) {
  for (let step = 0; step < maxSteps; step++) {
    const res = await provider.chat({ messages, tools: registry.schemas(), signal });

    const assistant = { role: 'assistant', content: res.content ?? '' };
    if (res.toolCalls?.length) {
      assistant.tool_calls = res.toolCalls.map((tc) => ({
        id: tc.id,
        type: 'function',
        function: { name: tc.name, arguments: JSON.stringify(tc.arguments ?? {}) },
      }));
    }
    messages.push(assistant);

    if (res.reasoning) onEvent({ type: 'reasoning', text: res.reasoning });
    if (res.content) onEvent({ type: 'text', text: res.content });
    if (!res.toolCalls?.length) return { done: true, steps: step + 1 };

    for (const tc of res.toolCalls) {
      onEvent({ type: 'tool_call', id: tc.id, name: tc.name, args: tc.arguments });
      const result = await registry.invoke(tc.name, tc.arguments);
      onEvent({ type: 'tool_result', id: tc.id, name: tc.name, ok: result.ok, output: result.output });
      messages.push({ role: 'tool', tool_call_id: tc.id, content: result.output });
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
