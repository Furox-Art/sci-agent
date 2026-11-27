import { promises as fs, realpathSync, lstatSync, constants } from 'node:fs';
import path from 'node:path';

// Reject symbolic links, special files and hardlinked regular files along a
// workspace path. This is a local path guard, not a race-proof OS sandbox.
export function resolveSafe(root, p) {
  const requested=path.resolve(root);
  const abs=path.resolve(requested,String(p??'.'));
  const rel=path.relative(requested,abs);
  if(rel==='..'||rel.startsWith('..'+path.sep)||path.isAbsolute(rel))throw new Error('Access outside the workspace is blocked');
  const base=realpathSync(requested);
  if(!lstatSync(base).isDirectory())throw new Error('Workspace must be a directory');
  let current=base,missing=false;
  for(const part of rel.split(path.sep).filter(Boolean)){
    if(process.platform==='win32'&&(/[:. ]$/.test(part)||part.includes(':')||/^(?:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)/i.test(part)))throw new Error('Unsafe Windows path');
    current=path.join(current,part);
    if(missing)continue;
    let st;
    try{st=lstatSync(current);}catch(e){if(e.code==='ENOENT'){missing=true;continue;}throw e;}
    if(st.isSymbolicLink()||(!st.isDirectory()&&!st.isFile())||(st.isFile()&&st.nlink!==1))throw new Error('Symbolic links, hard links and special files are blocked');
  }
  return current;
}

function assertRegular(st){
  if(!st.isFile()||st.nlink!==1)throw new Error('Only regular non-hardlinked files are allowed');
}
const nofollow=(constants.O_NOFOLLOW??0)|(constants.O_NONBLOCK??0);
async function openRegular(abs,flags=constants.O_RDONLY){
  const fh=await fs.open(abs,flags|nofollow,0o600);
  try{assertRegular(await fh.stat());return fh;}
  catch(e){await fh.close();throw e;}
}
export async function readSafeText(root,p){
  const abs=resolveSafe(root,p);
  const fh=await openRegular(abs);
  try{return await fh.readFile('utf8');}finally{await fh.close();}
}
async function writeRegular(root,p,text){
  let abs=resolveSafe(root,p);
  await fs.mkdir(path.dirname(abs),{recursive:true});
  abs=resolveSafe(root,p);
  const fh=await openRegular(abs,constants.O_WRONLY|constants.O_CREAT);
  try{await fh.truncate(0);await fh.writeFile(text,'utf8');}finally{await fh.close();}
}

const READ_LIMIT_DEFAULT = 200_000;

async function isBinary(abs) {
  const fh = await openRegular(abs);
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
  description: 'Reads the content of a text file from the workspace.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace' },
      maxBytes: { type: 'number', description: 'Maximum bytes to read (default 200000)' },
    },
    required: ['path'],
  },
  needsApproval: false,
  async execute({ path: p, maxBytes = READ_LIMIT_DEFAULT }, { workspaceRoot }) {
    const abs = resolveSafe(workspaceRoot, p);
    const st = await fs.lstat(abs);
    if (st.isDirectory()) throw new Error(`This is a directory: ${p}`);
    if (await isBinary(abs)) return `(binary file, content not shown: ${p})`;
    const limit = Math.max(1,Math.min(Math.floor(Number(maxBytes)||READ_LIMIT_DEFAULT),1_000_000));
    const fh = await openRegular(abs);
    try {
      const buf = Buffer.alloc(limit);
      const { bytesRead } = await fh.read(buf, 0, limit, 0);
      let out = buf.subarray(0, bytesRead).toString('utf8');
      if (st.size > bytesRead) out += `\n...(truncated; ${st.size} bytes total)`;
      return out;
    } finally {
      await fh.close();
    }
  },
};

export const write_file = {
  name: 'write_file',
  description: 'Writes a file into the workspace (creates parent folders if needed, overwrites an existing file). Requires approval.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace' },
      content: { type: 'string', description: 'Content to write' },
    },
    required: ['path', 'content'],
  },
  needsApproval: true,
  async execute({ path: p, content = '' }, { workspaceRoot }) {
    await writeRegular(workspaceRoot,p,content);
    return `${p} written (${Buffer.byteLength(content, 'utf8')} bytes)`;
  },
};

