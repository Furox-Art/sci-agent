import { read_file, write_file, edit_file, list_dir, search_files } from './fs-tools.js';
import { run_command } from './shell-tool.js';
import { research_hypothesis } from '../science/research-state.js';
import { researchTools } from '../science/research-tools.js';
import { task } from './task-tool.js';

export const defaultTools = [read_file, write_file, edit_file, list_dir, search_files, run_command, task, research_hypothesis, ...researchTools];

const MAX_OUTPUT = 16_000;

/**
 * Araç kaydı: şemaları sağlar, onay politikasını uygular, araçları çalıştırır.
 * approve: async (araçAdı, argümanlar) => boolean
 * invoke'a verilen extraCtx, araç execute bağlamıyla birleştirilir (ör. provider, onEvent).
 */
export class ToolRegistry {
  constructor({ tools = defaultTools, workspaceRoot, approve, autoApprove = [], cfg } = {}) {
    this.tools = tools;
    this.workspaceRoot = workspaceRoot;
    this.approve = approve ?? (async () => true);
    this.autoApprove = autoApprove;
    this.cfg = cfg;
  }

  get(name) {
    return this.tools.find((t) => t.name === name) ?? null;
  }

  list() {
    return this.tools.map(({ name, description, needsApproval }) => ({
      name,
      description,
      needsApproval: this._needs(name, needsApproval),
    }));
  }

  schemas() {
    return this.tools.map(({ name, description, parameters }) => ({ name, description, parameters }));
  }

  _needs(name, declared) {
    return Boolean(declared) && !this.autoApprove.includes(name);
  }

  async invoke(name, args = {}, extraCtx = {}) {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) return { ok: false, output: `Unknown tool: ${name}` };
    if (this._needs(name, tool.needsApproval)) {
      let ok = false;
      try {
        ok = await this.approve(name, args);
      } catch {
        ok = false;
      }
      if (!ok) return { ok: false, output: 'User denied the approval; action not performed.' };
    }
    try {
      const ctx = { workspaceRoot: this.workspaceRoot, cfg: this.cfg, approve: this.approve, registry: this, ...extraCtx };
      const output = await tool.execute(args, ctx);
      const text = String(output);
      return { ok: true, output: text.slice(0, MAX_OUTPUT), ...(text.length > MAX_OUTPUT ? { truncated: true } : {}) };
    } catch (e) {
      return { ok: false, output: `Error: ${e.message}` };
    }
  }
}
