import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';

export const DEFAULT_CONFIG = {
  model: {
    provider: 'openai-compatible', // 'openai-compatible' | 'mock'
    baseUrl: 'http://localhost:11434/v1',
    apiKey: '',
    name: 'bilimsel-model',
    temperature: 0.2,
  },
  agent: { maxSteps: 25, workspaceRoot: '.' },
  policies: { autoApprove: ['read_file', 'list_dir', 'search_files'] },
};

function deepMerge(base, over) {
  for (const [k, v] of Object.entries(over ?? {})) {
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
      throw new Error(`Yapılandırma dosyası okunamadı (${file}): ${e.message}`);
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
