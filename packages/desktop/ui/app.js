const $ = (s) => document.querySelector(s);
const chatEl = $('#chat');
let busy = false;
let lastTool = null;
const toolBlocks = new Map(); // araç çağrı id'si → <details> (paralel yürütmede doğru eşleme)

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
  chatEl.scrollTop = chatEl.scrollHeight;
  return d;
}

function addText(target, text) {
  const span = document.createElement('span');
  span.className = 'txt';
  span.textContent = text;
  target.appendChild(span);
  target.appendChild(document.createTextNode('\n'));
  chatEl.scrollTop = chatEl.scrollHeight;
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
  chatEl.scrollTop = chatEl.scrollHeight;
  return det;
}

function toolResult(id, ok, output) {
  const det = (id && toolBlocks.get(id)) || lastTool;
  if (!det) return;
  const pre = document.createElement('pre');
  pre.className = ok ? 'out' : 'err';
  pre.textContent = output;
  det.appendChild(pre);
  chatEl.scrollTop = chatEl.scrollHeight;
}

function subNote(text) {
  const d = document.createElement('div');
  d.className = 'reasoning';
  d.textContent = text;
  chatEl.appendChild(d);
  chatEl.scrollTop = chatEl.scrollHeight;
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
  chatEl.scrollTop = chatEl.scrollHeight;
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
    chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'reasoning_delta') {
    if (!reasoningEl) {
      reasoningEl = document.createElement('div');
      reasoningEl.className = 'reasoning';
      chatEl.appendChild(reasoningEl);
    }
    reasoningEl._text = (reasoningEl._text || '') + ev.text;
    reasoningEl.textContent = `🧠 ${reasoningEl._text}`;
    chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'reasoning') {
    const d = document.createElement('div');
    d.className = 'reasoning';
    d.textContent = `🧠 ${ev.text}`;
    chatEl.appendChild(d);
    chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'text') {
    addText(bubble('assistant'), ev.text);
  } else if (ev.type === 'info') {
    const d = document.createElement('div');
    d.className = 'reasoning';
    d.textContent = `ℹ ${ev.text}`;
    chatEl.appendChild(d);
    chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'tool_call') {
    resetStream();
    toolBlock(ev.id, ev.name, ev.args);
  } else if (ev.type === 'tool_result') {
    toolResult(ev.id, ev.ok, ev.output);
  } else if (ev.type === 'task_start') {
    subNote(`▶ Alt ajan başladı: ${ev.prompt}`);
  } else if (ev.type === 'task_end') {
    subNote(`■ Alt ajan bitti: ${ev.prompt}`);
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
    subNote(`  ↳ ${ev.prompt} · ${what}`);
  } else if (ev.type === 'approval_request') {
    resetStream();
    approvalCard(ev);
  } else if (ev.type === 'error') {
    resetStream();
    addText(bubble('assistant'), `⚠ ${ev.text}`);
  } else if (ev.type === 'done') {
    resetStream();
  }
}

async function send() {
  if (busy) return;
  const input = $('#input');
  const text = input.value.trim();
  if (!text) return;
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

loadConfig().catch((e) => setStatus('Yapılandırma yüklenemedi: ' + e.message));

// ===== Sol menü: görünüm geçişi + araç listesi =====
const views = { chat: $('#view-chat'), tools: $('#view-tools') };

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
