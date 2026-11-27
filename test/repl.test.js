import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { promises as fs } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { startRepl } from '../packages/cli/src/repl.js';
import { listPlugins, getPlugin, createRegistry, loadConfig } from '@sci/core';

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

test('--version, -v and --help exit 0 with the root package.json version (spawnSync)', async () => {
  const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
  const bin = path.join(root, 'packages', 'cli', 'bin', 'sci-agent.js');
  const pkg = JSON.parse(await fs.readFile(path.join(root, 'package.json'), 'utf8'));
  for (const flag of ['--version', '-v']) {
    const r = spawnSync(process.execPath, [bin, flag], { encoding: 'utf8', timeout: 60000 });
    assert.equal(r.status, 0, `${flag} exits 0 (stderr: ${r.stderr})`);
    assert.equal(r.stdout.trim(), `Sci-Agent v${pkg.version}`, `${flag} prints the root package.json version`);
  }
  const h = spawnSync(process.execPath, [bin, '--help'], { encoding: 'utf8', timeout: 60000 });
  assert.equal(h.status, 0, '--help exits 0');
  assert.match(h.stdout, /Sci-Agent v/, '--help shows the version banner');
  assert.match(h.stdout, /--version/, '--help lists --version');
  assert.match(h.stdout, /--prompt/, '--help lists --prompt');
  assert.match(h.stdout, /--workspace/, '--help lists --workspace');
});

test('/tools [filter] narrows the tool listing (piped stdin, no TTY)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-repl-tools-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(root, 'sci-agent.config.json'),
    JSON.stringify({ model: { provider: 'mock' }, skills: { sources: [] } }),
  );
  // Same registry the REPL builds: used to compute the expected filter results.
  const tools = createRegistry({ cfg: loadConfig(root), approve: async () => true }).list();
  const expectedNames = (q) => {
    // Filter semantics: terms separated by | are OR'd, space-separated words are AND'd.
    const terms = String(q).toLowerCase().split('|').map((s) => s.trim()).filter(Boolean);
    return tools
      .filter((t) => {
        const text = `${t.name} ${t.description}`.toLowerCase();
        return terms.some((term) => term.split(/\s+/).every((w) => text.includes(w)));
      })
      .map((t) => t.name)
      .sort();
  };
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'bin', 'sci-agent.js');
  // /clear between /tools invocations splits the output into per-command sections.
  const r = spawnSync(process.execPath, [bin, '--workspace', root], {
    input: '/help\n/tools\n/clear\n/tools write file\n/clear\n/tools write | file\n/clear\n/tools LIT\n/clear\n/tools zzzznope\n/exit\n',
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(r.status, 0, `repl exited cleanly (stderr: ${r.stderr})`);
  const out = String(r.stdout).replace(/\x1b\[[0-9;]*m/g, '').replace(/^sci> /gm, '');
  const [unfiltered, andSection, orSection, litSection, nomatchSection] = out
    .split('Chat cleared (history file was also reset).');
  // Tool lines are "  name[ (requires approval)] — description".
  const namesIn = (section) =>
    [...section.matchAll(/^  (.+?) — (.+)$/gm)].map((m) => m[1].replace(' (requires approval)', '').trim()).sort();

  // /help documents the filter argument
  assert.match(out, /^ {2}\/clear {4}clear chat {8}\/tools {2}tool list \[filter\]$/m);
  // No argument: unchanged behavior — every registry tool is listed.
  assert.deepEqual(namesIn(unfiltered), tools.map((t) => t.name).sort());
  // Space-separated words are AND'd: only write_file matches both "write" and "file".
  assert.deepEqual(namesIn(andSection), ['write_file']);
  // | separates OR terms; the union is exactly the tools matching either word.
  assert.deepEqual(namesIn(orSection), expectedNames('write | file'));
  assert.deepEqual(namesIn(orSection), expectedNames('write').concat(expectedNames('file')).filter((v, i, a) => a.indexOf(v) === i).sort());
  // Case-insensitive, matches name or description (literature tools).
  assert.deepEqual(namesIn(litSection), expectedNames('LIT'));
  assert.ok(namesIn(litSection).length >= 10, 'literature tools match');
  assert.equal(namesIn(litSection).includes('python_eval'), false, 'non-matching tools are hidden');
  // No match: friendly message, no tool lines.
  assert.match(nomatchSection, /^No tools match "zzzznope"\.$/m);
  assert.deepEqual(namesIn(nomatchSection), []);
});

test('/test prints a clear success line with latency (mock provider, piped stdin)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-repl-test-ok-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(root, 'sci-agent.config.json'),
    JSON.stringify({ model: { provider: 'mock' }, skills: { sources: [] } }),
  );
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'bin', 'sci-agent.js');
  const r = spawnSync(process.execPath, [bin, '--workspace', root], {
    input: '/test\n/exit\n',
    encoding: 'utf8',
    timeout: 120000,
    // Scripted mock so the sample response is deterministic ("ok").
    env: { ...process.env, SCI_AGENT_MOCK: JSON.stringify(['ok']) },
  });
  assert.equal(r.status, 0, `repl exited cleanly (stderr: ${r.stderr})`);
  const out = String(r.stdout).replace(/\x1b\[[0-9;]*m/g, '').replace(/^sci> /gm, '');
  assert.match(out, /^Testing model connection…$/m);
  assert.match(out, /^✓ connection ok \(\d+ ms\) — sample response: ok$/m);
});

