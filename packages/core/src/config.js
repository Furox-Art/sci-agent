import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  model: {
    provider: 'openai-compatible', // 'openai-compatible' | 'mock'
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    name: 'scientific-model',
    temperature: 0.2,
    stream: true,
  },
  agent: { sandbox: { enabled: false }, maxSteps: 25, workspaceRoot: '.', roleModels: {}, requireIndependentReview: false, researchMemory: { autoSave: false }, lessonGate: { enabled: false }, toolRouting: { enabled: true, shortlist: false } },
  plugins: ['sci-tools', 'sci-extra', 'sci-data', 'sci-chem', 'sci-furox', 'sci-quantum', 'sci-lit', 'sci-audit'],
  skills: {
    sources: [
      'github:Furox-Art/quantum-reasoning-skill',
      'github:Furox-Art/eq-layer/skills/eq-layer',
      'github:Furox-Art/polyglot-code-guard',
      'github:Furox-Art/plan-auditor',
      'github:Furox-Art/nomosguard',
      'github:Furox-Art/literature-evidence-mcp',
      'github:Furox-Art/scientific-computing-system',
      'github:Furox-Art/axiomize/skills/axiomize',
      'github:Furox-Art/scientific-computing-system-2.0',
    ],
  },
  policies: { autoApprove: ['read_file', 'list_dir', 'search_files'] },
};

function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over ?? {})) {
    if (['__proto__','constructor','prototype'].includes(k)) throw new Error('Unsafe configuration key');
    // Replace arrays rather than merging them (e.g. skill sources).
    if (v && typeof v === 'object' && !Array.isArray(v) && base[k] && typeof base[k] === 'object' && !Array.isArray(base[k])) {
      deepMerge(base[k], v);
    } else {
      base[k] = v;
    }
  }
  return base;
}

export function loadConfig(cwd = process.cwd()) {
  const file = path.join(cwd, 'sci-agent.config.json');
  let fileCfg = {};
  if (existsSync(file)) {
    try {
      fileCfg = JSON.parse(readFileSync(file, 'utf8'));
    } catch (e) {
      throw new Error(`Could not read config file (${file}): ${e.message}`);
    }
  }
  const cfg = deepMerge(structuredClone(DEFAULT_CONFIG), fileCfg);
  const m = cfg.model;
  if (process.env.SCI_AGENT_PROVIDER) m.provider = process.env.SCI_AGENT_PROVIDER;
  if (process.env.SCI_AGENT_BASE_URL) m.baseUrl = process.env.SCI_AGENT_BASE_URL;
  if (process.env.SCI_AGENT_API_KEY) m.apiKey = process.env.SCI_AGENT_API_KEY;
  if (process.env.SCI_AGENT_MODEL) m.name = process.env.SCI_AGENT_MODEL;
  if (process.env.SCI_AGENT_WORKSPACE) cfg.agent.workspaceRoot = process.env.SCI_AGENT_WORKSPACE;
  cfg.agent.workspaceRoot = path.resolve(cwd, cfg.agent.workspaceRoot);
  return cfg;
}
