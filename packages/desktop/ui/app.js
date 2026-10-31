const $ = (s) => document.querySelector(s);
const chatEl = $('#chat');
let busy = false;
let lastTool = null;
const toolBlocks = new Map(); // araç çağrı id'si → <details> (paralel yürütmede doğru eşleme)
const approvalCards = new Map(); // onay id'si → kart (zaman aşımı bildirimi için)
let agentRuns = []; // bu oturumdaki alt-ajan görevleri
let agentsInfoLoaded = false;
let lastUserText = '';

// Akıllı kaydırma: kullanıcı yukarı bakıyorsa zorla aşağı çekme
const nearBottom = () => chatEl.scrollHeight - chatEl.scrollTop - chatEl.clientHeight < 140;

// Baloncuklara saat damgası
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
  const cb = document.createElement('button');
  cb.className = 't-copy';
  cb.textContent = 'kopyala';
  cb.onclick = () => {
    navigator.clipboard.writeText(output).then(() => {
      cb.textContent = 'kopyalandı';
      setTimeout(() => (cb.textContent = 'kopyala'), 1200);
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
  p.innerHTML = '<b>Onay bekleniyor:</b> ';
  p.append(name);
  const pre = document.createElement('pre');
  pre.textContent = JSON.stringify(args, null, 2);
  const row = document.createElement('div');
  row.className = 'row';
  const yes = document.createElement('button');
  yes.textContent = 'Onayla';
  yes.className = 'turquoise';
  const no = document.createElement('button');
  no.textContent = 'Reddet';
  no.className = 'ghost';
  row.append(yes, no);
  const remember = document.createElement('label');
  remember.className = 'remember';
  const rbox = document.createElement('input');
  rbox.type = 'checkbox';
  remember.append(rbox, document.createTextNode('Bu oturumda bu araca izin ver'));
  // 5 dakikalık onay penceresi geri sayımı
  let left = 300;
  const count = document.createElement('span');
  count.className = 'a-count';
  const tick = setInterval(() => {
    left -= 1;
    if (left <= 0) {
      count.textContent = 'süre doldu';
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
    count.textContent = 'karar verildi';
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
  } else if (ev.type === 'step') {
    setStatus(`Ajan çalışıyor… adım ${ev.step}/${ev.maxSteps}`);
  } else if (ev.type === 'approval_request') {
    resetStream();
    approvalCard(ev);
  } else if (ev.type === 'approval_result') {
    // Sunucu tarafı sonuç (ör. 5 dk zaman aşımı) — kart hâlâ bekliyorsa kapat.
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
          note.textContent = '⏱ 5 dakika içinde onaylanmadı — otomatik reddedildi.';
          c.card.appendChild(note);
        }
      }
      approvalCards.delete(ev.id);
    }
  } else if (ev.type === 'error') {
    resetStream();
    const b = bubble('assistant');
    if (/fetch failed|ECONNREFUSED|ENOTFOUND|Model sunucusu \d{3}/i.test(ev.text)) {
      // Modele ulaşılamadı: kibar kart + Ayarlar kısayolu
      const t = document.createElement('div');
      t.className = 'm-title';
      t.textContent = 'Modele ulaşılamadı';
      const d = document.createElement('div');
      d.style.color = 'var(--dim)';
      d.textContent = ev.text;
      const hint = document.createElement('div');
      hint.style.color = 'var(--dim)';
      hint.style.margin = '6px 0';
      hint.textContent = 'Ayarlar\u2019dan API adresini ve model adını kontrol et (ör. Ollama: http://localhost:11434/v1).';
      const btn = document.createElement('button');
      btn.className = 'turquoise';
      btn.textContent = 'Ayarları Aç';
      btn.onclick = () => $('#settings').classList.remove('hidden');
      const retry = document.createElement('button');
      retry.className = 'ghost';
      retry.textContent = 'Yeniden Dene';
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
  lastUserText = text;
  $('#empty')?.remove();
  input.value = '';
  busy = true;
  const sendBtn = $('#btn-send');
  sendBtn.disabled = false;
  sendBtn.textContent = 'Durdur';
  sendBtn.classList.add('btn-stop');
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
    sendBtn.disabled = false;
    sendBtn.textContent = 'Gönder';
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

// Gönder / Durdur: ajan çalışırken düğme durdurma görevi görür
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
    setStatus('Ajan çalışıyor; temizlenemez.');
    setTimeout(() => setStatus(''), 2500);
  }
};
$('#btn-settings').onclick = () => $('#settings').classList.remove('hidden');
// Esc ile Ayarlar penceresini kapat
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape') $('#settings').classList.add('hidden');
});
// Model rozetine tıklayınca Ayarlar açılır
$('#model-badge').style.cursor = 'pointer';
$('#model-badge').title = 'Model ayarlarını aç';
$('#model-badge').onclick = () => $('#settings').classList.remove('hidden');

