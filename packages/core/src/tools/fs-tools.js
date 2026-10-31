import { promises as fs } from 'node:fs';
import path from 'node:path';

/** Yolu çalışma alanı köküne göre çözer; alan dışına çıkışı engeller. */
export function resolveSafe(root, p) {
  const abs = path.resolve(root, String(p ?? '.'));
  const rel = path.relative(root, abs);
  if (rel.startsWith('..') || path.isAbsolute(rel)) {
    throw new Error(`Çalışma alanı dışına erişim engellendi: ${p}`);
  }
  return abs;
}

const READ_LIMIT_DEFAULT = 200_000;

async function isBinary(abs) {
  const fh = await fs.open(abs, 'r');
  try {
    const buf = Buffer.alloc(1024);
    const { bytesRead } = await fh.read(buf, 0, buf.length, 0);
    return buf.subarray(0, bytesRead).includes(0);
  } finally {
    await fh.close();
  }
}

export const read_file = {
  name: 'read_file',
  description: 'Çalışma alanından bir metin dosyasının içeriğini okur.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Çalışma alanına göre dosya yolu' },
      maxBytes: { type: 'number', description: 'Okunacak en fazla bayt (varsayılan 200000)' },
    },
    required: ['path'],
  },
  needsApproval: false,
  async execute({ path: p, maxBytes = READ_LIMIT_DEFAULT }, { workspaceRoot }) {
    const abs = resolveSafe(workspaceRoot, p);
    const st = await fs.stat(abs);
    if (st.isDirectory()) throw new Error(`Bu bir dizin: ${p}`);
    if (await isBinary(abs)) return `(ikili dosya, içerik gösterilmiyor: ${p})`;
    const limit = Math.min(Number(maxBytes) || READ_LIMIT_DEFAULT, 1_000_000);
    const fh = await fs.open(abs, 'r');
    try {
      const buf = Buffer.alloc(limit);
      const { bytesRead } = await fh.read(buf, 0, limit, 0);
      let out = buf.subarray(0, bytesRead).toString('utf8');
      if (st.size > bytesRead) out += `\n...(kesildi; toplam ${st.size} bayt)`;
      return out;
    } finally {
      await fh.close();
    }
  },
};

export const write_file = {
  name: 'write_file',
  description: 'Çalışma alanına dosya yazar (üst klasörleri gerekirse oluşturur, var olanın üzerine yazar). Onay gerektirir.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Çalışma alanına göre dosya yolu' },
      content: { type: 'string', description: 'Yazılacak içerik' },
    },
    required: ['path', 'content'],
  },
  needsApproval: true,
  async execute({ path: p, content = '' }, { workspaceRoot }) {
    const abs = resolveSafe(workspaceRoot, p);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, content, 'utf8');
    return `${p} yazıldı (${Buffer.byteLength(content, 'utf8')} bayt)`;
  },
};

export const list_dir = {
  name: 'list_dir',
  description: 'Bir dizinin içeriğini listeler.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Çalışma alanına göre dizin (varsayılan kök)' },
    },
  },
  needsApproval: false,
  async execute({ path: p = '.' }, { workspaceRoot }) {
    const abs = resolveSafe(workspaceRoot, p);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    if (!entries.length) return '(boş dizin)';
    const lines = [];
    for (const e of entries.slice(0, 500)) {
      if (e.isDirectory()) {
        lines.push(`${e.name}/`);
      } else {
        let size = '';
        try {
          size = ` (${(await fs.stat(path.join(abs, e.name))).size} bayt)`;
        } catch {}
        lines.push(`${e.name}${size}`);
      }
    }
    if (entries.length > 500) lines.push(`...(toplam ${entries.length} giriş)`);
    return lines.join('\n');
  },
};

export const search_files = {
  name: 'search_files',
  description: 'Dosya adlarında ve (istendiyse) içeriklerinde desen arar. node_modules ve .git atlanır.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Aranan desen (regex; geçersizse düz metin sayılır)' },
      path: { type: 'string', description: 'Aramanın başlayacağı dizin (varsayılan kök)' },
      content: { type: 'boolean', description: 'Dosya içeriğinde de ara (varsayılan true)' },
    },
    required: ['pattern'],
  },
  needsApproval: false,
  async execute({ pattern, path: p = '.', content = true }, { workspaceRoot }) {
    let re;
    try {
      re = new RegExp(pattern, 'i');
    } catch {
      re = new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'i');
    }
    const base = resolveSafe(workspaceRoot, p);
    const hits = [];
    const SKIP = new Set(['node_modules', '.git']);
    async function walk(dir, depth) {
      if (depth > 8 || hits.length >= 50) return;
      let entries;
      try {
        entries = await fs.readdir(dir, { withFileTypes: true });
      } catch {
        return;
      }
      for (const e of entries) {
        if (hits.length >= 50) return;
        if (SKIP.has(e.name)) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        const rel = path.relative(base, full).replace(/\\/g, '/');
        if (re.test(e.name)) {
          hits.push(`${rel} (dosya adı)`);
          continue;
        }
        if (!content) continue;
        try {
          const st = await fs.stat(full);
          if (st.size > 1_000_000) continue;
          const text = await fs.readFile(full, 'utf8');
          const lines = text.split(/\r?\n/);
          let shown = 0;
          for (let i = 0; i < lines.length && shown < 5 && hits.length < 50; i++) {
            if (re.test(lines[i])) {
              hits.push(`${rel}:${i + 1}: ${lines[i].trim().slice(0, 200)}`);
              shown++;
            }
          }
        } catch {}
      }
    }
    await walk(base, 0);
    return hits.length ? hits.join('\n') : '(eşleşme yok)';
  },
};
