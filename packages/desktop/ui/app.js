const $ = (s) => document.querySelector(s);
const chatEl = $('#chat');
let busy = false;
let lastTool = null;
const toolBlocks = new Map(); // araç çağrı id'si → <details> (paralel yürütmede doğru eşleme)
let agentRuns = []; // bu oturumdaki alt-ajan görevleri
let agentsInfoLoaded = false;

// Akıllı kaydırma: kullanıcı yukarı bakıyorsa zorla aşağı çekme
const nearBottom = () => chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 140;

async function api(path, opts = {}) {
  const r = await fetch(path, { headers: { 'content-type': 'application/json' }, ...opts });
  const data = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(data.error || `HTTP ${r.status}`);
  return data;
}

function bubble(cls) {
  const d = document.createElement('div');
  d.className = `msg ${cls}`;
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
  if (name === 'task') det.classList.add('ai'); // ajan araçları turkuaz
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
  p.innerHTML = '<b>Onay bekleniyor:</b> ';
  p.append(name);
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(args, null, 2);
  const row = document.createElement('div');
  row.className = 'row';
  const yes = document.createElement('button');
  yes.textContent = 'Onayla';
  const no = document.createElement('button');
  no.textContent = 'Reddet';
  no.className = 'ghost';
  row.append(yes, no);
  card.append(p, pre, row);
  chatEl.appendChild(card);
  if (nearBottom()) chatEl.scrollTop = chatEl.scrollHeight;
  const decide = async (approved) => {
    yes.disabled = true;
    no.disabled = true;
    card.classList.add(approved ? 'ok' : 'no');
    try {
      await api('/api/approve', { method: 'POST', body: JSON.stringify({ id, approved }) });
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
    subNote(`▶ Alt ajan başladı: ${ev.prompt}`);
    renderAgents();
  } else if (ev.type === 'task_end') {
    const run = [...agentRuns].reverse().find((r) => r.prompt === ev.prompt && r.status === 'running');
    if (run) run.status = ev.done === false ? 'failed' : 'done';
    subNote(`■ Alt ajan bitti: ${ev.prompt}`);
    renderAgents();
  } else if (ev.type === 'sub_event') {
    const e = ev.ev ?? {};
    const what =
      e.type === 'tool_call'
        ? `araç → ${e.name}`
        : e.type === 'text'
          ? e.text
          : e.type === 'error'
            ? `hata: ${e.text}`
            : e.type;
    if (e.type === 'text') {
      const run = [...agentRuns].reverse().find((r) => r.prompt === ev.prompt);
      if (run) run.summary = e.text;
      renderAgents();
    }
    subNote(`  ↳ ${ev.prompt} · ${what}`);
  } else if (ev.type === 'approval_request') {
    resetStream();
    approvalCard(ev);
  } else if (ev.type === 'error') {
    resetStream();
    addText(bubble('assistant'), `⚠ ${ev.text}`);
  } else if (ev.type === 'done') {
    // Akış bitti: birikmiş metni markdown olarak yeniden çiz (kod blokları vb.)
    if (streamTarget && streamText) renderMd(streamTarget, streamText);
    resetStream();
  }
}

async function send() {
  if (busy) return;
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
  $('#empty')?.remove();
  input.value = '';
  busy = true;
  $('#btn-send').disabled = true;
  setStatus('Ajan çalışıyor…');
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
    addText(bubble('assistant'), `⚠ Hata: ${e.message}`);
  } finally {
    busy = false;
    $('#btn-send').disabled = false;
    setStatus('');
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

$('#btn-send').onclick = send;
$('#input').addEventListener('keydown', (e) => {
  if (e.key === 'Enter' && !e.shiftKey) {
    e.preventDefault();
    send();
  }
});
$('#btn-clear').onclick = async () => {
  await api('/api/clear', { method: 'POST' }).catch(() => {});
  chatEl.innerHTML = '';
  lastTool = null;
  resetStream();
  renderEmpty();
};
$('#btn-settings').onclick = () => $('#settings').classList.remove('hidden');
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
    await loadConfig();
  } catch (e) {
    alert('Kaydedilemedi: ' + e.message);
  }
};

