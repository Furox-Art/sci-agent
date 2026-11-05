const $ = (s) => document.querySelector(s);
const chatEl = $('#chat');
let busy = false;
let lastTool = null;
const toolBlocks = new Map(); // tool call id → <details> (correct pairing under parallel execution)
const approvalCards = new Map(); // approval id → card (for the timeout notification)
let agentRuns = []; // sub-agent tasks in this session
let agentsInfoLoaded = false;
let lastUserText = '';

// Smart scrolling: don't force-scroll down while the user is looking up
const nearBottom = () => chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 140;

// Timestamp chip on bubbles
const nowTime = () => new Date().toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
const stampChip = () => {
  const s = document.createElement('span');
  s.className = 'time';
  s.textContent = nowTime();
  return s;
};

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function bubble(cls) {
  const d = document.createElement('div');
  d.className = `msg ${cls}`;
  d.appendChild(stampChip());
  chatEl.appendChild(d);
  if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
  return d;
}

function addText(target, text) {
  const span = document.createElement('span');
  span.className = 'txt';
  span.textContent = text;
  target.appendChild(span);
  target.appendChild(document.createTextNode('\n'));
  if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
}

function toolBlock(id, name, args) {
  const det = document.createElement('details');
  det.className = 'tool';
  if (name === 'task') det.classList.add('ai'); // agent tools in turquoise
  det.open = true;
  const sum = document.createElement('summary');
  sum.textContent = `→ ${name}`;
  det.appendChild(sum);
  const pre = document.createElement('pre');
  pre.textContent = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
  det.appendChild(pre);
  chatEl.appendChild(det);
  if (id) toolBlocks.set(id, det);
  lastTool = det;
  if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
  return det;
}

function toolResult(id, ok, output) {
  const det = (id && toolBlocks.get(id)) || lastTool;
  if (!det) return;
  const pre = document.createElement('pre');
  pre.className = ok ? 'out' : 'err';
  pre.textContent = output;
  det.appendChild(pre);
  const cb = document.createElement('button');
  cb.className = 't-copy';
  cb.textContent = 'copy';
  cb.onclick = () => {
    navigator.clipboard.writeText(output).then(() => {
      cb.textContent = 'copied';
      setTimeout(() => (cb.textContent = 'copy'), 1200);
    });
  };
  det.appendChild(cb);
  if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
}

function subNote(text) {
  const d = document.createElement('div');
  d.className = 'reasoning';
  d.textContent = text;
  chatEl.appendChild(d);
  if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
}

function approvalCard({ id, name, args }) {
  const card = document.createElement('div');
  card.className = 'approval';
  const p = document.createElement('div');
  p.innerHTML = '<b>Awaiting approval:</b> ';
  p.append(name);
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(args, null, 2);
  const row = document.createElement('div');
  row.className = 'row';
  const yes = document.createElement('button');
  yes.textContent = 'Approve';
  yes.className = 'turquoise';
  const no = document.createElement('button');
  no.textContent = 'Deny';
  no.className = 'ghost';
  row.append(yes, no);
  const remember = document.createElement('label');
  remember.className = 'remember';
  const rbox = document.createElement('input');
  rbox.type = 'checkbox';
  remember.append(rbox, document.createTextNode('Allow this tool for this session'));
  // 5-minute approval window countdown
  let left = 300;
  const count = document.createElement('span');
  count.className = 'a-count';
  const tick = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      count.textContent = 'timed out';
      clearInterval(tick);
      return;
    }
    count.textContent = `${Math.floor(left / 60)}:${String(left % 60).padStart(2, '0')}`;
  }, 1000);
  tick.unref?.();
  count.textContent = '5:00';
  card.append(p, pre, row, remember, count);
  chatEl.appendChild(card);
  approvalCards.set(id, { card, yes, no, tick });
  if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
  const decide = async (approved) => {
    yes.disabled = true;
    no.disabled = true;
    rbox.disabled = true;
    count.textContent = 'decided';
    clearInterval(tick);
    card.classList.add(approved ? 'ok' : 'no');
    try {
      await api('/api/approve', {
        method: 'POST',
        body: JSON.stringify({ id, approved, remember: rbox.checked, tool: name }),
      });
    } catch (e) {
      console.error(e);
    }
  };
  yes.onclick = () => decide(true);
  no.onclick = () => decide(false);
}

function setStatus(t) {
  const s = $('#status');
  if (!t) {
    s.classList.add('hidden');
    return;
  }
  s.textContent = t;
  s.classList.remove('hidden');
}

let streamTarget = null;
let streamText = '';
let reasoningEl = null;

function resetStream() {
  streamTarget = null;
  streamText = '';
  reasoningEl = null;
}

