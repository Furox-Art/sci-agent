import readline from 'node:readline';
import path from 'node:path';
import { readFileSync, writeFileSync } from 'node:fs';
import { loadConfig, createProvider, createRegistry, runAgentLoop, buildSystemPrompt } from '@sci/core';
import { buildSteering } from '../../core/src/eq/eq-layer.js';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const trunc = (s, n = 400) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

const HELP = [
  'Komutlar:',
  '  /help   yardım          /model  model bilgisi',
  '  /tools  araç listesi    /clear  sohbeti temizle',
  '  /exit   çıkış',
].join('\n');

export async function startRepl(argv = []) {
  const wi = argv.indexOf('--workspace');
  const workspace = wi !== -1 && argv[wi + 1] ? path.resolve(argv[wi + 1]) : process.cwd();
  process.chdir(workspace);

  const cfg = loadConfig(workspace);
  const messages = [{ role: 'system', content: buildSystemPrompt(cfg) }];

  // Paylaşılan sohbet geçmişi (masaüstü uygulamasıyla aynı dosya)
  const historyFile = path.join(cfg.agent.workspaceRoot, '.sci-agent-history.json');
  let loadedMsgs = 0;
  try {
    const saved = JSON.parse(readFileSync(historyFile, 'utf8'));
    if (Array.isArray(saved) && saved.length) {
      messages.length = 0;
      messages.push(...saved);
      loadedMsgs = saved.length;
    }
  } catch {}
  const saveHistory = () => {
    try {
      writeFileSync(historyFile, JSON.stringify(messages));
    } catch {}
  };

  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = (q) => new Promise((resolve) => rl.question(q, resolve));

  // Onay istemleri sıraya alınır; paralel alt-ajanlar bile soruları üst üste binmeden sorar.
  let approvalQueue = Promise.resolve();
  const approveSerial = (name, args) => {
    const run = approvalQueue.then(async () => {
      const a = await ask(`\n${bold('[Onay]')} ${name} ${trunc(JSON.stringify(args), 200)} (e/h) `);
      return /^e(vet)?$/i.test(a.trim());
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
  const printEvent = (ev) => {
    if (ev.type === 'reasoning') {
      flushLine();
      console.log(dim(`🧠 ${trunc(ev.text, 600)}`));
    } else if (ev.type === 'reasoning_delta') {
      process.stdout.write(dim(ev.text));
      pendingNewline = true;
    } else if (ev.type === 'text_delta') {
      process.stdout.write(ev.text);
      pendingNewline = true;
    } else if (ev.type === 'text') {
      flushLine();
      console.log(ev.text);
    } else if (ev.type === 'info') {
      flushLine();
      console.log(dim(ev.text));
    } else if (ev.type === 'tool_call') {
      flushLine();
      console.log(cyan(`\n→ ${ev.name} ${trunc(JSON.stringify(ev.args), 300)}`));
    } else if (ev.type === 'tool_result') {
      flushLine();
      console.log(ev.ok ? dim(`← ${trunc(ev.output, 500)}`) : red(`← ${trunc(ev.output, 500)}`));
    } else if (ev.type === 'error') {
      flushLine();
      console.log(red(`Hata: ${ev.text}`));
    } else if (ev.type === 'task_start') {
      flushLine();
      console.log(dim(`▶ Alt ajan başladı: ${trunc(ev.prompt, 120)}`));
    } else if (ev.type === 'task_end') {
      flushLine();
      console.log(dim(`■ Alt ajan bitti: ${trunc(ev.prompt, 80)}`));
    } else if (ev.type === 'sub_event') {
      flushLine();
      const e = ev.ev ?? {};
      const what =
        e.type === 'tool_call'
          ? `araç → ${e.name}`
          : e.type === 'text'
            ? trunc(e.text, 150)
            : e.type === 'error'
              ? `hata: ${trunc(e.text, 100)}`
              : e.type;
      console.log(dim(`  ↳ ${trunc(ev.prompt, 40)} · ${what}`));
    }
  };

  async function handle(input) {
    messages.push({ role: 'user', content: input });
    try {
      // eq-layer yönlendirmesi: model çağrısından önce çalışır; hata olursa sessizce atlanır.
      let systemExtra;
      try {
        const steer = await buildSteering({ messages: messages.slice(-6), workspaceRoot: cfg.agent.workspaceRoot });
        if (steer?.steering) {
          systemExtra = steer.steering;
          console.log(dim(`eq-layer: yönlendirme uygulandı (${steer.source})`));
        }
      } catch {}
      const provider = createProvider(cfg.model);
      await runAgentLoop({ provider, registry, messages, maxSteps: cfg.agent.maxSteps, onEvent: printEvent, systemExtra });
    } catch (e) {
      console.log(red(`Hata: ${e.message}`));
    }
    saveHistory();
  }

  console.log(bold('SciAgent v0.1 — bilimsel kodlama ajanı'));
  console.log(`Model: ${cfg.model.provider} @ ${cfg.model.baseUrl} (${cfg.model.name})`);
  console.log(`Çalışma alanı: ${cfg.agent.workspaceRoot} | Araçlar: ${registry.tools.length}`);
  console.log(dim(HELP));
  if (loadedMsgs) console.log(dim(`Önceki oturum yüklendi (${loadedMsgs - 1} mesaj) — /clear ile temizleyebilirsin.`));

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
      console.log(dim('(önceki görev sürüyor; bekleyin)'));
      return;
    }
    busy = true;
    try {
      if (input === '/exit') {
        rl.close();
        return;
      }
      if (input === '/help') console.log(HELP);
      else if (input === '/model') {
        console.log(JSON.stringify({ ...cfg.model, apiKey: cfg.model.apiKey ? '(atanmış)' : '' }, null, 2));
      } else if (input === '/tools') {
        console.log(registry.list().map((t) => `${t.name}${t.needsApproval ? ' (onay ister)' : ''} — ${t.description}`).join('\n'));
      } else if (input === '/clear') {
        messages.splice(1);
        saveHistory();
        console.log(dim('Sohbet temizlendi (kayıt dosyası da sıfırlandı).'));
      } else {
        await handle(input);
      }
    } finally {
      busy = false;
      if (input !== '/exit') rl.prompt();
    }
  });
  rl.on('close', () => {
    console.log(dim('Görüşürüz.'));
    process.exit(0);
  });
}
