import assert from 'node:assert/strict';
import { test } from 'node:test';
import { plainTextSnippet, renderRichText } from '../public/rich-text.js';

test('allowed formatting is kept', () => {
  assert.equal(
    renderRichText('Hello<br><strong>World</strong> and <em>friends</em>'),
    'Hello<br><strong>World</strong> and <em>friends</em>',
  );
  assert.equal(renderRichText('a<BR/>b<Br>c'), 'a<br>b<br>c');
  assert.equal(
    renderRichText('<ul><li>one</li><li>two</li></ul>'),
    '<ul><li>one</li><li>two</li></ul>',
  );
});

test('http links are kept and open safely', () => {
  assert.equal(
    renderRichText('<a href="https://example.com/x?y=1">Example</a>'),
    '<a href="https://example.com/x?y=1" target="_blank" rel="noopener noreferrer">Example</a>',
  );
});

test('scripts, handlers, and unsafe links are neutralized', () => {
  assert.equal(
    renderRichText('<script>alert(1)</script>'),
    '&lt;script&gt;alert(1)&lt;/script&gt;',
  );
  assert.equal(
    renderRichText('<strong onclick="evil()">hi</strong>'),
    '<strong>hi</strong>',
  );
  assert.equal(
    renderRichText('<a href="javascript:alert(1)">click</a>'),
    'click',
  );
  assert.equal(
    renderRichText('<a href="https://example.com" onclick="evil()">x</a>'),
    '<a href="https://example.com" target="_blank" rel="noopener noreferrer">x</a>',
  );
  assert.equal(renderRichText('1 < 2 and 3 > 2'), '1 &lt; 2 and 3 &gt; 2');
});

test('bridge entities are decoded once, not twice', () => {
  assert.equal(renderRichText('R&amp;D and &lt;3'), 'R&amp;D and &lt;3');
});

test('cronjob-style bot messages render as formatted HTML', () => {
  const html = renderRichText(
    'Cronjob Response: Regal Mystery Monday movie<br>(job_id: 812d1dd2a500)<br><br><strong>Regal Mystery Movie</strong><br>• <strong>PG-13</strong>, <strong>1h 41m</strong><br><a href="https://www.regmovies.com/movies/heart-of-the-beast-ho00021867">https://www.regmovies.com/movies/heart-of-the-beast-ho00021867</a>',
  );
  assert.match(html, /Cronjob Response: Regal Mystery Monday movie<br>\(job_id: 812d1dd2a500\)<br><br>/);
  assert.match(html, /<strong>Regal Mystery Movie<\/strong>/);
  assert.match(html, /<a href="https:\/\/www\.regmovies\.com\/movies\/heart-of-the-beast-ho00021867" target="_blank" rel="noopener noreferrer">/);
});

test('snippets strip markup to a single line', () => {
  assert.equal(
    plainTextSnippet('Hello<br><strong>World</strong>  and   <a href="https://example.com">link</a>'),
    'Hello World and link',
  );
  assert.equal(plainTextSnippet('plain text'), 'plain text');
  assert.equal(plainTextSnippet('x'.repeat(200)), `${'x'.repeat(119)}…`);
});