function handleEvent(ev) {
  if (ev.type === 'text_delta') {
    if (!streamTarget) {
      streamTarget = bubble('assistant');
      streamText = '';
    }
    streamText += ev.text;
    streamTarget.textContent = streamText;
    if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'reasoning_delta') {
    if (!reasoningEl) {
      reasoningEl = document.createElement('div');
      reasoningEl.className = 'reasoning';
      chatEl.appendChild(reasoningEl);
    }
    reasoningEl._text = (reasoningEl._text || '') + ev.text;
    reasoningEl.textContent = `🧠 ${reasoningEl._text}`;
    if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'reasoning') {
    const d = document.createElement('div');
    d.className = 'reasoning';
    d.textContent = `🧠 ${ev.text}`;
    chatEl.appendChild(d);
    if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'text') {
    renderMd(bubble('assistant'), ev.text);
  } else if (ev.type === 'info') {
    const d = document.createElement('div');
    d.className = 'reasoning';
    d.textContent = `ℹ ${ev.text}`;
    chatEl.appendChild(d);
    if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'tool_call') {
    resetStream();
    toolBlock(ev.id, ev.name, ev.args);
  } else if (ev.type === 'tool_result') {
    toolResult(ev.id, ev.ok, ev.output);
  } else if (ev.type === 'task_start') {
    agentRuns.push({ prompt: ev.prompt, status: 'running', summary: '' });
    subNote(`▶ Sub-agent started: ${ev.prompt}`);
    renderAgents();
  } else if (ev.type === 'task_end') {
    const run = [...agentRuns].reverse().find((r) => r.prompt === ev.prompt && r.status === 'running');
    if (run) run.status = ev.done === false ? 'failed' : 'done';
    subNote(`■ Sub-agent finished: ${ev.prompt}`);
    renderAgents();
  } else if (ev.type === 'sub_event') {
    const e = ev.ev ?? {};
    const what =
      e.type === 'tool_call'
        ? `tool → ${e.name}`
        : e.type === 'text'
          ? e.text
          : e.type === 'error'
            ? `error: ${e.text}`
            : e.type;
    if (e.type === 'text') {
      const run = [...agentRuns].reverse().find((r) => r.prompt === ev.prompt);
      if (run) run.summary = e.text;
      renderAgents();
    }
    subNote(`  ↳ ${ev.prompt} · ${what}`);
  } else if (ev.type === 'step') {
    setStatus(`Agent running… step ${ev.step}/${ev.maxSteps}`);
  } else if (ev.type === 'approval_request') {
    resetStream();
    approvalCard(ev);
  } else if (ev.type === 'approval_result') {
    // Server-side result (e.g. 5-minute timeout) — close the card if it is still pending.
    const c = approvalCards.get(ev.id);
    if (c) {
      clearInterval(c.tick);
      if (!c.yes.disabled) {
        c.yes.disabled = true;
        c.no.disabled = true;
        c.card.classList.add(ev.approved ? 'ok' : 'no');
        if (ev.timeout) {
          const note = document.createElement('div');
          note.className = 'a-state';
          note.style.color = 'var(--err)';
          note.textContent = '⏱ Not approved within 5 minutes — denied automatically.';
          c.card.appendChild(note);
        }
      }
      approvalCards.delete(ev.id);
    }
  } else if (ev.type === 'error') {
    resetStream();
    const b = bubble('assistant');
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|Model sunucusu \d{3}/i.test(ev.text)) {
      // Could not reach the model: friendly card + Settings shortcut
      const t = document.createElement('div');
      t.className = 'm-title';
      t.textContent = 'Could not reach the model';
      const d = document.createElement('div');
      d.style.color = 'var(--dim)';
      d.textContent = ev.text;
      const hint = document.createElement('div');
      hint.style.color = 'var(--dim)';
      hint.style.margin = '6px 0';
      hint.textContent = 'Check the API URL and model name in Settings (e.g. Ollama: http://localhost:11434/v1).';
      const btn = document.createElement('button');
      btn.className = 'turquoise';
      btn.textContent = 'Open Settings';
      btn.onclick = () => $('#settings').classList.remove('hidden');
      const retry = document.createElement('button');
      retry.className = 'ghost';
      retry.textContent = 'Retry';
      retry.style.marginLeft = '8px';
      retry.onclick = () => {
        const lastUser = [...chatEl.querySelectorAll('.msg.user .txt')].at(-1)?.textContent ?? lastUserText;
        $('#input').value = lastUser ?? '';
        send();
      };
      const row = document.createElement('div');
      row.style.marginTop = '10px';
      row.style.display = 'flex';
      row.append(btn, retry);
      b.append(t, d, hint, row);
    } else {
      addText(b, `⚠ ${ev.text}`);
    }
  } else if (ev.type === 'done') {
    // Stream ended: re-render the accumulated text as markdown (code blocks etc.)
    if (streamTarget && streamText) {
      renderMd(streamTarget, streamText);
      streamTarget.appendChild(copyChip(() => streamText));
    }
    resetStream();
  }
}

