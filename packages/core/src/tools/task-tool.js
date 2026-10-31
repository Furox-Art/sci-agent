import { runAgentLoop } from '../agent.js';
import { createRegistry } from '../index.js';

/**
 * Alt ajan aracı: verilen görevi kendi bağlamında (temiz mesaj geçmişiyle) yürütür,
 * özetini döndürür. Aynı adımda birden çok task çağrısı paralel yürütülür.
 * Alt ajanın kaydında task aracı devre dışıdır (iç içe derinlik sınırlı).
 */
export const task = {
  name: 'task',
  description:
    'Bir alt ajan başlatır: verilen görevi kendi bağlamında yürütür ve kısa özet döndürür. Bağımsız alt görevleri aynı adımda birden çok task çağrısıyla paralel yaptırabilirsin.',
  parameters: {
    type: 'object',
    properties: {
      prompt: { type: 'string', description: 'Alt ajana verilecek görev tanımı' },
    },
    required: ['prompt'],
  },
  needsApproval: false,
  parallel: true,
  async execute({ prompt }, ctx = {}) {
    const { provider, onEvent, workspaceRoot = '.' } = ctx;
    if (!provider) throw new Error('task aracı bu bağlamda kullanılamaz (sağlayıcı yok)');
    onEvent?.({ type: 'task_start', prompt });

    const childMessages = [
      {
        role: 'system',
        content: `Sen bir alt ajansın. Verilen görevi odaklı ve kısa tamamla; sonunda 2-4 cümlelik özet ver. Çalışma alanı: ${workspaceRoot}`,
      },
      { role: 'user', content: prompt },
    ];
    const childRegistry = createRegistry({ cfg: ctx.cfg, approve: ctx.approve, disableTools: ['task'] });
    const relay = (ev) => {
      if (ev.type === 'text_delta' || ev.type === 'reasoning_delta') return;
      onEvent?.({ type: 'sub_event', prompt, ev });
    };

    const res = await runAgentLoop({
      provider,
      registry: childRegistry,
      messages: childMessages,
      maxSteps: Math.min(Number(ctx.maxSteps) || 15, 15),
      onEvent: relay,
    });
    onEvent?.({ type: 'task_end', prompt, done: res.done });

    const lastText = [...childMessages].reverse().find((m) => m.role === 'assistant' && m.content)?.content;
    if (lastText) onEvent?.({ type: 'sub_event', prompt, ev: { type: 'text', text: lastText } });
    return `Alt ajan bitti (${res.steps} adım).\nÖzet:\n${lastText ?? '(metin yok)'}`;
  },
};
