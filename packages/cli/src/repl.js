import readline from 'node:readline';
import path from 'node:path';
import { readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { loadConfig, createProvider, createRegistry, runAgentLoop, buildSystemPrompt } from '@sci/core';
import { buildSteering } from '../../core/src/eq/eq-layer.js';

const dim = (s) => `\x1b[2m${s}\x1b[0m`;
const cyan = (s) => `\x1b[36m${s}\x1b[0m`;
const red = (s) => `\x1b[31m${s}\x1b[0m`;
const bold = (s) => `\x1b[1m${s}\x1b[0m`;
const trunc = (s, n = 400) => (String(s).length > n ? `${String(s).slice(0, n)}…` : String(s));

const HELP = [
  'Komutlar:',
  '  /help     yardım            /model  model bilgisi',
  '  /tools    araç listesi      /clear  sohbeti temizle',
  '  /sessions [no|del no|ren no başlık]  oturum listesi / geçiş / sil / yeniden adlandır',
  '  /save     sohbeti .md olarak kaydet',
  '  /test     model bağlantısını test et',
  '  /exit     çıkış',
].join('\n');

export async function startRepl(argv = []) {
  const wi = argv.indexOf('--workspace');
  const workspace = wi !== -1 && argv[wi + 1] ? path.resolve(argv[wi + 1]) : process.cwd();
  process.chdir(workspace);

  const cfg = loadConfig(workspace);
  const messages = [{ role: 'system', content: buildSystemPrompt(cfg) }];

  // Paylaşılan oturum geçmişi (masaüstüyle aynı depo): en güncel oturum dosyası
  const sessionsDir = path.join(cfg.agent.workspaceRoot, '.sci-agent-sessions');
  let sessionFile = null;
  let sessionTitle = 'varsayılan';
  let loadedMsgs = 0;
  try {
    const sorted = readdirSync(sessionsDir)
      .filter((f) => f.endsWith('.json'))
      .map((f) => {
        try {
          const d = JSON.parse(readFileSync(path.join(sessionsDir, f), 'utf8'));
          return { f, updatedAt: String(d.updatedAt ?? ''), title: String(d.title ?? 'varsayılan'), messages: d.messages };
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
  // Terminal için hafif markdown: kod blokları cyan, başlık/kalın bold, `kod` cyan
  const mdTerm = (s) =>
    String(s)
      .replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => `\n${dim(`── ${lang || 'kod'} ──────────`)}\n${cyan(code.trimEnd())}\n${dim('──────────────')}`)
      .replace(/`([^`\n]+)`/g, cyan('$1'))
      .replace(/\*\*([^*\n]+)\*\*/g, bold('$1'))
      .replace(/^### (.*)$/gm, (m1, h) => bold(h))
      .replace(/^## (.*)$/gm, (m1, h) => bold(h));

  // Akış sırasında satır satır markdown cilası: kod blokları cyan, başlık/kalın bold
  let mdLineBuf = '';
  let mdInCode = false;
  const styleLine = (line) => {
    if (/^\s*```/.test(line)) {
      mdInCode = !mdInCode;
      return dim(`── ${line.trim().replace(/^```/, '') || 'kod'} ──`);
    }
    if (mdInCode) return cyan(line);
    let s = line;
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
      console.log(ev.ok ? dim(`← ${trunc(ev.output, 500)}`) : red(`← ${trunc(ev.output, 500)}`));
    } else if (ev.type === 'error') {
      flushLine();
      console.log(red(`Hata: ${ev.text}`));
    } else if (ev.type === 'step') {
      flushLine();
      console.log(dim(`— adım ${ev.step}/${ev.maxSteps} —`));
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
    console.log(dim(`[${new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' })}]`));
    mdLineBuf = '';
    mdInCode = false;
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
    flushStreamText();
    saveHistory();
    console.log();
  }

  console.log(bold('SciAgent v0.7 — bilimsel kodlama ajanı'));
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
    try {
      if (input === '/exit') {
        rl.close();
        return;
      }
      if (input === '/help') console.log(HELP);
      else if (input === '/model') {
        console.log(JSON.stringify({ ...cfg.model, apiKey: cfg.model.apiKey ? '(atanmış)' : '' }, null, 2));
      } else if (input === '/tools') {
        console.log(
          registry
            .list()
            .map((t) => `${t.name === 'task' ? cyan(t.name) : t.name}${t.needsApproval ? dim(' (onay ister)') : ''} — ${t.description}`)
            .join('\n'),
        );
      } else if (input.startsWith('/sessions')) {
        const parts = input.split(/\s+/);
        const arg = parts[1];
        const files = listSessionFiles();
        if (!files.length) {
          console.log(dim('Kayıtlı oturum yok.'));
        } else if (arg === 'del' && /^\d+$/.test(parts[2] ?? '')) {
          const f = files[Number(parts[2]) - 1];
          if (!f) console.log(red('Geçersiz oturum numarası.'));
          else {
            const wasCurrent = f.path === sessionFile;
            try {
              const fsmod = await import('node:fs');
              fsmod.unlinkSync(f.path);
            } catch {}
            if (wasCurrent) {
              messages.length = 0;
              messages.push({ role: 'system', content: buildSystemPrompt(cfg) });
              sessionFile = null;
            }
            console.log(dim(`Oturum silindi: ${f.title}${wasCurrent ? ' (güncel oturumdun; temiz başlandı)' : ''}`));
          }
        } else if (arg === 'ren' && /^\d+$/.test(parts[2] ?? '')) {
          const f = files[Number(parts[2]) - 1];
          const newTitle = parts.slice(3).join(' ').trim();
          if (!f) console.log(red('Geçersiz oturum numarası.'));
          else if (!newTitle) console.log(red('Kullanım: /sessions ren <no> <yeni başlık>'));
          else {
            const d = JSON.parse(readFileSync(f.path, 'utf8'));
            d.title = newTitle;
            writeFileSync(f.path, JSON.stringify(d));
            if (f.path === sessionFile) sessionTitle = newTitle;
            console.log(dim(`Yeniden adlandırıldı: ${newTitle}`));
          }
        } else if (arg && /^\d+$/.test(arg)) {
          const f = files[Number(arg) - 1];
          if (!f) {
            console.log(red('Geçersiz oturum numarası.'));
          } else {
            const d = JSON.parse(readFileSync(f.path, 'utf8'));
            sessionFile = f.path;
            sessionTitle = d.title ?? 'varsayılan';
            messages.length = 0;
            messages.push(...(Array.isArray(d.messages) ? d.messages : []));
            loadedMsgs = messages.length;
            saveHistory();
            console.log(dim(`Oturuma geçildi: ${sessionTitle} (${messages.length - 1} mesaj)`));
          }
        } else {
          console.log(bold('Oturumlar — /sessions <no> (geç) · /sessions del <no> (sil) · /sessions ren <no> <başlık>'));
          files.forEach((f, i) => console.log(`  ${i + 1}. ${f.title} ${dim(f.date)}${f.path === sessionFile ? cyan(' ← güncel') : ''}`));
        }
      } else if (input === '/save') {
        const lines = ['# SciAgent Sohbeti', '', new Date().toLocaleString('tr-TR'), ''];
        for (const m of messages) {
          if (m.role === 'user') lines.push(`## Kullanıcı\n\n${m.content}\n`);
          else if (m.role === 'assistant') {
            if (m.tool_calls?.length) {
              for (const tc of m.tool_calls) lines.push(`**→ araç:** ${tc.function?.name} \`${tc.function?.arguments}\`\n`);
            }
            if (m.content) lines.push(`**SciAgent**\n\n${m.content}\n`);
          } else if (m.role === 'tool') {
            lines.push(`> sonuç: ${String(m.content).slice(0, 400)}\n`);
          }
        }
        const out = path.join(cfg.agent.workspaceRoot, 'sciagent-sohbet.md');
        writeFileSync(out, lines.join('\n'));
        console.log(dim(`Kaydedildi: ${out}`));
      } else if (input === '/test') {
        const t0 = Date.now();
        console.log(dim('Model bağlantısı test ediliyor…'));
        try {
          const provider = createProvider(cfg.model);
          const out = await provider.chat({ messages: [{ role: 'user', content: 'Yalnızca "ok" yaz.' }] });
          console.log(`${cyan('✓ bağlantı başarılı')} (${Date.now() - t0} ms) — yanıt örneği: ${trunc(out.content, 40)}`);
        } catch (e) {
          console.log(red(`✕ başarısız (${Date.now() - t0} ms): ${trunc(e.message, 200)}`));
        }
      } else if (input === '/clear') {
        messages.splice(1);
        saveHistory();
        console.log(dim('Sohbet temizlendi (kayıt dosyası da sıfırlandı).'));
      } else {
        // busy yalnızca model çağrısı içeren görevleri kilitler; menü komutları her zaman çalışır.
        if (busy) {
          console.log(dim('(önceki görev sürüyor; bekleyin)'));
        } else {
          busy = true;
          try {
            await handle(input);
          } finally {
            busy = false;
          }
        }
      }
    } finally {
      if (input !== '/exit') rl.prompt();
    }
  });
  rl.on('close', () => {
    console.log(dim('Görüşürüz.'));
    process.exit(0);
  });
}