async function send() {
  if (busy) return;
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  lastUserText = text;
  $('#empty')?.remove();
  input.value = '';
  busy = true;
  const sendBtn = $('#btn-send');
  sendBtn.disabled = false;
  sendBtn.textContent = 'Stop';
  sendBtn.classList.add('btn-stop');
  setStatus('Agent running…');
  addText(bubble('user'), text);
  lastTool = null;
  toolBlocks.clear();
  resetStream();
  try {
    const r = await fetch('/api/chat', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ message: text }),
    });
    if (!r.ok || !r.body) {
      const e = await r.json().catch(() => ({}));
      throw new Error(e.error || `HTTP ${r.status}`);
    }
    const reader = r.body.getReader();
    const dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      const parts = buf.split('\n\n');
      buf = parts.pop();
      for (const part of parts) {
        const line = part.split('\n').find((l) => l.startsWith('data: '));
        if (!line) continue;
        handleEvent(JSON.parse(line.slice(6)));
      }
    }
  } catch (e) {
    addText(bubble('assistant'), `⚠ Error: ${e.message}`);
  } finally {
    busy = false;
    sendBtn.disabled = false;
    sendBtn.textContent = 'Send';
    sendBtn.classList.remove('btn-stop');
    setStatus('');
    inputEl.style.height = 'auto';
    loadSessions();
    input.focus();
  }
}

async function loadConfig() {
  const c = await api('/api/config');
  $('#model-badge').textContent = `${c.model.provider} · ${c.model.name}`;
  $('#s-provider').value = c.model.provider;
  $('#s-baseurl').value = c.model.baseUrl;
  $('#s-name').value = c.model.name;
  $('#s-key').value = '';
}

// Send / Stop: while the agent runs, the button acts as a stop button
$('#btn-send').onclick = async () => {
  if (busy) {
    try {
      await api('/api/stop', { method: 'POST' });
    } catch {}
    return;
  }
  send();
};
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$('#btn-clear').onclick = async () => {
  try {
    await api('/api/clear', { method: 'POST' });
    chatEl.innerHTML = '';
    lastTool = null;
    resetStream();
    renderEmpty();
  } catch (e) {
    setStatus('Agent running; cannot clear.');
    setTimeout(() => setStatus(''), 2500);
  }
};
$('#btn-settings').onclick = () => $('#settings').classList.remove('hidden');
// Close the Settings window with Esc
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#settings').classList.add('hidden');
});
// Click the model badge to open Settings
$('#model-badge').style.cursor = 'pointer';
$('#model-badge').title = 'Open model settings';
$('#model-badge').onclick = () => $('#settings').classList.remove('hidden');

// Hide/show hero band (preference is remembered)
const heroEl = document.querySelector('.hero');
const applyHero = () => {
  const off = localStorage.getItem('sciagent-hero') === 'off';
  heroEl.classList.toggle('collapsed', off);
  $('#btn-hero').textContent = off ? '▾' : '▴';
};
$('#btn-hero').onclick = () => {
  localStorage.setItem('sciagent-hero', localStorage.getItem('sciagent-hero') === 'off' ? 'on' : 'off');
  applyHero();
};
applyHero();

// Tool search filter: terms separated by | are OR'd, space-separated words are AND'd
$('#tool-filter').addEventListener('input', () => {
  const q = $('#tool-filter').value.trim().toLowerCase();
  const terms = q.split('|').map((s) => s.trim()).filter(Boolean);
  const list = $('#tools-list');
  let lastHead = null;
  let visible = 0;
  [...list.children].forEach((el) => {
    if (el.tagName === 'H3') {
      if (lastHead) lastHead.style.display = visible ? '' : 'none';
      lastHead = el;
      visible = 0;
    } else {
      const text = el.textContent.toLowerCase();
      const show = !terms.length || terms.some((t) => t.split(/\s+/).every((w) => text.includes(w)));
      el.style.display = show ? '' : 'none';
      if (show) visible += 1;
    }
  });
  if (lastHead) lastHead.style.display = visible ? '' : 'none';
});

// Input grows with content (up to ~6 lines)
const inputEl = $('#input');
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 150)}px`;
});

// Export chat as Markdown
$('#btn-export').title = 'Download chat as .md file';
$('#btn-export').onclick = async () => {
  try {
    const h = await api('/api/history');
    const lines = ['# SciAgent Chat', '', new Date().toLocaleString('tr-TR'), ''];
    for (const m of h.messages) {
      if (m.role === 'user') lines.push(`## User\n\n${m.content}\n`);
      else if (m.role === 'assistant') {
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            lines.push(`**→ tool:** ${tc.function?.name} \`${tc.function?.arguments}\`\n`);
          }
        }
        if (m.content) lines.push(`**SciAgent**\n\n${m.content}\n`);
      } else if (m.role === 'tool') {
        lines.push(`> result: ${String(m.content).slice(0, 400)}\n`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    const stamp = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
    a.download = `sciagent-chat-${stamp}.md`;
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert('Failed to export: ' + e.message);
  }
};