// ===== Markdown (kod bloğu + kopyala) =====
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
  t = t.replace(/`([^`\n]+)`/g, '<code class="inline">$1</code>');
  t = t.replace(/\*\*([^*\n]+)\*\*/g, '<b>$1</b>');
  t = t.replace(/^### (.*)$/gm, '<h3>$1</h3>');
  t = t.replace(/^## (.*)$/gm, '<h2>$1</h2>');
  t = t.replace(/^- (.*)$/gm, '• $1');
  t = t.replace(/\n/g, '<br>');
  t = t.replace(/\u0000CODE(\d+)\u0000/g, (m, i) => {
    const b = blocks[Number(i)];
    return `<div class="codebox"><div class="codebar"><span>${esc(b.lang || 'kod')}</span><button class="copy">kopyala</button></div><pre><code>${b.code}</code></pre></div>`;
  });
  return t;
}

function renderMd(el, text) {
  el.innerHTML = mdToHtml(text);
}

chatEl.addEventListener('click', async (e) => {
  const btn = e.target.closest('.copy');
  if (!btn) return;
  const code = btn.closest('.codebox')?.querySelector('code');
  if (!code) return;
  try {
    await navigator.clipboard.writeText(code.textContent);
    btn.textContent = 'kopyalandı';
    setTimeout(() => (btn.textContent = 'kopyala'), 1500);
  } catch {}
});

// ===== Boş sohbet önerileri =====
function renderEmpty() {
  if (chatEl.querySelector('.msg, details.tool, #empty')) return;
  const d = document.createElement('div');
  d.id = 'empty';
  d.className = 'empty';
  const t = document.createElement('div');
  t.className = 'e-title';
  t.textContent = 'Bir görev yaz ya da bir öneri seç';
  const chips = document.createElement('div');
  chips.className = 'chips';
  const ideas = [
    'data/ altındaki CSV dosyasını analiz et',
    'Literatürde "protein katlanması" araması yap',
    "1 eV kaç joule? Fizik sabitleriyle doğrula",
    'Görevi paralel alt-ajanlara bölüp rapor hazırla',
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

// ===== Ajanlar görünümü =====
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
        mk('Çalışma alanı', c.workspaceRoot),
        mk('Araç sayısı', String(c.tools.length), 'turquoise'),
        mk('Durum', busy ? 'görev çalışıyor' : 'boşta', busy ? 'turquoise' : ''),
      );
      agentsInfoLoaded = true;
    } catch {}
  }
  const list = $('#agents-list');
  list.innerHTML = '';
  if (!agentRuns.length) {
    const d = document.createElement('div');
    d.className = 'agent-card';
    d.textContent = 'Bu oturumda alt-ajan görevi başlatılmadı. Sohbette paralel görev isteyerek task aracını kullandır.';
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
    st.textContent = r.status === 'running' ? '● devam ediyor' : r.status === 'failed' ? '✕ hata' : '✓ tamamlandı';
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

renderEmpty();
loadConfig().catch((e) => setStatus('Yapılandırma yüklenemedi: ' + e.message));

// ===== Sol menü: görünüm geçişi + araç listesi =====
const views = { chat: $('#view-chat'), tools: $('#view-tools'), agents: $('#view-agents') };

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
    if (v === 'agents') renderAgents();
  };
});

async function loadTools() {
  const list = $('#tools-list');
  list.innerHTML = '';
  const loading = document.createElement('li');
  loading.textContent = 'yükleniyor…';
  loading.style.color = 'var(--dim)';
  list.appendChild(loading);
  try {
    const c = await api('/api/config');
    list.innerHTML = '';
    for (const t of c.tools) {
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
        chip.textContent = 'onay ister';
        nameRow.appendChild(chip);
      }
      const desc = document.createElement('div');
      desc.className = 't-desc';
      desc.textContent = t.description;
      li.append(nameRow, desc);
      list.appendChild(li);
    }
  } catch (e) {
    list.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = 'Araç listesi alınamadı: ' + e.message;
    list.appendChild(li);
  }
}