test('/test prints a clear failure line with latency and does not hang on an unreachable server (piped stdin)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-repl-test-fail-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  // Closed loopback port: connection refused immediately on every platform.
  await fs.writeFile(
    path.join(root, 'sci-agent.config.json'),
    JSON.stringify({ model: { provider: 'openai-compat', baseUrl: 'http://127.0.0.1:1', name: 'unused' }, skills: { sources: [] } }),
  );
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'bin', 'sci-agent.js');
  const r = spawnSync(process.execPath, [bin, '--workspace', root], {
    input: '/test\n/exit\n',
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(r.status, 0, `repl exited cleanly (stderr: ${r.stderr})`);
  const out = String(r.stdout).replace(/\x1b\[[0-9;]*m/g, '').replace(/^sci> /gm, '');
  assert.match(out, /^Testing model connection…$/m);
  assert.match(out, /^✕ failed \(\d+ ms\): .+$/m);
  assert.doesNotMatch(out, /✓ connection ok/);
  // The connection test itself completed quickly (the /test request is capped at 15 s).
  const ms = Number(out.match(/^✕ failed \((\d+) ms\)/m)?.[1]);
  assert.ok(Number.isFinite(ms) && ms < 15000, `failure reported quickly (${ms} ms)`);
});

test('/skills add with no argument prints usage instead of calling the model (piped stdin)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-repl-skills-usage-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(root, 'sci-agent.config.json'),
    JSON.stringify({ model: { provider: 'mock' }, skills: { sources: [] } }),
  );
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'bin', 'sci-agent.js');
  const r = spawnSync(process.execPath, [bin, '--workspace', root], {
    input: '/skills add\n/exit\n',
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(r.status, 0, `repl exited cleanly (stderr: ${r.stderr})`);
  const out = String(r.stdout).replace(/\x1b\[[0-9;]*m/g, '').replace(/^sci> /gm, '');
  assert.match(out, /^Usage: \/skills add github:user\/repo\[\/sub\/path\]$/m);
  // The bare command must not leak into the agent loop (no mock model response follows).
  assert.doesNotMatch(out, /Mock provider/);
  assert.doesNotMatch(out, /✓ Skill added/);
  // Nothing was persisted to the config.
  const cfgAfter = JSON.parse(await fs.readFile(path.join(root, 'sci-agent.config.json'), 'utf8'));
  assert.deepEqual(cfgAfter.skills?.sources, []);
});

test('/skills add with an invalid source prints "✕ <source>: <message>", exits cleanly and persists nothing (piped stdin)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-repl-skills-fail-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(root, 'sci-agent.config.json'),
    JSON.stringify({ model: { provider: 'mock' }, skills: { sources: [] } }),
  );
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'bin', 'sci-agent.js');
  // "notaskill:…" lacks the github: prefix, so fetchSkill rejects immediately (no network).
  const r = spawnSync(process.execPath, [bin, '--workspace', root], {
    input: '/skills add notaskill:foo/bar\n/exit\n',
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(r.status, 0, `repl exited cleanly (stderr: ${r.stderr})`);
  const out = String(r.stdout).replace(/\x1b\[[0-9;]*m/g, '').replace(/^sci> /gm, '');
  assert.match(out, /^Adding skill notaskill:foo\/bar…$/m);
  // Failure line carries the source prefix, same format as the /skills listing.
  assert.match(out, /^✕ notaskill:foo\/bar: Invalid skill source: notaskill:foo\/bar .+"github:user\/repo" expected\)$/m);
  assert.doesNotMatch(out, /✓ Skill added/);
  // A failed add must not persist the source.
  const cfgAfter = JSON.parse(await fs.readFile(path.join(root, 'sci-agent.config.json'), 'utf8'));
  assert.deepEqual(cfgAfter.skills?.sources, []);
});

test('deleting the current session starts a fresh "default" session without title ghosting (piped stdin)', async (t) => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), 'sciagent-repl-del-'));
  t.after(async () => {
    await fs.rm(root, { recursive: true, force: true });
  });
  await fs.writeFile(
    path.join(root, 'sci-agent.config.json'),
    JSON.stringify({ model: { provider: 'mock' }, skills: { sources: [] } }),
  );
  // One saved session, which the REPL picks up as the current session at startup.
  const sessDir = path.join(root, '.sci-agent-sessions');
  await fs.mkdir(sessDir);
  await fs.writeFile(
    path.join(sessDir, 'ghost.json'),
    JSON.stringify({
      id: 'ghost',
      title: 'ghost-session',
      updatedAt: '2026-01-01T00:00:00.000Z',
      messages: [
        { role: 'system', content: 'sys' },
        { role: 'user', content: 'hi' },
      ],
    }),
  );
  const bin = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'packages', 'cli', 'bin', 'sci-agent.js');
  const r = spawnSync(process.execPath, [bin, '--workspace', root], {
    input: '/sessions del 1\n/clear\n/sessions\n/exit\n',
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(r.status, 0, `repl exited cleanly (stderr: ${r.stderr})`);
  const out = String(r.stdout).replace(/\x1b\[[0-9;]*m/g, '').replace(/^sci> /gm, '');
  assert.match(out, /^Session deleted: ghost-session \(it was the current session; started fresh\)$/m);
  assert.rejects(() => fs.access(path.join(sessDir, 'ghost.json')));
  // The fresh session must be titled "default", not resurrect the deleted title.
  const listed = out.match(/^ {2}1\. (.+?) \d+ messages · /m)?.[1];
  assert.equal(listed, 'default');
  const fresh = JSON.parse(await fs.readFile(path.join(sessDir, 'default.json'), 'utf8'));
  assert.equal(fresh.title, 'default');
});