// Model connection test
$('#s-test').onclick = async () => {
  const r = $('#s-test-result');
  r.classList.remove('hidden');
  r.textContent = 'testing…';
  try {
    const res = await api('/api/test-model', {
      method: 'POST',
      body: JSON.stringify({
        provider: $('#s-provider').value,
        baseUrl: $('#s-baseurl').value,
        name: $('#s-name').value,
        apiKey: $('#s-key').value,
      }),
    });
    r.textContent = res.ok ? `✓ connection ok (${res.ms} ms)` : `✕ failed: ${res.error}`;
  } catch (e) {
    r.textContent = '✕ ' + e.message;
  }
};
$('#s-cancel').onclick = () => $('#settings').classList.add('hidden');
$('#s-save').onclick = async () => {
  try {
    await api('/api/config', {
      method: 'POST',
      body: JSON.stringify({
        provider: $('#s-provider').value,
        baseUrl: $('#s-baseurl').value,
        name: $('#s-name').value,
        apiKey: $('#s-key').value,
      }),
    });
    $('#settings').classList.add('hidden');
    agentsInfoLoaded = false; // refresh the Agents card with the new model info
    await loadConfig();
  } catch (e) {
    alert('Failed to save: ' + e.message);
  }
};

// ===== Markdown (code blocks + copy) =====
function esc(s) {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
}

function mdToHtml(src) {
  const blocks = [];
  let t = esc(src);
  t = t.replace(/```(\w*)\n?([\s\S]*?)```/g, (m, lang, code) => {
    blocks.push({ lang, code });
    return `\u0000CODE${blocks.length - 1}\u0000`;
  });
  // GFM pipe tables → <table class="md-table">
  // Runs AFTER code-block placeholders (fences stay intact) and BEFORE inline code.
  {
    const cellify = (l) => {
      let s = l.trim();
      if (s.startsWith('|')) s = s.slice(1);
      if (s.endsWith('|') && !s.endsWith('\\|')) s = s.slice(0, -1);
      return s.split(/(?<!\\)\|/).map((c) => c.trim().replace(/\\\|/g, '|'));
    };
    const isRow = (l) => l.includes('|');
    const isSep = (l) => {
      const c = cellify(l);
      return c.length > 0 && c.every((x) => /^:?-+:?$/.test(x));
    };
    const lines = t.split('\n');
    const out = [];
    let i = 0;
    while (i < lines.length) {
      // Table start: a row line followed by a |---|---| separator line
      if (isRow(lines[i]) && i + 1 < lines.length && isSep(lines[i + 1])) {
        const th = cellify(lines[i]).map((c) => `<th>${c}</th>`).join('');
        let j = i + 2;
        const rows = [];
        while (j < lines.length && isRow(lines[j]) && !isSep(lines[j])) {
          rows.push(cellify(lines[j]));
          j += 1;
        }
        const tb = rows.map((r) => `<tr>${r.map((c) => `<td>${c}</td>`).join('')}</tr>`).join('');
        out.push(`<table class="md-table"><thead><tr>${th}</tr></thead><tbody>${tb}</tbody></table>`);
        if (j < lines.length && lines[j].trim() === '') j += 1; // swallow one blank line after the table
        i = j;
      } else {
        out.push(lines[i]);
        i += 1;
      }
    }
    t = out.join('\n');
  }
  // Turn URLs into clickable links (trailing punctuation stays outside the link)
  t = t.replace(/https?:\/\/[^\s<>"']+/g, (m0) => {
    let u = m0;
    const trail = u.match(/[)\].,;:!?'"]+$/);
    let tail = '';
    if (trail) {
      tail = trail[0];
      u = u.slice(0, u.length - tail.length);
    }
    return `<a href="${u}" target="_blank" rel="noopener noreferrer">${u}</a>${tail}`;
  });
  // GFM pipe tabloları: | a | b |\n|---|---|\n| 1 | 2 |  →  <table>
  t = t.replace(/(^\|.*\|\n)\|?[\s:|-]+\|?\n((?:^\|.*\|\n?)*)/gm, (m0, head, body) => {
    const cells = (row) => row.split('|').slice(1, -1).map((c) => c.trim());
    const ths = cells(head).map((h) => `<th>${h}</th>`).join('');
    const trs = body
      .split('\n')
      .filter((l) => l.trim().startsWith('|'))
      .map((l) => `<tr>${cells(l).map((c) => `<td>${c}</td>`).join('')}</tr>`)
      .join('');
    return `<div class="md-table"><table><thead><tr>${ths}</tr></thead><tbody>${trs}</tbody></table></div>`;
  });
  t = t.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  t = t.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  t = t.replace(/^- (.*)$/gm, '• $1');
  t = t.replace(/\n/g, '<br>');
  t = t.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => {
    const b = blocks[Number(i)];
    return `<div class="codebox"><div class="codebar"><span>${esc(b.lang || 'code')}</span><button class="copy">copy</button></div><pre><code>${b.code}</code></pre></div>`;
  });
  return t;
}

function copyChip(getText) {
  const b = document.createElement('button');
  b.className = 'msg-copy';
  b.textContent = 'copy';
  b.onclick = () => {
    navigator.clipboard.writeText(getText()).then(() => {
      b.textContent = 'copied';
      setTimeout(() => (b.textContent = 'copy'), 1200);
    });
  };
  return b;
}

