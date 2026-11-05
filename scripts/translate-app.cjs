// Geçici çeviri betiği (app.js TR -> EN). Çalıştır: node scripts/translate-app.cjs
const fs = require('fs');
const p = 'packages/desktop/ui/app.js';
let s = fs.readFileSync(p, 'utf8');
const pairs = [
  ["cb.textContent = 'kopyala'", "cb.textContent = 'copy'"],
  ["cb.textContent = 'kopyalandı'", "cb.textContent = 'copied'"],
  ["setTimeout(() => (cb.textContent = 'kopyala'), 1200)", "setTimeout(() => (cb.textContent = 'copy'), 1200)"],
  ["document.createTextNode('Bu oturumda bu araca izin ver')", "document.createTextNode('Allow this tool for this session')"],
  ["setStatus('Ajan çalışıyor; temizlenemez.')", "setStatus('Agent running; cannot clear.')"],
  ["esc(b.lang || 'kod')", "esc(b.lang || 'code')"],
  ["<button class=\"copy\">kopyala</button>", "<button class=\"copy\">copy</button>"],
  ["b.textContent = 'kopyala'", "b.textContent = 'copy'"],
  ["b.textContent = 'kopyalandı'", "b.textContent = 'copied'"],
  ["setTimeout(() => (b.textContent = 'kopyala'), 1200)", "setTimeout(() => (b.textContent = 'copy'), 1200)"],
  ["btn.textContent = 'kopyalandı'", "btn.textContent = 'copied'"],
  ["setTimeout(() => (btn.textContent = 'kopyala'), 1500)", "setTimeout(() => (btn.textContent = 'copy'), 1500)"],
  ["box.innerHTML = '<p class=\"lead\">yükleniyor…</p>'", "box.innerHTML = '<p class=\"lead\">loading…</p>'"],
  ["'<p class=\"lead\">Tüm seriler gizli — göstermek için lejanta tıkla.</p>'", "'<p class=\"lead\">All series hidden — click the legend to show.</p>'"],
  ["`Beceriler (GitHub SKILL.md) — ${s.loaded.length} yüklü${s.errors.length ? `, ${s.errors.length} hatalı` : ''}`", "`Skills (GitHub SKILL.md) — ${s.loaded.length} loaded${s.errors.length ? `, ${s.errors.length} failed` : ''}`"],
  ["del.title = 'Beceriyi kaldır'", "del.title = 'Remove skill'"],
  ["d.textContent = 'Beceriler alınamadı: ' + e.message", "d.textContent = 'Failed to load skills: ' + e.message"],
  ["loading.textContent = 'yükleniyor…'", "loading.textContent = 'loading…'"],
  ["setStatus(`Ajan çalışıyor… adım ${ev.step}/${ev.maxSteps}`)", "setStatus(`Agent running… step ${ev.step}/${ev.maxSteps}`)"],
  ["setStatus('Ajan çalışıyor…');", "setStatus('Agent running…');"],
  ["setStatus('Ajan çalışıyor; temizlenemez.');", "setStatus('Agent running; cannot clear.');"],
  ["'data/ altındaki CSV dosyasını analiz et'", "'Analyze the CSV file under data/'"],
  ["'Literatürde \"protein katlanması\" araması yap'", "'Search the literature for \"protein folding\"'"],
  ['"1 eV kaç joule? Fizik sabitleriyle doğrula"', '"How many joules is 1 eV? Verify with physics constants"'],
  ["'Görevi paralel alt-ajanlara bölüp rapor hazırla'", "'Split the task across parallel sub-agents and prepare a report'"],
  ["'<div class=\"empty\"><div class=\"e-title\">Henüz grafik yok</div><div>Yukarıdaki alana bir CSV yolu yaz ya da örnek düğmesini kullan.</div></div>'", "'<div class=\"empty\"><div class=\"e-title\">No chart yet</div><div>Type a CSV path above or use the example button.</div></div>'"],
  ["setStatus(`Beceri yüklendi: ${r.skill?.name ?? src}`)", "setStatus(`Skill loaded: ${r.skill?.name ?? src}`)"],
  ["setStatus('Beceri eklenemedi: ' + e.message)", "setStatus('Failed to add skill: ' + e.message)"],
  ["return alert('Ajan çalışıyor; oturum silinemez.');", "return alert('Agent running; cannot delete a session.');"],
  ["return alert('Ajan çalışıyor; oturum değiştirilemez.');", "return alert('Agent running; cannot switch sessions.');"],
  ["return alert('Ajan çalışıyor; yeni oturum açılamaz.');", "return alert('Agent running; cannot open a new session.');"],
  ["item.title = 'göster/gizle'", "item.title = 'show/hide'"],
  ["cnt.textContent = all.length + ' seri'", "cnt.textContent = all.length + ' series'"],
  ["let agentRuns = []; // bu oturumdaki alt-ajan görevleri", "let agentRuns = []; // sub-agent tasks of this session"],
];
let missing = [];
for (const [a, b] of pairs) {
  if (!s.includes(a)) missing.push(a.slice(0, 70));
  s = s.split(a).join(b);
}
if (missing.length) {
  console.error('BULUNAMADI (' + missing.length + '):');
  for (const m of missing) console.error('  -', m);
  process.exit(1);
}
fs.writeFileSync(p, s);
console.log('app.js EN tamam — değişen:', pairs.length);
