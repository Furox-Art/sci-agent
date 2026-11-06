import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRepl } from '../packages/cli/src/repl.js';
import { listPlugins, getPlugin } from '@sci/core';

test('repl module imports cleanly without a TTY', () => {
  assert.equal(typeof startRepl, 'function');
});

test('plugin data behind /plugins is well-formed', () => {
  const plugins = listPlugins();
  assert.ok(plugins.length > 0);
  const names = new Set();
  let total = 0;
  for (const p of plugins) {
    assert.ok(p.name, 'plugin name is set');
    assert.ok(p.description, 'plugin description is set');
    assert.equal(names.has(p.name), false, 'plugin names are unique');
    names.add(p.name);
    const n = (getPlugin(p.name)?.tools ?? []).length;
    assert.ok(Number.isInteger(n) && n >= 0, `tool count for ${p.name} is a non-negative integer`);
    total += n;
  }
  assert.ok(total > 0, 'plugins expose tools in total');
  assert.ok(names.has('sci-tools'));
});

test('/help, /plugins and /skills work through the real REPL (piped stdin, no TTY)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-repl-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  // Empty skill sources → /skills must print the "No skills loaded" hint (no network).
  await fs.writeFile(
    path.join(root, 'sci-agent.config.json'),
    JSON.stringify({ model: { provider: 'mock' }, skills: { sources: [] } }),
  );
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'bin', 'sci-agent.js');
  const r = spawnSync(process.execPath, [bin, '--workspace', root], {
    input: '/help\n/plugins\n/skills\n/exit\n',
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(r.status, 0, `repl exited cleanly (stderr: ${r.stderr})`);
  const stripAnsi = (s) => String(s).replace(/\x1b\[[0-9;]*m/g, '');
  const out = stripAnsi(r.stdout);

  // Piped stdin: readline writes the "sci> " prompt without a newline, so the first
  // output line of each command carries the prompt prefix — allow it in the anchors.
  const pre = '(?:sci> )?';
  // /help lists the new commands in the existing column style
  assert.match(out, new RegExp(`^  \\/plugins  plugin list       \\/skills loaded skills$`, 'm'));
  // /plugins: one line per plugin "name — description (N tools)" plus a total line
  assert.match(out, new RegExp(`^${pre}sci-tools — .+ \\(2 tools\\)$`, 'm'));
  assert.match(out, /^sci-quantum — .+ \(0 tools\)$/m);
  assert.match(out, /^Total: \d+ plugins, \d+ tools$/m);
  const totalTools = Number(out.match(/^Total: (\d+) plugins, (\d+) tools$/m)?.[2]);
  const listedTools = [...out.matchAll(new RegExp(`^${pre}(.+) — .+ \\((\\d+) tools\\)$`, 'gm'))].reduce((a, m) => a + Number(m[2]), 0);
  assert.equal(listedTools, totalTools, 'per-plugin counts add up to the total');
  // /skills with empty config: hint references the real add command
  assert.match(out, new RegExp(`^${pre}No skills loaded — add one with \\/skills add github:user\\/repo\\[\\/sub\\/path\\]$`, 'm'));
});