export const edit_file = {
  name: 'edit_file',
  description:
    'Finds an old text snippet in a file and replaces it with new text. The old text must appear in the file exactly; if there are many matches it errors (use replaceAll to replace all of them).',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'File path relative to the workspace' },
      oldText: { type: 'string', description: 'Exact text to replace, as it appears in the file' },
      newText: { type: 'string', description: 'Text to write in its place' },
      replaceAll: { type: 'boolean', description: 'Replace all matches (default false)' },
    },
    required: ['path', 'oldText', 'newText'],
  },
  needsApproval: true,
  async execute({ path: p, oldText, newText, replaceAll = false }, { workspaceRoot }) {
    if (!oldText) throw new Error('oldText cannot be empty');
    const abs = resolveSafe(workspaceRoot, p);
    if (await isBinary(abs)) throw new Error(`binary file cannot be edited: ${p}`);
    const src = await readSafeText(workspaceRoot,p);
    const count = src.split(oldText).length - 1;
    if (count === 0) throw new Error('old text not found in file');
    if (count > 1 && !replaceAll) {
      throw new Error(`old text appears ${count} times; provide a more specific (longer) snippet or use replaceAll`);
    }
    const out = replaceAll ? src.replaceAll(oldText, newText) : src.replace(oldText, newText);
    await writeRegular(workspaceRoot,p,out);
    return `${p} updated (${replaceAll ? count : 1} changes)`;
  },
};

export const list_dir = {
  name: 'list_dir',
  description: 'Lists the contents of a directory.',
  parameters: {
    type: 'object',
    properties: {
      path: { type: 'string', description: 'Directory relative to the workspace (default root)' },
    },
  },
  needsApproval: false,
  async execute({ path: p = '.' }, { workspaceRoot }) {
    const abs = resolveSafe(workspaceRoot, p);
    const entries = await fs.readdir(abs, { withFileTypes: true });
    if (!entries.length) return '(empty directory)';
    const lines = [];
    for (const e of entries.slice(0, 500)) {
      if(e.isSymbolicLink()){lines.push(e.name+' (link; not followed)');continue;}
      if (e.isDirectory()) {
        lines.push(`${e.name}/`);
      } else {
        let size = '';
        try {
          size = ` (${(await fs.lstat(path.join(abs, e.name))).size} bytes)`;
        } catch {}
        lines.push(`${e.name}${size}`);
      }
    }
    if (entries.length > 500) lines.push(`...(${entries.length} entries total)`);
    return lines.join('\n');
  },
};

export const search_files = {
  name: 'search_files',
  description: 'Searches file names and (optionally) their contents for a pattern. node_modules and .git are skipped.',
  parameters: {
    type: 'object',
    properties: {
      pattern: { type: 'string', description: 'Pattern to search for (regex; treated as plain text if invalid)' },
      path: { type: 'string', description: 'Directory to start the search from (default root)' },
      content: { type: 'boolean', description: 'Also search file contents (default true)' },
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
        if (SKIP.has(e.name)||e.isSymbolicLink()||(!e.isDirectory()&&!e.isFile())) continue;
        const full = path.join(dir, e.name);
        if (e.isDirectory()) {
          await walk(full, depth + 1);
          continue;
        }
        const rel = path.relative(base, full).replace(/\\/g, '/');
        if (re.test(e.name)) {
          hits.push(`${rel} (file name)`);
          continue;
        }
        if (!content) continue;
        try {
          const checked=resolveSafe(workspaceRoot,path.relative(realpathSync(workspaceRoot),full));
          const st = await fs.lstat(checked);
          if (st.size > 1_000_000) continue;
          const text = await readSafeText(workspaceRoot,path.relative(realpathSync(workspaceRoot),full));
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
    return hits.length ? hits.join('\n') : '(no matches)';
  },
};
