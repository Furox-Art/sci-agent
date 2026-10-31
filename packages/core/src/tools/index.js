import { read_file, write_file, list_dir, search_files } from './fs-tools.js';
import { run_command } from './shell-tool.js';

export const defaultTools = [read_file, write_file, list_dir, search_files, run_command];

const MAX_OUTPUT = 16_000;

/**
 * Araç kaydı: şemaları sağlar, onay politikasını uygular, araçları çalıştırır.
 * approve: async (araçAdı, argümanlar) => boolean
 */
export class ToolRegistry {
  constructor({ tools = defaultTools, workspaceRoot, approve, autoApprove = [] } = {}) {
    this.tools = tools;
    this.workspaceRoot = workspaceRoot;
    this.approve = approve ?? (async () => true);
    this.autoApprove = autoApprove;
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

  async invoke(name, args = {}) {
    const tool = this.tools.find((t) => t.name === name);
    if (!tool) return { ok: false, output: `Bilinmeyen araç: ${name}` };
    if (this._needs(name, tool.needsApproval)) {
      let ok = false;
      try {
        ok = await this.approve(name, args);
      } catch {
        ok = false;
      }
      if (!ok) return { ok: false, output: 'Kullanıcı onayı verilmedi; işlem yapılmadı.' };
    }
    try {
      const output = await tool.execute(args, { workspaceRoot: this.workspaceRoot });
      return { ok: true, output: String(output).slice(0, MAX_OUTPUT) };
    } catch (e) {
      return { ok: false, output: `Hata: ${e.message}` };
    }
  }
}