function renderMd(el, text) {
  el.innerHTML = mdToHtml(text);
  el.appendChild(stampChip());
  el.appendChild(copyChip(() => text));
}

async function codeCopyClick(e) {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  const code = btn.closest('.codebox')?.querySelector('code');
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.textContent);
    btn.textContent = 'copied';
    setTimeout(() => (btn.textContent = 'copy'), 1500);
  } catch {}
}

chatEl.addEventListener('click', codeCopyClick);
// Code copy buttons inside skill markdown bodies (Agents view)
$('#skills-list').addEventListener('click', codeCopyClick);

// ===== Empty chat suggestions =====
function renderEmpty() {
  if (chatEl.querySelector('.msg, details.tool, #empty')) return;
  const d = document.createElement('div');
  d.id = 'empty';
  d.className = 'empty';
  const t = document.createElement('div');
  t.className = 'e-title';
  t.textContent = 'Type a task or pick a suggestion';
  const chips = document.createElement('div');
  chips.className = 'chips';
  const ideas = [
    'Analyze the CSV file under data/',
    'Search the literature for "protein folding"',
    "How many joules is 1 eV? Verify with physics constants",
    'Split the task across parallel sub-agents and prepare a report',
  ];
  for (const idea of ideas) {
    const c = document.createElement('button');
    c.className = 'chip';
    c.textContent = idea;
    c.onclick = () => {
      $('#empty')?.remove();
      const input = $('#input');
      input.value = idea;
      send();
    };
    chips.appendChild(c);
  }
  d.append(t, chips);
  chatEl.appendChild(d);
}

// ===== Agents view =====
async function renderAgents() {
  if (!agentsInfoLoaded) {
    try {
      const c = await api('/api/config');
      const info = $('#agents-info');
      info.innerHTML = '';
      const mk = (k, v, cls = '') => {
        const box = document.createElement('div');
        const l = document.createElement('div');
        l.className = 'k';
        l.textContent = k;
        const val = document.createElement('div');
        val.className = 'v ' + cls;
        val.textContent = v;
        box.append(l, val);
        return box;
      };
      info.append(
        mk('Model', `${c.model.provider} · ${c.model.name}`, 'blue'),
        mk('Workspace', c.workspaceRoot),
        mk('Tool count', String(c.tools.length), 'turquoise'),
        mk('Status', busy ? 'running a task' : 'idle', busy ? 'turquoise' : ''),
      );
      agentsInfoLoaded = true;
    } catch {}
  }
  const list = $('#agents-list');
  list.innerHTML = '';
  if (!agentRuns.length) {
    const d = document.createElement('div');
    d.className = 'agent-card';
    d.textContent = 'No sub-agent tasks started in this session. Ask for parallel tasks in the chat to use the task tool.';
    list.appendChild(d);
    return;
  }
  for (const r of [...agentRuns].reverse()) {
    const card = document.createElement('div');
    card.className = 'agent-card ' + (r.status === 'running' ? 'running' : r.status === 'failed' ? 'failed' : 'done');
    const head = document.createElement('div');
    head.className = 'a-head';
    const p = document.createElement('div');
    p.className = 'a-prompt';
    p.textContent = r.prompt;
    const st = document.createElement('div');
    st.className = 'a-state';
    st.textContent = r.status === 'running' ? '● running' : r.status === 'failed' ? '✕ failed' : '✓ done';
    head.append(p, st);
    card.appendChild(head);
    if (r.summary) {
      const s = document.createElement('div');
      s.className = 'a-summary';
      s.textContent = r.summary;
      card.appendChild(s);
    }
    list.appendChild(card);
  }
}

// ===== Chat history (restored from server persistence) =====
async function restoreHistory() {
  let h;
  try {
    h = await api('/api/history');
  } catch {
    return;
  }
  const msgs = Array.isArray(h.messages) ? h.messages : [];
  for (const m of msgs) {
    if (m.role === 'user') {
      addText(bubble('user'), m.content);
    } else if (m.role === 'assistant') {
      if (m.tool_calls?.length) {
        for (const tc of m.tool_calls) {
          toolBlock(tc.id, tc.function?.name ?? '?', safeParse(tc.function?.arguments));
          const det = toolBlocks.get(tc.id);
          if (det) det.open = false;
        }
        if (m.content) renderMd(bubble('assistant'), m.content);
      } else if (m.content) {
        renderMd(bubble('assistant'), m.content);
      }
    } else if (m.role === 'tool') {
      toolResult(m.tool_call_id, true, m.content);
    }
  }
  if (msgs.length) $('#empty')?.remove();
}

function safeParse(raw) {
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw ?? {};
  } catch {
    return { _raw: String(raw) };
  }
}

// ===== Charts view =====
const CHART_COLORS = ['#1677FF', '#00D5C8', '#66F0FF', '#F5FAFF', '#8FA3BD'];
let chartData = null;
let chartHidden = new Set(); // series hidden via the legend
let chartTableOn = false;

