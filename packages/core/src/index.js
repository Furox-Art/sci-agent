import { MockProvider, OpenAICompatProvider } from './provider.js';
import { DEFAULT_CONFIG, loadConfig } from './config.js';
import { ToolRegistry, defaultTools } from './tools/index.js';
import { getPlugin, listPlugins } from './plugins.js';

export { DEFAULT_CONFIG, loadConfig } from './config.js';
export { OpenAICompatProvider, MockProvider } from './provider.js';
export { ToolRegistry, defaultTools } from './tools/index.js';
export { resolveSafe } from './tools/fs-tools.js';
export { groupTools, toolGroup } from './tools/grouping.js';
export { fetchSkill, githubSkillUrl, parseSkillMd, skillsSystemText } from './skills.js';
export { runAgentLoop, buildSystemPrompt } from './agent.js';
export { getPlugin, listPlugins } from './plugins.js';

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

/**
 * Yapılandırmaya göre araç kaydı oluşturur: varsayılan araçlar + etkin eklentilerin
 * araçları. disableTools ile bazı araçlar çıkarılır (ör. alt ajanlarda task).
 */
export function createRegistry({ cfg, approve, disableTools = [] } = {}) {
  let tools = [...defaultTools];
  for (const name of cfg?.plugins ?? DEFAULT_CONFIG.plugins) {
    const p = getPlugin(name);
    if (p) tools = tools.concat(p.tools);
  }
  if (disableTools.length) tools = tools.filter((t) => !disableTools.includes(t.name));
  return new ToolRegistry({
    tools,
    workspaceRoot: cfg?.agent?.workspaceRoot ?? process.cwd(),
    approve,
    autoApprove: cfg?.policies?.autoApprove ?? DEFAULT_CONFIG.policies.autoApprove,
    cfg,
  });
}
