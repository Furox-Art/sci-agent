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
 * Varsayılan olarak akışlı (stream) ister; sunucu akışı reddederse bir kez akışsız dener.
 */
export class OpenAICompatProvider {
  // Yapılandırmada model adı `name` alanında taşınır; `model` takma adı da kabul edilir.
  constructor({ baseUrl, apiKey = '', model, name, temperature = 0.2, stream = true, fetchImpl = fetch } = {}) {
    if (!baseUrl) throw new Error('model.baseUrl gerekli');
    if (!model && !name) throw new Error('model.name gerekli');
    this.baseUrl = String(baseUrl).replace(/\/+$/, '');
    this.apiKey = apiKey;
    this.model = model ?? name;
    this.temperature = temperature;
    this.stream = stream !== false;
    this.fetchImpl = fetchImpl;
  }

  async chat({ messages, tools = [], signal, onChunk } = {}) {
    const emit = (type, text) => {
      try {
        onChunk?.({ type, text });
      } catch {}
    };
    if (this.stream) {
      try {
        return await this.#request(messages, tools, signal, true, emit);
      } catch (e) {
        if (!e.fallback) throw e;
        emit('info', `Akış başarısız (${String(e.message).slice(0, 120)}); akışsız moda geçildi.`);
      }
    }
    return await this.#request(messages, tools, signal, false, emit);
  }

  async #request(messages, tools, signal, stream, emit) {
    const body = { model: this.model, temperature: this.temperature, messages };
    if (tools.length) {
      body.tools = tools.map((t) => ({
        type: 'function',
        function: { name: t.name, description: t.description, parameters: t.parameters },
      }));
    }
    if (stream) body.stream = true;

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
      const err = new Error(`Model sunucusu ${res.status} döndü: ${text.slice(0, 500)}`);
      err.fallback = stream; // akış denemesiyse akışsız tekrar denenebilir
      throw err;
    }

    if (!stream) {
      const data = await res.json();
      const msg = data?.choices?.[0]?.message;
      if (!msg) throw new Error(`Beklenmeyen yanıt biçimi: ${JSON.stringify(data).slice(0, 300)}`);
      return {
        content: msg.content ?? '',
        reasoning: msg.reasoning_content ?? null, // DeepSeek-R1 vb. akıl yürütme alanı
        toolCalls: (msg.tool_calls ?? []).map((tc, i) => ({
          id: tc.id ?? `call_${i}`,
          name: tc.function?.name,
          arguments: parseArgs(tc.function?.arguments),
        })),
        streamed: false,
      };
    }

    // SSE akışı: parçaları topla, deltaları yayınla.
    let content = '';
    let reasoning = '';
    let emitted = false;
    const toolAcc = new Map();
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    const note = (type, text) => {
      emitted = true;
      emit(type, text);
    };

    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const lines = buf.split(/\r?\n/);
      buf = lines.pop();
      for (const line of lines) {
        const l = line.trim();
        if (!l.startsWith('data:')) continue;
        const payload = l.slice(5).trim();
        if (!payload || payload === '[DONE]') continue;
        let json;
        try {
          json = JSON.parse(payload);
        } catch {
          continue;
        }
        const delta = json?.choices?.[0]?.delta ?? {};
        if (delta.reasoning_content) {
          reasoning += delta.reasoning_content;
          note('reasoning_delta', delta.reasoning_content);
        }
        if (delta.content) {
          content += delta.content;
          note('text_delta', delta.content);
        }
        for (const tc of delta.tool_calls ?? []) {
          const i = tc.index ?? 0;
          const cur = toolAcc.get(i) ?? { id: tc.id, name: '', args: '' };
          if (tc.id) cur.id = tc.id;
          if (tc.function?.name) cur.name += tc.function.name;
          if (tc.function?.arguments) cur.args += tc.function.arguments;
          toolAcc.set(i, cur);
        }
      }
    }

    const toolCalls = [...toolAcc.entries()]
      .sort((a, b) => a[0] - b[0])
      .map(([i, t], idx) => ({ id: t.id ?? `call_${idx}`, name: t.name, arguments: parseArgs(t.args) }));
    return { content, reasoning: reasoning || null, toolCalls, streamed: emitted };
  }
}

const DEFAULT_MOCK_SCRIPT = [
  { toolCalls: [{ name: 'list_dir', arguments: { path: '.' } }] },
  {
    content:
      '(Mock sağlayıcı) Çalışma alanını listeledim. Gerçek bilimsel model bağlandığında yanıtlar ondan gelecek.',
  },
];

/** Test ve arayüz önizlemesi için betikli sahte sağlayıcı; içeriği kelimeler halinde akıtır. */
export class MockProvider {
  constructor(script) {
    this.script = Array.isArray(script) && script.length ? [...script] : [...DEFAULT_MOCK_SCRIPT];
    this.calls = [];
  }

  async chat({ messages, tools, onChunk } = {}) {
    this.calls.push({ messages, tools });
    const next = this.script.shift();
    if (!next) return this.#finish('(Mock sağlayıcı) Betik bitti.', [], onChunk);
    if (typeof next === 'string') return this.#finish(next, [], onChunk);
    const toolCalls = (next.toolCalls ?? []).map((tc, i) => ({
      id: tc.id ?? `mock_${i}`,
      name: tc.name,
      arguments: tc.arguments ?? {},
    }));
    return this.#finish(next.content ?? '', toolCalls, onChunk);
  }

  #finish(content, toolCalls, onChunk) {
    let emitted = false;
    if (onChunk && content) {
      for (const piece of content.split(/(?<=\s)/)) {
        try {
          onChunk({ type: 'text_delta', text: piece });
          emitted = true;
        } catch {}
      }
    }
    return { content, reasoning: null, toolCalls, streamed: emitted };
  }
}