async function loadChart() {
  const p = $('#chart-path').value.trim();
  if (!p) return;
  const box = $('#chart-box');
  box.innerHTML = '<p class="lead">loading…</p>';
  try {
    chartData = await api('/api/csv?path=' + encodeURIComponent(p));
    chartHidden = new Set();
    renderChart();
    renderChartTable();
  } catch (e) {
    box.innerHTML = '';
    $('#table-box').innerHTML = '';
    const d = document.createElement('p');
    d.className = 'lead';
    d.textContent = 'Error: ' + e.message;
    box.appendChild(d);
  }
}

function renderChartTable() {
  const box = $('#table-box');
  if (!chartTableOn || !chartData?.sample) {
    box.innerHTML = '';
    return;
  }
  const { columns, rows } = chartData.sample;
  const head = columns.map((c) => `<th>${esc(c)}</th>`).join('');
  const body = rows.map((r) => `<tr>${columns.map((c) => `<td>${esc(r[c] ?? '')}</td>`).join('')}</tr>`).join('');
  box.innerHTML = `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${body}</tbody></table>`;
  box.scrollTop = 0;
}

function renderChartEmpty() {
  $('#chart-legend').innerHTML = '';
  $('#chart-box').innerHTML =
    '<div class="empty"><div class="e-title">No chart yet</div><div>Type a CSV path above or use the example button.</div></div>';
  $('#table-box').innerHTML = '';
}

function renderChart() {
  const data = chartData;
  if (!data) return;
  const box = $('#chart-box');
  const legend = $('#chart-legend');
  const all = Object.keys(data.numeric ?? {});
  const names = all.filter((k) => !chartHidden.has(k));

  // Legend: click to show/hide a series
  legend.innerHTML = '';
  all.forEach((k, si) => {
    const item = document.createElement('span');
    const sw = document.createElement('i');
    sw.style.background = CHART_COLORS[si % CHART_COLORS.length];
    item.append(sw, document.createTextNode(k));
    if (chartHidden.has(k)) item.classList.add('off');
    item.title = 'show/hide';
    item.onclick = () => {
      chartHidden.has(k) ? chartHidden.delete(k) : chartHidden.add(k);
      renderChart();
    };
    legend.appendChild(item);
  });
  const cnt = document.createElement('span');
  cnt.className = 'lg-count';
  cnt.textContent = `${all.length} series`;
  legend.appendChild(cnt);

  if (!names.length) {
    box.innerHTML = '<p class="lead">All series hidden — click the legend to show.</p>';
    return;
  }
  const norm = $('#chart-norm')?.checked ?? false;
  const cols = names.map((k) => data.numeric[k]);
  const n = Math.max(...cols.map((c) => c.length));
  const flatVals = cols.flat();
  const min = Math.min(...flatVals);
  const max = Math.max(...flatVals);
  const W = 880, H = 430, L = 64, R = 18, T = 18, B = 38;
  const xs = (i) => L + (W - L - R) * (n < 2 ? 0.5 : i / (n - 1));
  // norm: each series is scaled to its own min/max (comparable series of different magnitudes)
  const lo = (si) => (norm ? Math.min(...cols[si]) : min);
  const hi = (si) => (norm ? Math.max(...cols[si]) : max);
  const ys = (si, v) => T + (H - T - B) * (1 - (v - lo(si)) / (hi(si) - lo(si) || 1));

  let grid = '';
  for (let g = 0; g <= 4; g++) {
    const y = T + (H - T - B) * (g / 4);
    const val = norm ? 1 - g / 4 : max - (max - min) * (g / 4);
    grid += `<line x1="${L}" x2="${W - R}" y1="${y}" y2="${y}" stroke="rgba(143,163,189,0.18)"/>`;
    grid += `<text x="10" y="${y + 4}" fill="#8FA3BD" font-size="11">${norm ? val.toFixed(2) : Number(val.toPrecision(5))}</text>`;
  }
  let series = '';
  names.forEach((k, si) => {
    const color = CHART_COLORS[si % CHART_COLORS.length];
    const pts = cols[si].map((v, i) => `${xs(i).toFixed(1)},${ys(si, v).toFixed(1)}`).join(' ');
    series += `<polyline fill="none" stroke="${color}" stroke-width="2" stroke-linejoin="round" stroke-linecap="round" points="${pts}"/>`;
    // Single-point series would show no line → draw a dot marker
    if (cols[si].length === 1) {
      series += `<circle cx="${xs(0).toFixed(1)}" cy="${ys(si, cols[si][0]).toFixed(1)}" r="4" fill="${color}"/>`;
    }
    // Hover hints: sampled when there are more points than is reasonable
    const hintCount = cols[si].length;
    const hintStep = Math.max(1, Math.ceil(hintCount / 40));
    for (let i = 0; i < hintCount; i += hintStep) {
      const cx = xs(i).toFixed(1);
      const cy = ys(si, cols[si][i]).toFixed(1);
      series += `<circle cx="${cx}" cy="${cy}" r="9" fill="transparent" pointer-events="all"><title>${esc(k)}: ${cols[si][i]}</title></circle>`;
    }
  });
  // X-axis labels: use the first text column if present
  let ticks = '';
  if (data.labelName && Array.isArray(data.labels) && data.labels.length) {
    const step = Math.max(1, Math.ceil(data.labels.length / 10));
    data.labels.forEach((lb, i) => {
      if (i % step === 0 && i < n) {
        ticks += `<text x="${xs(i).toFixed(1)}" y="${H - B + 16}" fill="#8FA3BD" font-size="10" text-anchor="middle">${esc(String(lb)).slice(0, 12)}</text>`;
      }
    });
  }
  const yAxisNote = norm ? 'relative (0–1, per series)' : '';
  const xNote = data.labelName ? ` · x: ${esc(data.labelName)}` : ` · row (0–${n - 1})`;
  box.innerHTML = `<svg class="chartsvg" viewBox="0 0 ${W} ${H}" role="img">${grid}${ticks}${series}<text x="${W - R - 150}" y="${H - 12}" fill="#8FA3BD" font-size="11">${xNote}${yAxisNote ? ' · ' + yAxisNote : ''}</text></svg>`;
}

