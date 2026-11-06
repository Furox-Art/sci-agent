import { test } from 'node:test';
import assert from 'node:assert/strict';

// app.js is a browser script (touches document at top level), so it cannot be imported
// in Node. The escaping/markdown helpers therefore live in ui/md.js — a classic-script
// compatible file (no import/export syntax, sets globalThis.Md) that the browser loads
// via <script src="/md.js"> BEFORE app.js. Importing it here exercises the exact code
// the browser runs when rendering model output, tool markdown and SKILL.md bodies.
await import('../packages/desktop/ui/md.js');
const { esc, mdToHtml } = globalThis.Md;

test('esc escapes all HTML-significant characters', () => {
  assert.equal(esc(`a&b<c>d"e'f`), 'a&amp;b&lt;c&gt;d&quot;e&#39;f');
});

test('model output with raw HTML tags renders as text, not markup', () => {
  const out = mdToHtml('<img src=x onerror=alert(1)>');
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));

  const out2 = mdToHtml('<script>alert(1)</script>');
  assert.ok(!out2.includes('<script>'));
  assert.ok(out2.includes('&lt;script&gt;alert(1)&lt;/script&gt;'));
});

test('javascript: URLs never become anchors (http(s) only linkify)', () => {
  const out = mdToHtml('click javascript:alert(1) now');
  assert.ok(!out.includes('<a href'));
  assert.ok(!out.includes('href="javascript'));
});

test('linkified URLs keep target=_blank, rel=noopener and an http(s) href', () => {
  const out = mdToHtml('see https://example.com/x?a=1&b=2 end');
  const m = out.match(/<a href="[^"]+"[^>]*>/);
  assert.ok(m, 'an anchor should be produced');
  assert.ok(out.includes('target="_blank"'));
  assert.ok(out.includes('rel="noopener noreferrer"'));
  assert.ok(m[0].startsWith('<a href="https://'));
});

test('quotes in a URL cannot break out of the href attribute', () => {
  const out = mdToHtml('http://example.com/a"onclick="alert(1)');
  assert.ok(!out.includes('"onclick='), 'no raw quote may terminate the href attribute');
  assert.ok(out.includes('&quot;'), 'the quote is escaped inside the value');
});

test('markdown features still render (bold, inline code, table, fence, headings)', () => {
  const out = mdToHtml('**bold** and `code`');
  assert.ok(out.includes('<b>bold</b>'));
  assert.ok(out.includes('<code class="inline">code</code>'));

  const table = mdToHtml('| a | b |\n|---|---|\n| 1 | 2 |');
  assert.ok(table.includes('<table class="md-table">'));
  assert.ok(table.includes('<td>1</td>'));

  const fence = mdToHtml('```js\nconst x = 1;\n```');
  assert.ok(fence.includes('<div class="codebox">'));
  assert.ok(fence.includes('<pre><code>const x = 1;'));
  assert.ok(fence.includes('</code></pre>'));

  assert.ok(mdToHtml('## Head').includes('<h2>Head</h2>'));
  assert.ok(mdToHtml('### Sub').includes('<h3>Sub</h3>'));
});

test('fenced code content is escaped (skill body vector)', () => {
  const out = mdToHtml('```html\n<img src=x onerror=alert(1)>\n```');
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('<pre><code>&lt;img src=x onerror=alert(1)&gt;'));
});

test('table cell HTML is escaped', () => {
  const out = mdToHtml('| <img src=x onerror=alert(1)> |\n|---|\n| a |');
  assert.ok(out.includes('<table class="md-table">'));
  assert.ok(!out.includes('<img'));
  assert.ok(out.includes('&lt;img src=x onerror=alert(1)&gt;'));
});

test('literal CODE placeholder in model output does not crash rendering', () => {
  const out = mdToHtml('prefix \u0000CODE7\u0000 suffix');
  assert.ok(!out.includes('\u0000CODE7'));
  assert.ok(out.includes('prefix'));
  assert.ok(out.includes('suffix'));
});

test('real fence placeholders still expand when mixed with a literal fake', () => {
  const out = mdToHtml('```\nreal\n```\nfake: \u0000CODE9\u0000');
  assert.ok(out.includes('<pre><code>real'));
  assert.ok(!out.includes('\u0000CODE9'));
});
