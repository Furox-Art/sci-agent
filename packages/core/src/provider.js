function parseArgs(raw) {
  if (raw == null) return {};
  if (typeof raw === 'object') return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { _raw: String(raw) };
  }
}

/**
 * OpenAI uyumlu /chat/completions uç noktasına bağlanan sağlayıcı.
 * vLLM, Ollama, HF TGI, LM Studio vb. tüm OpenAI uyumlu sunucularla çalışır.
 */
export class OpenAICompatProvider {
  constructor({ baseUrl, apiKey = '', model, temperature = 0.2, fetchImpl = fetch } = {}) {
    if (!baseUrl) throw new Error('model.baseUrl gerekli');
    if (!model) throw new Error('model.name gerekli');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model;
    this.temperature = temperature;
    this.fetchImpl = fetchImpl;
  }

  async chat({ messages, tools = [], signal } = {}) {
    const body = { model: this.model, temperature: this.temperature, messages };
    if (tools.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    const res = await this.fetchImpl(`${this.baseUrl}/chat/completions`, {
      method: 'POST',
      signal,
      headers: {
        'content-type': 'application/json',
        ...(this.apiKey ? { authorization: `Bearer ${this.apiKey}` } : {}),
      },
      body: JSON.stringify(body),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(`Model sunucusu ${res.status} döndü: ${text.slice(0, 500)}`);
    }
    const data = await res.json();
    const msg = data?.choices?.[0]?.message;
    if (!msg) throw new Error(`Beklenmeyen yanıt biçimi: ${JSON.stringify(data).slice(0, 300)}`);
    const toolCalls = (msg.tool_calls ?? []).map((tc, i) => ({
      id: tc.id ?? `call_${i}`,
      name: tc.function?.name,
      arguments: parseArgs(tc.function?.arguments),
    }));
    return {
      content: msg.content ?? '',
      reasoning: msg.reasoning_content ?? null, // DeepSeek-R1 vb. akıl yürütme alanı
      toolCalls,
      raw: msg,
    };
  }
}

const DEFAULT_MOCK_SCRIPT = [
  { toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }] },
  {
    content:
      '(Mock sağlayıcı) Çalışma alanını listeledim. Gerçek bilimsel model bağlandığında yanıtlar ondan gelecek.',
  },
];

/** Test ve arayüz önizlemesi için betikli sahte sağlayıcı. */
export class MockProvider {
  constructor(script) {
    this.script = Array.isArray(script) && script.length ? [...script] : [...DEFAULT_MOCK_SCRIPT];
    this.calls = [];
  }

  async chat({ messages, tools } = {}) {
    this.calls.push({ messages, tools });
    const next = this.script.shift();
    if (!next) return { content: '(Mock sağlayıcı) Betik bitti.', reasoning: null, toolCalls: [] };
    if (typeof next === 'string') return { content: next, reasoning: null, toolCalls: [] };
    return {
      content: next.content ?? '',
      reasoning: next.reasoning ?? null,
      toolCalls: (next.toolCalls ?? []).map((tc, i) => ({
        id: tc.id ?? `mock_${i}`,
        name: tc.name,
        arguments: tc.arguments ?? {},
      })),
    };
  }
}