// Remember the last chart path
const chartPathInput = $('#chart-path');
chartPathInput.value = localStorage.getItem('sciagent-chart-path') ?? '';
const loadChartSaved = async () => {
  await loadChart();
  if (chartData) localStorage.setItem('sciagent-chart-path', chartPathInput.value);
};
$('#btn-chart').onclick = loadChartSaved;
$('#btn-table').onclick = () => {
  chartTableOn = !chartTableOn;
  renderChartTable();
};
$('#chart-example').onclick = () => {
  $('#chart-path').value = 'examples/veri.csv';
  loadChartSaved();
};
chartPathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadChartSaved();
});

// ===== Skills (GitHub SKILL.md) =====
async function loadAgentSkills() {
  const list = $('#skills-list');
  try {
    const s = await api('/api/agent-skills');
    const h = $('#skills-h');
    if (h) h.textContent = `Skills (GitHub SKILL.md) — ${s.loaded.length} loaded${s.errors.length ? `, ${s.errors.length} failed` : ''}`;
    list.innerHTML = '';
    for (const sk of s.loaded) {
      const d = document.createElement('div');
      d.className = 'skill-item';
      const n = document.createElement('div');
      const name = document.createElement('span');
      name.className = 't-name';
      name.textContent = sk.name;
      const del = document.createElement('button');
      del.className = 'ss-del skill-del';
      del.textContent = '×';
      del.title = 'Remove skill';
      del.onclick = async () => {
        await api('/api/agent-skills/remove', { method: 'POST', body: JSON.stringify({ source: sk.source }) }).catch(() => {});
        loadAgentSkills();
      };
      n.append(name, del);
      const desc = document.createElement('div');
      desc.className = 't-desc';
      desc.textContent = sk.description;
      const src = document.createElement('div');
      src.className = 't-desc';
      src.style.opacity = '0.7';
      src.textContent = sk.source;
      d.append(n, desc, src);
      if (typeof sk.body === 'string' && sk.body.length >= 80) {
        const det = document.createElement('details');
        det.className = 'skill-body';
        const sum = document.createElement('summary');
        sum.textContent = 'body';
        // SKILL.md bodies are markdown → render like chat messages (mdToHtml escapes first, XSS safe)
        const md = document.createElement('div');
        md.className = 'skill-md';
        md.innerHTML = mdToHtml(sk.body);
        det.append(sum, md);
        d.append(det);
      }
      list.appendChild(d);
    }
    for (const err of s.errors) {
      const d = document.createElement('div');
      d.className = 't-desc';
      d.style.color = 'var(--err)';
      d.textContent = `✕ ${err.source}: ${err.error}`;
      list.appendChild(d);
    }
    if (!s.loaded.length && !s.errors.length) {
      list.innerHTML = '<div class="t-desc">No skills — add a github: source below.</div>';
    }
  } catch (e) {
    list.innerHTML = '';
    const d = document.createElement('div');
    d.className = 't-desc';
    d.textContent = 'Failed to load skills: ' + e.message;
    list.appendChild(d);
  }
}

$('#btn-skill-add').onclick = async () => {
  const src = $('#skill-source').value.trim();
  if (!src) return;
  $('#btn-skill-add').disabled = true;
  try {
    const r = await api('/api/agent-skills', { method: 'POST', body: JSON.stringify({ source: src }) });
    $('#skill-source').value = '';
    await loadAgentSkills();
    if (!r.ok) setStatus(`Skill loaded: ${r.skill?.name ?? src}`);
  } catch (e) {
    setStatus('Failed to add skill: ' + e.message);
    setTimeout(() => setStatus(''), 3000);
  } finally {
    $('#btn-skill-add').disabled = false;
  }
};