// Hero bandını gizle/göster (tercih hatırlanır)
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

// Araç arama filtresi (boş kalan grup başlıklarını da gizler)
$('#tool-filter').addEventListener('input', () => {
  const q = $('#tool-filter').value.trim().toLowerCase();
  const list = $('#tools-list');
  let lastHead = null;
  let visible = 0;
  [...list.children].forEach((el) => {
    if (el.tagName === 'H3') {
      if (lastHead) lastHead.style.display = visible ? '' : 'none';
      lastHead = el;
      visible = 0;
    } else {
      const show = !q || el.textContent.toLowerCase().includes(q);
      el.style.display = show ? '' : 'none';
      if (show) visible += 1;
    }
  });
  if (lastHead) lastHead.style.display = visible ? '' : 'none';
});

// Girdi alanı içeriğe göre büyüsün (en fazla ~6 satır)
const inputEl = $('#input');
inputEl.addEventListener('input', () => {
  inputEl.style.height = 'auto';
  inputEl.style.height = `${Math.min(inputEl.scrollHeight, 150)}px`;
});

// Sohbeti Markdown olarak dışa aktar
$('#btn-export').onclick = async () => {
  try {
    const h = await api('/api/history');
    const lines = ['# SciAgent Sohbeti', '', new Date().toLocaleString('tr-TR'), ''];
    for (const m of h.messages) {
      if (m.role === 'user') lines.push(`## Kullanıcı\n\n${m.content}\n`);
      else if (m.role === 'assistant') {
        if (m.tool_calls?.length) {
          for (const tc of m.tool_calls) {
            lines.push(`**→ araç:** ${tc.function?.name} \`${tc.function?.arguments}\`\n`);
          }
        }
        if (m.content) lines.push(`**SciAgent**\n\n${m.content}\n`);
      } else if (m.role === 'tool') {
        lines.push(`> sonuç: ${String(m.content).slice(0, 400)}\n`);
      }
    }
    const blob = new Blob([lines.join('\n')], { type: 'text/markdown' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob);
    a.download = 'sciagent-sohbet.md';
    a.click();
    URL.revokeObjectURL(a.href);
  } catch (e) {
    alert('Dışa aktarılamadı: ' + e.message);
  }
};

// Model bağlantı testi
$('#s-test').onclick = async () => {
  const r = $('#s-test-result');
  r.classList.remove('hidden');
  r.textContent = 'test ediliyor…';
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
    r.textContent = res.ok ? `✓ bağlantı başarılı (${res.ms} ms)` : `✕ başarısız: ${res.error}`;
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
    agentsInfoLoaded = false; // Ajanlar kartı yeni model bilgisiyle tazelensin
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
  el.appendChild(stampChip());
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

// ===== Sohbet geçmişi (sunucu kalıcılığından geri yükleme) =====
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

// ===== Grafikler görünümü =====
const CHART_COLORS = ['#1677FF', '#00D5C8', '#66F0FF', '#F5FAFF', '#8FA3BD'];
let chartData = null;
let chartHidden = new Set(); // lejanttan gizlenen seriler

async function loadChart() {
  const p = $('#chart-path').value.trim();
  if (!p) return;
  const box = $('#chart-box');
  box.innerHTML = '<p class="lead">yükleniyor…</p>';
  try {
    chartData = await api('/api/csv?path=' + encodeURIComponent(p));
    chartHidden = new Set();
    renderChart();
  } catch (e) {
    box.innerHTML = '';
    const d = document.createElement('p');
    d.className = 'lead';
    d.textContent = 'Hata: ' + e.message;
    box.appendChild(d);
  }
}

function renderChartEmpty() {
  $('#chart-legend').innerHTML = '';
  $('#chart-box').innerHTML =
    '<div class="empty"><div class="e-title">Henüz grafik yok</div><div>Yukarıdaki alana bir CSV yolu yaz ya da örnek düğmesini kullan.</div></div>';
}

function renderChart() {
  const data = chartData;
  if (!data) return;
  const box = $('#chart-box');
  const legend = $('#chart-legend');
  const all = Object.keys(data.numeric ?? {});
  const names = all.filter((k) => !chartHidden.has(k));

  // Lejant: tıklanınca seri göster/gizle
  legend.innerHTML = '';
  all.forEach((k, si) => {
    const item = document.createElement('span');
    const sw = document.createElement('i');
    sw.style.background = CHART_COLORS[si % CHART_COLORS.length];
    item.append(sw, document.createTextNode(k));
    if (chartHidden.has(k)) item.classList.add('off');
    item.title = 'göster/gizle';
    item.onclick = () => {
      chartHidden.has(k) ? chartHidden.delete(k) : chartHidden.add(k);
      renderChart();
    };
    legend.appendChild(item);
  });

  if (!names.length) {
    box.innerHTML = '<p class="lead">Tüm seriler gizli — göstermek için lejanta tıkla.</p>';
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
  // norm: her seri kendi min/max'ına göre ölçeklenir (farklı büyüklükteki seriler karşılaştırılabilir)
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
    // Tek noktalı serilerde çizgi görünmez olur → nokta işaretleyici çiz
    if (cols[si].length === 1) {
      series += `<circle cx="${xs(0).toFixed(1)}" cy="${ys(si, cols[si][0]).toFixed(1)}" r="4" fill="${color}"/>`;
    }
  });
  // X ekseni etiketleri: ilk metin sütunu varsa kullanılır
  let ticks = '';
  if (data.labelName && Array.isArray(data.labels) && data.labels.length) {
    const step = Math.max(1, Math.ceil(data.labels.length / 10));
    data.labels.forEach((lb, i) => {
      if (i % step === 0 && i < n) {
        ticks += `<text x="${xs(i).toFixed(1)}" y="${H - B + 16}" fill="#8FA3BD" font-size="10" text-anchor="middle">${esc(String(lb)).slice(0, 12)}</text>`;
      }
    });
  }
  const yAxisNote = norm ? 'göreli (0–1, seri başına)' : '';
  const xNote = data.labelName ? ` · x: ${esc(data.labelName)}` : ` · satır (0–${n - 1})`;
  box.innerHTML = `<svg class="chartsvg" viewBox="0 0 ${W} ${H}" role="img">${grid}${ticks}${series}<text x="${W - R - 150}" y="${H - 12}" fill="#8FA3BD" font-size="11">${xNote}${yAxisNote ? ' · ' + yAxisNote : ''}</text></svg>`;
}

// Son kullanılan grafik yolunu hatırla
const chartPathInput = $('#chart-path');
chartPathInput.value = localStorage.getItem('sciagent-chart-path') ?? '';
const loadChartSaved = async () => {
  await loadChart();
  if (chartData) localStorage.setItem('sciagent-chart-path', chartPathInput.value);
};
$('#btn-chart').onclick = loadChartSaved;
$('#chart-example').onclick = () => {
  $('#chart-path').value = 'examples/veri.csv';
  loadChartSaved();
};
chartPathInput.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') loadChartSaved();
});

