// SciAgent UI markdown helpers — single source of truth for esc() and mdToHtml().
// Loaded as a classic <script> (/md.js) BEFORE app.js in index.html and consumed via
// globalThis.Md; Node tests import this same file (test/md-escape.test.js), so the
// browser and the tests always exercise identical escaping code. No import/export
// syntax here on purpose (the file must stay valid as a classic script).
(function (g) {
  'use strict';

  // Escape HTML entities BEFORE any markdown transform: after this the text contains
  // no raw <, >, &, ", ' — later steps can only emit the structural markup below.
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
    // Turn URLs into clickable links (trailing punctuation stays outside the link).
    // The regex only matches http(s):// — javascript:/data: URLs never become anchors —
    // and the text is pre-escaped, so no raw quotes can break out of the href attribute.
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
      // A literal "\u0000CODEn\u0000" in the model output must not crash rendering
      // (blocks[n] can be undefined) — drop the placeholder instead.
      if (!b) return '';
      return `<div class="codebox"><div class="codebar"><span>${esc(b.lang || 'code')}</span><button class="copy">copy</button></div><pre><code>${b.code}</code></pre></div>`;
    });
    return t;
  }

  g.Md = { esc, mdToHtml };
})(typeof globalThis !== 'undefined' ? globalThis : this);
