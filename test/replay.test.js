// Tests for src/replay.js page patching + resolveAt. Contract: SPEC §8.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

import { resolveAt, patchCodexHtml, patchDengHtml, patchIntroHtml } from '../src/replay.js';

const FIX = path.join(import.meta.dirname, 'fixtures');
const readFix = (name) => fs.readFileSync(path.join(FIX, name), 'utf8');

// Index of the first "<script" occurring after the <head> open tag.
function firstScriptAfterHead(html) {
  const lower = html.toLowerCase();
  const headOpen = lower.search(/<head[^>]*>/);
  assert.ok(headOpen >= 0, 'page has a <head>');
  const headEnd = lower.indexOf('>', headOpen) + 1;
  return { headEnd, scriptIdx: lower.indexOf('<script', headEnd) };
}

test('resolveAt: ISO passthrough, epoch-ms, garbage → null, missing → null', () => {
  assert.equal(resolveAt({ at: '2026-07-20T00:00:00.000Z' }), new Date('2026-07-20T00:00:00.000Z').toISOString());
  assert.equal(resolveAt({ at: '1785000000000' }), new Date(1785000000000).toISOString());
  assert.equal(resolveAt({ at: 'garbage' }), null);
  assert.equal(resolveAt({ at: '' }), null);
  assert.equal(resolveAt({}), null);
});

test('patchDengHtml: API base + localhost override + backlink + timebar injection', () => {
  const html = readFix('deng.html');
  const out = patchDengHtml(html, {
    feedId: 'deng:html', capturedAt: '2026-07-31T00:00:00.000Z', at: null,
  });

  // Timebar injected exactly once, as the very first script in <head>.
  const hits = out.split('/__archive/timebar.js').length - 1;
  assert.equal(hits, 1, 'timebar injected exactly once');
  const { scriptIdx } = firstScriptAfterHead(out);
  assert.ok(out.slice(scriptIdx, scriptIdx + 200).includes('/__archive/timebar.js'),
    'timebar is the first script after <head>');
  assert.ok(out.includes('data-feed="deng:html"'), 'timebar carries the feed id');
  assert.ok(out.includes('data-captured-at="2026-07-31T00:00:00.000Z"'), 'timebar carries capturedAt');

  // API base rewritten to the local replica.
  assert.ok(out.includes('location.origin + "/deng-api"'), 'API var points at local /deng-api');
  assert.ok(!out.includes('var API = "https://api." + apex;'), 'original API assignment removed');

  // Local-dev override neutralised.
  assert.ok(!out.includes('127.0.0.1:8399'), 'localhost API override removed');

  // Backlink to codexradar.com rewritten to the local root.
  assert.ok(!out.includes('href="https://codexradar.com"'), 'upstream backlink removed');
  assert.ok(out.includes('href="/"'), 'backlink rewritten to /');
  assert.ok(out.includes('<a class="hero-link history-link" href="/history">长期历史</a>'),
    'deng nav includes the local history tab beside DRadar source');

  // The subscription-tier matrix is intentionally absent from the replay.
  assert.ok(!out.includes('<span class="tq">我的 Codex 订阅类型</span>'),
    'subscription-tier heading removed');
  assert.ok(!out.includes('class="tablebox"'), 'visible benchmark matrix removed');
  assert.ok(out.includes('id="matrix-tools" hidden'), 'inert compatibility controls remain hidden');
  assert.ok(out.indexOf('id="matrix-tools" hidden') < out.indexOf('document.getElementById("copy-setup-prompt")'),
    'compatibility controls appear before the inline page script initializes');
  assert.ok(out.includes('id="copy-setup-prompt" hidden'), 'removed participation control has an inert target');
  assert.ok(out.includes('id="lt-history" hidden'),
    'removed contributor history tab has an inert target for newer upstream scripts');
  assert.ok(out.includes('if (document.getElementById("matrix-tools").hidden) return;'),
    'table rendering exits after updating the summary widgets');
  assert.ok(!out.includes('id="contributors"'), 'contributor ladder section removed');
  assert.ok(!out.includes('class="hero-link ladder-link"'), 'ladder tab removed');
  assert.ok(!out.includes('assets/radar-report.js'), 'report asset removed with ladder/matrix UI');
  assert.ok(!out.includes('<section class="efficiency"'), 'live efficiency dashboard removed');
  assert.ok(!out.includes('正在读取价格、耗时与 IQ'), 'stale efficiency loading placeholder removed');
  assert.ok(out.includes('/api/v1/summary'), 'upper IQ footer uses aggregate summary data');

  // Runtime backlink re-derivation neutralized: syncMainSiteLinks() must not be
  // able to reassign the anchors back to the live apex on load.
  assert.ok(!out.includes('el.href = "https://" + apex'), 'runtime apex backlink assignment removed');
  assert.ok(!out.includes('iqLink.href = "https://codexradar.com"'), 'runtime iq-link assignment removed');
  assert.ok(out.includes('el.href = "/";'), 'runtime backlink repointed to /');
  assert.ok(out.includes('if (iqLink) iqLink.href = "/";'), 'runtime iq-link repointed to /');
});

test('patchDengHtml: warning injected when the API patch cannot match', () => {
  const html = '<html><head></head><body>no api assignment here</body></html>';
  const out = patchDengHtml(html, { feedId: 'deng:html', capturedAt: '2026-07-31T00:00:00.000Z', at: null });
  assert.equal(out.split('/__archive/timebar.js').length - 1, 1, 'timebar still injected once');
  assert.ok(out.includes('__DRADAR_PATCH_WARNING'), 'warning flag added when API patch fails');
});

test('patchCodexHtml: timebar injected + deng backlink rewritten', () => {
  const html = readFix('codexradar.html');
  const out = patchCodexHtml(html, {
    feedId: 'codex:html', capturedAt: '2026-07-31T00:00:00.000Z', at: null,
  });

  const hits = out.split('/__archive/timebar.js').length - 1;
  assert.equal(hits, 1, 'timebar injected exactly once');
  const { scriptIdx } = firstScriptAfterHead(out);
  assert.ok(out.slice(scriptIdx, scriptIdx + 200).includes('/__archive/timebar.js'),
    'timebar is the first script after <head>');
  assert.ok(out.includes('data-feed="codex:html"'), 'timebar carries the codex feed id');

  assert.ok(!out.includes('href="https://deng.codexradar.com"'), 'deng backlink rewritten');
  assert.ok(out.includes('href="/deng/"'), 'deng backlink now points at local clone');
  assert.ok(out.includes('<a class="site-announcement-history" href="/history">长期历史</a>'),
    'root quick links include the local history tab beside distributed radar');
});

test('patchIntroHtml: timebar-only injection', () => {
  const html = readFix('deng-intro.html');
  const out = patchIntroHtml(html, {
    feedId: 'deng:intro', capturedAt: '2026-07-31T00:00:00.000Z', at: null,
  });
  assert.equal(out.split('/__archive/timebar.js').length - 1, 1, 'timebar injected exactly once');
  assert.ok(out.includes('data-feed="deng:intro"'), 'timebar carries the intro feed id');
});