// ===== Oturumlar (sol menü) =====
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
    item.title = sess.title;
    const label = document.createElement('span');
    label.textContent = sess.title || sess.id;
    item.appendChild(label);
    const del = document.createElement('button');
    del.className = 'ss-del';
    del.textContent = '×';
    del.title = 'Oturumu sil';
    del.onclick = async (e) => {
      e.stopPropagation();
      if (busy) return alert('Ajan çalışıyor; oturum silinemez.');
      await api('/api/sessions/delete', { method: 'POST', body: JSON.stringify({ id: sess.id }) }).catch(() => {});
      resetChatDom();
      await restoreHistory();
      renderEmpty();
      loadSessions();
    };
    const ren = document.createElement('button');
    ren.className = 'ss-del';
    ren.textContent = '✎';
    ren.title = 'Yeniden adlandır';
    ren.onclick = async (e) => {
      e.stopPropagation();
      const t = prompt('Yeni başlık', sess.title);
      if (!t || !t.trim()) return;
      await api('/api/sessions/rename', { method: 'POST', body: JSON.stringify({ id: sess.id, title: t }) }).catch(() => {});
      loadSessions();
    };
    item.appendChild(ren);
    item.appendChild(del);
    item.onclick = async () => {
      if (busy) return alert('Ajan çalışıyor; oturum değiştirilemez.');
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
  if (busy) return alert('Ajan çalışıyor; yeni oturum açılamaz.');
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
  .catch((e) => setStatus('Yapılandırma yüklenemedi: ' + e.message));

// ===== Sol menü: görünüm geçişi + araç listesi =====
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
    if (v === 'agents') renderAgents();
    if (v === 'charts' && !chartData) renderChartEmpty();
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
    const groups = new Map();
    for (const t of c.tools) {
      const title = t.group ?? 'Diğer';
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
          chip.textContent = 'onay ister';
          nameRow.appendChild(chip);
        }
        const desc = document.createElement('div');
        desc.className = 't-desc';
        desc.textContent = t.description;
        li.append(nameRow, desc);
        list.appendChild(li);
      }
    }
    // Liste geç yüklendiyse aktif filtreyi yeniden uygula
    $('#tool-filter').dispatchEvent(new Event('input'));
  } catch (e) {
    list.innerHTML = '';
    const li = document.createElement('li');
    li.textContent = 'Araç listesi alınamadı: ' + e.message;
    list.appendChild(li);
  }
}
