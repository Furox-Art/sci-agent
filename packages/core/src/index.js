import { MockProvider, OpenAICompatProvider } from './provider.js';
import { DEFAULT_CONFIG, loadConfig } from './config.js';
import { ToolRegistry, defaultTools } from './tools/index.js';
import { sandboxEnabled, sandboxBlockedTool } from './sandbox/local.js';
import { getPlugin, listPlugins } from './plugins.js';

export { DEFAULT_CONFIG, loadConfig } from './config.js';
export { OpenAICompatProvider, MockProvider } from './provider.js';
export { ToolRegistry, defaultTools } from './tools/index.js';
export { resolveSafe } from './tools/fs-tools.js';
export { groupTools, toolGroup } from './tools/grouping.js';
export { fetchSkill, githubSkillUrl, parseSkillMd, skillsSystemText } from './skills.js';
export { buildSteering } from './eq/eq-layer.js';
export { ResearchState } from './science/research-state.js';
export { runAgentLoop, buildSystemPrompt, findUngroundedClaims, scanClaims } from './agent.js';
export { getPlugin, listPlugins } from './plugins.js';

/** Create the provider selected by configuration. */
export function createProvider(modelCfg = {}) {
  if (['chatgpt-plan','copilot-plan','openrouter-account','local-model'].includes(modelCfg.provider)) throw new Error('Account provider requires an explicitly authorized local connection; use sci-agent --provider-menu');
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
 * Build the configured registry from default tools and enabled plugin
 * tools. disableTools excludes selected tools (e.g. task in sub-agents).
 */
export function createRegistry({ cfg, approve, disableTools = [] } = {}) {
  let tools = [...defaultTools];
  for (const name of cfg?.plugins ?? DEFAULT_CONFIG.plugins) {
    const p = getPlugin(name);
    if (p) tools = tools.concat(p.tools);
  }
  if (sandboxEnabled(cfg)) tools = tools.filter(t => !sandboxBlockedTool(t.name));
  if (disableTools.length) tools = tools.filter((t) => !disableTools.includes(t.name));
  return new ToolRegistry({
    tools,
    workspaceRoot: cfg?.agent?.workspaceRoot ?? process.cwd(),
    approve,
    autoApprove: cfg?.policies?.autoApprove ?? DEFAULT_CONFIG.policies.autoApprove,
    cfg,
  });
}

export { causalAnalysis, experimentDesign } from './science/causal-design.js';
export { propagateUncertainty, reproduceEvidence } from './science/uncertainty-replay.js';
export { semanticConflicts } from './science/semantic-check.js';
export { saveResearch, getResearch, searchResearch } from './science/research-memory.js';
export { lessonGate } from './science/lesson-bridge.js';
export { routeTools } from './science/tool-routing.js';

export { analyzeNaturalLanguage } from './science/semantic-nli.js';
export { auditCausalModels } from './science/causal-audit.js';

export { openVault, vaultExists } from './auth/vault.js';
export { ChatGPTAuth, USAGE_URL } from './auth/chatgpt-auth.js';
export { ChatGPTPlanProvider } from './auth/chatgpt-provider.js';

export { OpenRouterAuth, openRouterAuthorization, OPENROUTER_KEYS } from './auth/openrouter.js';
export { CopilotProvider, createCopilotConnection, COPILOT_USAGE, copilotEnvironment, filterCopilotModels } from './auth/copilot-provider.js';

export { sandboxEnabled, sandboxBlockedTool, probeSandbox, runSandboxed } from './sandbox/local.js';

export { LocalModels, LOCAL_RUNTIMES, localEndpoint } from './local-models.js';
