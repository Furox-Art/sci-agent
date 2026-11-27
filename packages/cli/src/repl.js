import readline from 'node:readline';
import path from 'node:path';
import { readdirSync, readFileSync, unlinkSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { loadConfig, createProvider, createRegistry, runAgentLoop, buildSystemPrompt, groupTools, fetchSkill, listPlugins, getPlugin, saveResearch, getResearch, searchResearch, lessonGate } from '@sci/core';
import { buildSteering } from '../../core/src/eq/eq-layer.js';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const trunc = (s, n = 400) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

const HELP = [
  'Commands:',
  '  /help     help              /model  model info',
  '  /clear    clear chat        /tools  tool list [filter]',
  '  /plugins  plugin list       /skills loaded skills',
  '  /sessions [no|del no|ren no title]  list / switch / delete / rename sessions',
  '  /save     save chat as .md',
  '  /research inspect latest run evidence, hypotheses and reviews',
  '  /memory save [label] | search [query] | get <id>',
  '  /lesson stats | preflight | export',
  '  /test     test model connection',
  '  /exit     exit',
].join('\n');

export async function startRepl(argv = []) {
  const wi = argv.indexOf('--workspace');
  const workspace = wi !== -1 && argv[wi + 1] ? path.resolve(argv[wi + 1]) : process.cwd();
  process.chdir(workspace);

  const cfg = loadConfig(workspace);
  const messages = [{ role: 'system', content: buildSystemPrompt(cfg) }];

  // Session history: most recent session file
  const sessionsDir = path.join(cfg.agent.workspaceRoot, '.sci-agent-sessions');
  let sessionFile = null;
  let sessionTitle = 'default';
  let loadedMsgs = 0;
  try {
    const sorted = readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const d = JSON.parse(readFileSync(path.join(sessionsDir, f), 'utf8'));
          return { f, updatedAt: String(d.updatedAt ?? ''), title: String(d.title ?? 'default'), messages: d.messages };
        } catch {
          return null;
        }
      })
      .filter(Boolean)
      .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    if (sorted.length && Array.isArray(sorted[0].messages) && sorted[0].messages.length) {
      sessionFile = path.join(sessionsDir, sorted[0].f);
      sessionTitle = sorted[0].title;
      messages.length = 0;
      messages.push(...sorted[0].messages);
      loadedMsgs = sorted[0].messages.length;
    }
  } catch {}
  const saveHistory = () => {
    try {
      if (sessionFile) {
        writeFileSync(
          sessionFile,
          JSON.stringify({ id: path.basename(sessionFile, '.json'), title: sessionTitle, updatedAt: new Date().toISOString(), messages }),
        );
      } else {
        writeFileSync(
          path.join(sessionsDir, 'default.json'),
          JSON.stringify({ id: 'default', title: sessionTitle, updatedAt: new Date().toISOString(), messages }),
        );
      }
    } catch {}
  };
  const listSessionFiles = () => {
    try {
      return readdirSync(sessionsDir)
        .filter((f) => f.endsWith('.json'))
        .map((f) => {
          try {
            const d = JSON.parse(readFileSync(path.join(sessionsDir, f), 'utf8'));
            return {
              path: path.join(sessionsDir, f),
              title: String(d.title ?? f),
              date: String(d.updatedAt ?? '').slice(0, 16).replace('T', ' '),
              messages: d.messages,
            };
          } catch {
            return null;
          }
        })
        .filter(Boolean)
        .sort((a, b) => b.date.localeCompare(a.date));
    } catch {
      return [];
    }
  };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  // Approval prompts are queued so parallel sub-agents never overlap
  let approvalQueue = Promise.resolve();
  const approveSerial = (name, args) => {
    const run = approvalQueue.then(async () => {
      const a = await ask(`\n${bold('[Approve]')} ${name} ${trunc(JSON.stringify(args), 200)} (y/n) `);
      return /^(e(vet)?|y(es)?)$/i.test(a.trim());
    });
    approvalQueue = run.then(() => {}, () => {});
    return run;
  };

  const registry = createRegistry({ cfg, approve: approveSerial });

  let pendingNewline = false;
  const flushLine = () => {
    if (pendingNewline) {
      process.stdout.write('\n');
      pendingNewline = false;
    }
  };
  // Lightweight terminal markdown: code blocks cyan, headings/bold, `code` cyan
  const mdTerm = (s) =>
    String(s)
      .replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => `\n${dim(`── ${lang || 'code'} ──────────`)}\n${cyan(code.trimEnd())}\n${dim('──────────────')}`)
      .replace(/`([^`\n]+)`/g, cyan('$1'))
      .replace(/\*\*([^*\n]+)\*\*/g, bold('$1'))
      .replace(/^### (.*)$/gm, (m1, h) => bold(h))
      .replace(/^## (.*)$/gm, (m1, h) => bold(h));

  // Line-by-line markdown polish while streaming: code blocks cyan, headings/bold
  let mdLineBuf = '';
  let mdInCode = false;
  const styleLine = (line) => {
    if (/^\s*```/.test(line)) {
      mdInCode = !mdInCode;
      return dim(`── ${line.trim().replace(/^```/, '') || 'code'} ──`);
    }
    if (mdInCode) return cyan(line);
    let s = line;
    s = s.replace(/\bhttps?:\/\/\S+/g, (u) => cyan(u));
    s = s.replace(/`([^`]+)`/g, cyan('$1'));
    s = s.replace(/\*\*([^*]+)\*\*/g, bold('$1'));
    if (/^#{1,3} /.test(s)) return bold(s);
    return s;
  };
  const feedStreamText = (text) => {
    mdLineBuf += text;
    let idx;
    while ((idx = mdLineBuf.indexOf('\n')) !== -1) {
      process.stdout.write(styleLine(mdLineBuf.slice(0, idx)) + '\n');
      mdLineBuf = mdLineBuf.slice(idx + 1);
    }
  };
  const flushStreamText = () => {
    if (mdLineBuf) {
      process.stdout.write(styleLine(mdLineBuf) + '\n');
      mdLineBuf = '';
    }
    pendingNewline = false;
  };

  const printEvent = (ev) => {
    if (ev.type === 'reasoning') {
      flushLine();
      console.log(dim(`🧠 ${trunc(ev.text, 600)}`));
    } else if (ev.type === 'reasoning_delta') {
      process.stdout.write(dim(ev.text));
      pendingNewline = true;
    } else if (ev.type === 'text_delta') {
      feedStreamText(ev.text);
      pendingNewline = mdLineBuf.length > 0;
    } else if (ev.type === 'text') {
      flushLine();
      flushStreamText();
      console.log(mdTerm(ev.text));
    } else if (ev.type === 'info') {
      flushLine();
      console.log(dim(ev.text));
    } else if (ev.type === 'tool_call') {
      flushLine();
      flushStreamText();
      console.log(cyan(`\n→ ${ev.name} ${trunc(JSON.stringify(ev.args), 300)}`));
    } else if (ev.type === 'tool_result') {
      flushLine();
      console.log(ev.ok ? dim(`← ${ev.evidenceId ? '[' + ev.evidenceId + '] ' : ''}${trunc(ev.output, 500)}`) : red(`← ${trunc(ev.output, 500)}`));
    } else if (ev.type === 'error') {
      flushLine();
      console.log(red(`Error: ${ev.text}`));
    } else if (ev.type === 'warning') {
      flushLine();
      console.log(red(`⚠ ${ev.text}`));
    } else if (ev.type === 'step') {
      flushLine();
      console.log(dim(`— step ${ev.step}/${ev.maxSteps} —`));
    } else if (ev.type === 'task_start') {
      flushLine();
      console.log(dim(`▶ Sub-agent started: ${trunc(ev.prompt, 120)}`));
    } else if (ev.type === 'task_end') {
      flushLine();
      console.log(dim(`■ Sub-agent finished: ${trunc(ev.prompt, 80)}`));
    } else if (ev.type === 'sub_event') {
      flushLine();
      const e = ev.ev ?? {};
      const what =
        e.type === 'tool_call'
          ? `tool → ${e.name}`
          : e.type === 'text'
            ? trunc(e.text, 150)
            : e.type === 'error'
              ? `error: ${trunc(e.text, 100)}`
              : e.type;
      console.log(dim(`  ↳ ${trunc(ev.prompt, 40)} · ${what}`));
    }
  };

  let latestResearch = null;
  let latestResearchStatus = 'partial';
  async function handle(input) {
    latestResearch = null;
    messages.push({ role: 'user', content: input });
    console.log(dim(`[${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}]`));
    mdLineBuf = '';
    mdInCode = false;
    try {
      // eq-layer steering: runs before the model call; silently skipped on error.
      let systemExtra;
      try {
        const steer = await buildSteering({ messages: messages.slice(-6), workspaceRoot: cfg.agent.workspaceRoot });
        if (steer?.steering) {
          systemExtra = steer.steering;
          console.log(dim(`eq-layer: steering applied (${steer.source})`));
        }
      } catch {}
      const provider = createProvider(cfg.model);
      const result = await runAgentLoop({ provider, registry, messages, maxSteps: cfg.agent.maxSteps, onEvent: printEvent, systemExtra });
      latestResearch = result.research;
      latestResearchStatus = result.unverified ? 'withheld' : result.done ? 'completed' : 'partial';
    } catch (e) {
      console.log(red(`Error: ${e.message}`));
    }
    flushStreamText();
    saveHistory();
    console.log();
  }

  const version = JSON.parse(
    readFileSync(fileURLToPath(new URL('../../../package.json', import.meta.url)), 'utf8'),
  ).version;
  console.log(bold(`SciAgent v${version} — scientific coding agent`));
  console.log(`Model: ${cfg.model.provider} @ ${cfg.model.baseUrl} (${cfg.model.name})`);
  console.log(`Workspace: ${cfg.agent.workspaceRoot} | Tools: ${registry.tools.length}`);
  console.log(dim(HELP));
  if (loadedMsgs) console.log(dim(`Previous session loaded (${loadedMsgs - 1} messages) — /clear to reset.`));

  const once = argv.indexOf('--prompt');
  if (once !== -1 && argv[once + 1]) {
    await handle(argv[once + 1]);
    rl.close();
    return;
  }

  let busy = false;
  rl.setPrompt('sci> ');
  rl.prompt();
  rl.on('line', async (line) => {
    const input = line.trim();
    if (!input) {
      rl.prompt();
      return;
    }
    if (busy) {
      console.log(dim('(previous task running; please wait)'));
      return;
    }
    try {
      if (input === '/exit') {
        rl.close();
        return;
      }
      if (input === '/help') console.log(HELP);
      else if (input === '/model') {
        console.log(JSON.stringify({ ...cfg.model, apiKey: cfg.model.apiKey ? '(set)' : '' }, null, 2));
      } else if (input === '/memory' || input.startsWith('/memory ')) {
        busy = true;
        try {
          const [action,...tail]=input.slice('/memory'.length).trim().split(/\s+/);
          const value=tail.join(' ');
          if(action==='save'){
            if(!latestResearch)throw new Error('No latest research snapshot');
            console.log(JSON.stringify(await saveResearch(cfg.agent.workspaceRoot,latestResearch,{label:value,status:latestResearchStatus}),null,2));
          } else if(action==='search'||!action){
            console.log(JSON.stringify(await searchResearch(cfg.agent.workspaceRoot,value),null,2));
          } else if(action==='get'){
            console.log(JSON.stringify(await getResearch(cfg.agent.workspaceRoot,value),null,2));
          } else throw new Error('Usage: /memory save [label] | search [query] | get <id>');
        } finally { busy = false; }
      } else if (input === '/lesson' || input.startsWith('/lesson ')) {
        const action=input.slice('/lesson'.length).trim() || 'stats';
        if(!['stats','preflight','export'].includes(action))throw new Error('Usage: /lesson stats | preflight | export');
        busy = true;
        try {
          const result=await lessonGate(cfg.agent.workspaceRoot,action);
          console.log(result.code===0?result.output:red(result.output||result.diagnostic));
        } finally { busy = false; }
      } else if (input === '/research') {
        console.log(latestResearch ? JSON.stringify(latestResearch, null, 2) : 'No research state for the latest run.');
      } else if (input === '/tools' || input.startsWith('/tools ')) {
        // Optional filter: terms separated
        // by | are OR'd, space-separated words are AND'd (case-insensitive substrings).
        const filter = input.slice('/tools'.length).trim().toLowerCase();
        const terms = filter.split('|').map((s) => s.trim()).filter(Boolean);
        const matches = (t) => {
          if (!terms.length) return true;
          const text = `${t.name} ${t.description}`.toLowerCase();
          return terms.some((term) => term.split(/\s+/).every((w) => text.includes(w)));
        };
        const groups = groupTools(registry.list().filter(matches));
        if (!groups.size) console.log(dim(`No tools match "${filter}".`));
        for (const [title, tools] of groups) {
          console.log(bold(`${title} (${tools.length})`));
          for (const t of tools) {
            console.log(`  ${t.name === 'task' ? cyan(t.name) : t.name}${t.needsApproval ? dim(' (requires approval)') : ''} — ${t.description}`);
          }
        }
      } else if (input === '/plugins') {
        // Registered plugins with per-plugin tool counts; registry itself comes from
        // createRegistry({ cfg, approve }) at startup (same source /tools uses).
        try {
          const plugins = listPlugins();
          let total = 0;
          for (const p of plugins) {
            const n = (getPlugin(p.name)?.tools ?? []).length;
            total += n;
            console.log(`${p.name} — ${p.description} ${dim(`(${n} tools)`)}`);
          }
          console.log(dim(`Total: ${plugins.length} plugins, ${total} tools`));
        } catch (e) {
          console.log(red(`Error: ${e.message}`));
        }
      } else if (input.startsWith('/sessions')) {
        const parts = input.split(/\s+/);
        const arg = parts[1];
        const files = listSessionFiles();
        if (!files.length) {
          console.log(dim('No saved sessions.'));
        } else if (arg === 'del' && /^\d+$/.test(parts[2] ?? '')) {
          const f = files[Number(parts[2]) - 1];
          if (!f) console.log(red('Invalid session number.'));
          else {
            const wasCurrent = f.path === sessionFile;
            try {
              // Synchronous unlink: an await here would suspend the command and let a
              // following piped line (or EOF → exit) run first, silently dropping it.
              unlinkSync(f.path);
            } catch {}
            if (wasCurrent) {
              latestResearch = null;
              messages.length = 0;
              messages.push({ role: 'system', content: buildSystemPrompt(cfg) });
              sessionFile = null;
              sessionTitle = 'default'; // don't carry the deleted title into the fresh default session
            }
            console.log(dim(`Session deleted: ${f.title}${wasCurrent ? ' (it was the current session; started fresh)' : ''}`));
          }
        } else if (arg === 'ren' && /^\d+$/.test(parts[2] ?? '')) {
          const f = files[Number(parts[2]) - 1];
          const newTitle = parts.slice(3).join(' ').trim();
          if (!f) console.log(red('Invalid session number.'));
          else if (!newTitle) console.log(red('Usage: /sessions ren <no> <new title>'));
          else {
            const d = JSON.parse(readFileSync(f.path, 'utf8'));
            d.title = newTitle;
            writeFileSync(f.path, JSON.stringify(d));
            if (f.path === sessionFile) sessionTitle = newTitle;
            console.log(dim(`Renamed: ${newTitle}`));
          }
        } else if (arg && /^\d+$/.test(arg)) {
          const f = files[Number(arg) - 1];
          if (!f) {
            console.log(red('Invalid session number.'));
          } else {
            const d = JSON.parse(readFileSync(f.path, 'utf8'));
            sessionFile = f.path;
            sessionTitle = d.title ?? 'default';
            latestResearch = null;
            messages.length = 0;
            messages.push(...(Array.isArray(d.messages) ? d.messages : []));
            loadedMsgs = messages.length;
            saveHistory();
            console.log(dim(`Switched to session: ${sessionTitle} (${messages.length - 1} messages)`));
          }
        } else {
          console.log(bold('Sessions — /sessions <no> (switch) · /sessions del <no> (delete) · /sessions ren <no> <title>'));
          files.forEach((f, i) => {
            const count = Array.isArray(f.messages) ? Math.max(0, f.messages.length - 1) : 0;
            console.log(`  ${i + 1}. ${f.title} ${dim(`${count} messages · ${f.date}`)}${f.path === sessionFile ? cyan(' ← current') : ''}`);
          });
        }
      } else if (input === '/skills') {
        if (busy) {
          console.log(dim('(previous task running; please wait)'));
        } else {
          busy = true;
          try {
            const sources = cfg.skills?.sources ?? [];
            if (!sources.length) {
              console.log(dim('No skills loaded — add one with /skills add github:user/repo[/sub/path]'));
            } else {
              console.log(dim('Loading skills…'));
              for (const source of sources) {
                try {
                  const sk = await fetchSkill(source);
                  console.log(`${cyan(sk.name)} ${dim(`(${source})`)}\n  ${trunc(sk.description || sk.body, 160)}`);
                } catch (e) {
                  console.log(red(`✕ ${source}: ${trunc(e.message, 140)}`));
                }
              }
            }
          } finally {
            busy = false;
          }
        }
      } else if (input === '/skills add') {
        console.log(red('Usage: /skills add github:user/repo[/sub/path]'));
      } else if (input.startsWith('/skills add ')) {
        // Same busy guard as /skills and /test: adding fetches over the network, so an
        // early /exit (or EOF) must wait for the result instead of silently dropping it.
        const source = input.slice('/skills add '.length).trim();
        if (!source) {
          console.log(red('Usage: /skills add github:user/repo[/sub/path]'));
        } else if (busy) {
          console.log(dim('(previous task running; please wait)'));
        } else {
          busy = true;
          // fetchSkill takes no signal (it sets its own 20 s fetch timeout), so race it
          // against a hard 20 s timer to guarantee this command always terminates.
          let timer;
          try {
            console.log(dim(`Adding skill ${source}…`));
            const sk = await Promise.race([
              fetchSkill(source),
              new Promise((_, reject) => {
                timer = setTimeout(() => reject(new Error('timed out after 20 s — the skill source did not answer')), 20_000);
              }),
            ]);
            cfg.skills = cfg.skills ?? { sources: [] };
            if (!cfg.skills.sources.includes(source)) cfg.skills.sources.push(source);
            const cfile = path.join(cfg.agent.workspaceRoot, 'sci-agent.config.json');
            let cur = {};
            try {
              cur = JSON.parse(readFileSync(cfile, 'utf8'));
            } catch {}
            cur.skills = { sources: cfg.skills.sources };
            writeFileSync(cfile, JSON.stringify(cur, null, 2));
            console.log(`${cyan('✓ Skill added')}: ${sk.name} ${dim(`(${source})`)}`);
          } catch (e) {
            console.log(red(`✕ ${source}: ${trunc(e.message, 140)}`));
          } finally {
            clearTimeout(timer);
            busy = false;
          }
        }
      } else if (input === '/save') {
        const lines = ['# SciAgent Chat', '', new Date().toLocaleString('tr-TR'), ''];
        for (const m of messages) {
          if (m.role === 'user') lines.push(`## User\n\n${m.content}\n`);
          else if (m.role === 'assistant') {
            if (m.tool_calls?.length) {
              for (const tc of m.tool_calls) lines.push(`**→ tool:** ${tc.function?.name} \`${tc.function?.arguments}\`\n`);
            }
            if (m.content) lines.push(`**SciAgent**\n\n${m.content}\n`);
          } else if (m.role === 'tool') {
            lines.push(`> result: ${String(m.content).slice(0, 400)}\n`);
          }
        }
        const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
        const out = path.join(cfg.agent.workspaceRoot, `sciagent-sohbet-${stamp}.md`);
        writeFileSync(out, lines.join('\n'));
        console.log(dim(`Saved: ${out}`));
      } else if (input === '/test') {
        // Same busy guard as /skills: /test calls the model, so it must not run while
        // a task is streaming, and an early /exit (or EOF) must wait for its result.
        if (busy) {
          console.log(dim('(previous task running; please wait)'));
        } else {
          busy = true;
          const t0 = Date.now();
          const signal = AbortSignal.timeout(15_000);
          try {
            console.log(dim('Testing model connection…'));
            const provider = createProvider(cfg.model);
            const out = await provider.chat({ messages: [{ role: 'user', content: 'Reply with only "ok".' }], signal });
            console.log(`${cyan('✓ connection ok')} (${Date.now() - t0} ms) — sample response: ${trunc(out.content, 40)}`);
          } catch (e) {
            console.log(
              red(
                signal.aborted || e?.name === 'AbortError' || e?.name === 'TimeoutError'
                  ? `✕ failed (${Date.now() - t0} ms): timed out after 15 s — the model server did not answer`
                  : `✕ failed (${Date.now() - t0} ms): ${trunc(e?.message, 200)}`,
              ),
            );
          } finally {
            busy = false;
          }
        }
      } else if (input === '/clear') {
        latestResearch = null;
        messages.splice(1);
        saveHistory();
        console.log(dim('Chat cleared (history file was also reset).'));
      } else {
        // busy locks only tasks that call the model; menu commands always run.
        if (busy) {
          console.log(dim('(previous task running; please wait)'));
        } else {
          busy = true;
          try {
            await handle(input);
          } finally {
            busy = false;
          }
        }
      }
    } catch (e) {
      console.log(red(`Error: ${e.message}`));
    } finally {
      if (input !== '/exit' && !rl.closed) rl.prompt();
    }
  });
  rl.on('close', () => {
    // Don't exit immediately while something is running (e.g. a /skills network request); wait for it to finish
    const wait = () => {
      if (busy) {
        setTimeout(wait, 200);
        return;
      }
      console.log(dim('Bye.'));
      process.exit(0);
    };
    wait();
  });
}