// ===== Sessions (sidebar) =====
function resetChatDom() {
  chatEl.innerHTML = '';
  lastTool = null;
  toolBlocks.clear();
  resetStream();
  agentRuns = [];
}

async function loadSessions() {
  try {
    renderSessions(await api('/api/sessions'));
  } catch {}
}

function renderSessions(s) {
  const list = $('#ss-list');
  list.innerHTML = '';
  const active = s.sessions.find((x) => x.id === s.active);
  if (active) document.title = `SciAgent — ${active.title}`;
  for (const sess of s.sessions) {
    const item = document.createElement('div');
    item.className = 'ss-item' + (sess.id === s.active ? ' active' : '');
    item.title = `${sess.title} — ${sess.count ?? 0} messages`;
    const label = document.createElement('span');
    label.className = 'ss-label';
    label.textContent = sess.title || sess.id;
    item.appendChild(label);
    const del = document.createElement('button');
    del.className = 'ss-del';
    del.textContent = '×';
    del.title = 'Delete session';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (busy) return alert('Agent running; cannot delete a session.');
      await api('/api/sessions/delete', { method: 'POST', body: JSON.stringify({ id: sess.id }) }).catch(() => {});
      resetChatDom();
      await restoreHistory();
      renderEmpty();
      loadSessions();
    };
    const ren = document.createElement('button');
    ren.className = 'ss-del';
    ren.textContent = '✎';
    ren.title = 'Rename';
    ren.onclick = async (e) => {
      e.stopPropagation();
      const t = prompt('New title', sess.title);
      if (!t || !t.trim()) return;
      await api('/api/sessions/rename', { method: 'POST', body: JSON.stringify({ id: sess.id, title: t }) }).catch(() => {});
      loadSessions();
    };
    item.appendChild(ren);
    item.appendChild(del);
    item.onclick = async () => {
      if (busy) return alert('Agent running; cannot switch sessions.');
      if (sess.id === s.active) return;
      await api('/api/sessions/switch', { method: 'POST', body: JSON.stringify({ id: sess.id }) }).catch(() => {});
      resetChatDom();
      await restoreHistory();
      renderEmpty();
      loadSessions();
    };
    list.appendChild(item);
  }
}

$('#ss-new').onclick = async () => {
  if (busy) return alert('Agent running; cannot open a new session.');
  await api('/api/sessions', { method: 'POST', body: JSON.stringify({}) }).catch(() => {});
  resetChatDom();
  renderEmpty();
  loadSessions();
};

loadSessions();
renderEmpty();
loadConfig()
  .then(() => restoreHistory())
  .then(() => renderEmpty())
  .catch((e) => setStatus('Failed to load config: ' + e.message));

// ===== Sidebar: view switching + tool list =====
const views = { chat: $('#view-chat'), tools: $('#view-tools'), agents: $('#view-agents'), charts: $('#view-charts') };

document.querySelectorAll('.nav-item').forEach((btn) => {
  btn.onclick = () => {
    const v = btn.dataset.view;
    if (v === 'settings') {
      $('#settings').classList.remove('hidden');
      return;
    }
    document.querySelectorAll('.nav-item').forEach((b) => b.classList.toggle('active', b === btn));
    for (const [k, el] of Object.entries(views)) el.classList.toggle('hidden', k !== v);
    if (v === 'tools') loadTools();
    if (v === 'agents') { renderAgents(); loadAgentSkills(); }
    if (v === 'charts' && !chartData) renderChartEmpty();
  };
});

async function loadTools() {
  const list = $('#tools-list');
  list.innerHTML = '';
  const loading = document.createElement('li');
  loading.textContent = 'loading…';
  loading.style.color = 'var(--dim)';
  list.appendChild(loading);
  try {
    const c = await api('/api/config');
    list.innerHTML = '';
    const groups = new Map();
    for (const t of c.tools) {
      const title = t.group ?? 'Other';
      if (!groups.has(title)) groups.set(title, []);
      groups.get(title).push(t);
    }
    for (const [title, tools] of groups) {
      const h = document.createElement('h3');
      h.className = 'sub-h';
      h.textContent = `${title} (${tools.length})`;
      list.appendChild(h);
      for (const t of tools) {
        const li = document.createElement('li');
        if (t.name === 'task') li.className = 'ai';
        const nameRow = document.createElement('div');
        const name = document.createElement('span');
        name.className = 't-name';
        name.textContent = t.name;
        nameRow.appendChild(name);
        if (t.needsApproval) {
          const chip = document.createElement('span');
          chip.className = 't-chip';
          chip.textContent = 'needs approval';
          nameRow.appendChild(chip);
        }
        const desc = document.createElement('div');
        desc.className = 't-desc';
        desc.textContent = t.description;
        li.append(nameRow, desc);
        list.appendChild(li);
      }
    }
    // If the list loaded late, re-apply the active filter
    $('#tool-filter').dispatchEvent(new Event('input'));
  } catch (e) {
    list.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = 'Failed to load tools: ' + e.message;
    list.appendChild(li);
  }
}
