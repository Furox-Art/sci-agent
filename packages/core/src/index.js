import { MockProvider, OpenAICompatProvider } from './provider.js';

export { DEFAULT_CONFIG, loadConfig } from './config.js';
export { OpenAICompatProvider, MockProvider } from './provider.js';
export { ToolRegistry, defaultTools } from './tools/index.js';
export { runAgentLoop, buildSystemPrompt } from './agent.js';

/** Yapılandırmaya göre uygun sağlayıcıyı oluşturur. */
export function createProvider(modelCfg = {}) {
  if (modelCfg.provider === 'mock') {
    let script;
    if (process.env.SCI_AGENT_MOCK) {
      try {
        script = JSON.parse(process.env.SCI_AGENT_MOCK);
      } catch {
        script = undefined;
      }
    }
    return new MockProvider(script);
  }
  return new OpenAICompatProvider(modelCfg);
}
