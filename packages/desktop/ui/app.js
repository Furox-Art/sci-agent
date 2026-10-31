const $ = (s) => document.querySelector(s);
const chatEl = $('#chat');
let busy = false;
let lastTool = null;

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

function toolBlock(name, args) {
  const det = document.createElement('details');
  det.className = 'tool';
  det.open = true;
  const sum = document.createElement('summary');
  sum.textContent = `→ ${name}`;
  det.appendChild(sum);
  const pre = document.createElement('pre');
  pre.textContent = typeof args === 'string' ? args : JSON.stringify(args, null, 2);
  det.appendChild(pre);
  chatEl.appendChild(det);
  chatEl.scrollTop = chatEl.scrollHeight;
  return det;
}

function toolResult(ok, output) {
  if (!lastTool) return;
  const pre = document.createElement('pre');
  pre.className = ok ? 'out' : 'err';
  pre.textContent = output;
  lastTool.appendChild(pre);
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

function handleEvent(ev) {
  if (ev.type === 'reasoning') {
    const d = document.createElement('div');
    d.className = 'reasoning';
    d.textContent = `🧠 ${ev.text}`;
    chatEl.appendChild(d);
    chatEl.scrollTop = chatEl.scrollHeight;
  } else if (ev.type === 'text') {
    addText(bubble('assistant'), ev.text);
  } else if (ev.type === 'tool_call') {
    lastTool = toolBlock(ev.name, ev.args);
  } else if (ev.type === 'tool_result') {
    toolResult(ev.ok, ev.output);
  } else if (ev.type === 'approval_request') {
    approvalCard(ev);
  } else if (ev.type === 'error') {
    addText(bubble('assistant'), `⚠ ${ev.text}`);
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
