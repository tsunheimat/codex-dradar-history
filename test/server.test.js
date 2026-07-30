// End-to-end tests for src/server.js (+ replay/api-routes/history-api). Contract: SPEC §8–10, §13.
// Seeds a temp archive from the real fixtures, boots the server as a child process on a
// pre-allocated loopback port, and drives it over real HTTP. No upstream network is touched.
import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import net from 'node:net';
import path from 'node:path';
import { spawn } from 'node:child_process';

import { openArchive } from '../src/db.js';
import { runExtractor } from '../src/extractors.js';

const REPO = path.join(import.meta.dirname, '..');
const FIX = path.join(import.meta.dirname, 'fixtures');
const SERVER = path.join(REPO, 'src', 'server.js');

const SEED_TIME = '2026-07-31T00:00:00.000Z';
const CUR_T1 = '2026-07-20T00:00:00.000Z';
const CUR_T2 = '2026-07-25T00:00:00.000Z';
const CUR_BODY_A = Buffer.from('{"archive_version":1}');
const CUR_BODY_B = Buffer.from('{"archive_version":2}');

// fixture file -> [feed id, extractor|null] (mirrors SPEC §12 seeding map).
const SEED_MAP = [
  ['codexradar.html', 'codex:html', null],
  ['deng.html', 'deng:html', null],
  ['current.json', 'codex:current', null],
  ['model-ratings.json', 'codex:model-ratings', 'ratings'],
  ['radar-insights.json', 'codex:radar-insights', null],
  ['intel-eff.json', 'codex:intel-efficiency', null],
  ['intel-published.json', 'codex:intel-published', null],
  ['subscriber-count.json', 'codex:subscriber-count', 'subscribers'],
  ['feed.xml', 'codex:feed', 'rss'],
  ['codex-logo.svg', 'codex:logo', null],
  ['deng-intro.html', 'deng:intro', null],
  ['i18n.js', 'deng:i18n', null],
  ['radar-report.js', 'deng:report-js', null],
  ['deng-table.json', 'deng:table', 'cells'],
  ['deng-iq-history.json', 'deng:iq-history', 'iq'],
  ['deng-events.json', 'deng:events', 'events'],
  ['deng-leaderboard.json', 'deng:leaderboard', 'dengstats'],
];

function seedArchive(dir) {
  const archive = openArchive(dir);
  // Two older, distinct versions of codex:current so ?at= time-travel is exercised.
  archive.saveCapture({ feed: 'codex:current', capturedAt: CUR_T1, body: CUR_BODY_A });
  archive.saveCapture({ feed: 'codex:current', capturedAt: CUR_T2, body: CUR_BODY_B });
  for (const [file, feed, extractor] of SEED_MAP) {
    const body = fs.readFileSync(path.join(FIX, file));
    archive.saveCapture({ feed, capturedAt: SEED_TIME, body });
    if (extractor) runExtractor(extractor, archive, body, SEED_TIME);
  }
  archive.close();
}

function preallocPort() {
  return new Promise((resolve, reject) => {
    const s = net.createServer();
    s.on('error', reject);
    s.listen(0, '127.0.0.1', () => {
      const { port } = s.address();
      s.close(() => resolve(port));
    });
  });
}

async function waitForHealth(base, child) {
  const deadline = Date.now() + 15000;
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`server exited early (${child.exitCode})\n${stderr}`);
    try {
      const r = await fetch(`${base}/archive-api/health`);
      if (r.ok) return;
    } catch { /* not up yet */ }
    await new Promise((r) => setTimeout(r, 150));
  }
  throw new Error(`server did not become healthy in time\n${stderr}`);
}

let child;
let base;
let stderr = '';
let tmpDir;

before(async () => {
  tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'dradar2-srv-'));
  seedArchive(tmpDir);
  const port = await preallocPort();
  base = `http://127.0.0.1:${port}`;
  child = spawn(process.execPath, [SERVER], {
    cwd: REPO,
    env: { ...process.env, PORT: String(port), BIND: '127.0.0.1', DATA_DIR: tmpDir },
    stdio: ['ignore', 'ignore', 'pipe'],
  });
  child.stderr.on('data', (d) => { stderr += d.toString(); });
  await waitForHealth(base, child);
});

after(async () => {
  if (child && child.exitCode === null) {
    child.kill('SIGTERM');
    await new Promise((r) => { child.on('exit', r); setTimeout(r, 2000); });
  }
  if (tmpDir) fs.rmSync(tmpDir, { recursive: true, force: true });
});

test('GET / serves the patched codex page with the timebar', async () => {
  const r = await fetch(`${base}/`);
  assert.equal(r.status, 200);
  assert.equal(r.headers.get('x-archive'), 'dradar2');
  const html = await r.text();
  assert.ok(html.includes('/__archive/timebar.js'), 'timebar injected');
  assert.ok(html.includes('data-feed="codex:html"'), 'timebar bound to codex feed');
});

test('GET /deng/ serves the patched deng page', async () => {
  const r = await fetch(`${base}/deng/`);
  assert.equal(r.status, 200);
  const html = await r.text();
  assert.ok(html.includes('location.origin + "/deng-api"'), 'API base rewritten');
  assert.ok(!html.includes('127.0.0.1:8399'), 'localhost override removed');
  assert.ok(html.includes('data-feed="deng:html"'), 'timebar bound to deng feed');
});

test('GET /deng-api/api/v1/table returns the exact fixture bytes', async () => {
  const r = await fetch(`${base}/deng-api/api/v1/table`);
  assert.equal(r.status, 200);
  const got = Buffer.from(await r.arrayBuffer());
  const expected = fs.readFileSync(path.join(FIX, 'deng-table.json'));
  assert.ok(got.equals(expected), 'replayed table bytes equal the captured fixture');
});

test('?at= time-travel returns the version live at that instant', async () => {
  // Newest (no at) → the SEED_TIME fixture capture.
  const live = await fetch(`${base}/current.json`);
  assert.equal(live.status, 200);
  assert.equal(live.headers.get('x-archive-captured-at'), SEED_TIME);
  const liveBody = Buffer.from(await live.arrayBuffer());
  assert.ok(liveBody.equals(fs.readFileSync(path.join(FIX, 'current.json'))));

  // Between T1 and T2 → the T1 version.
  const mid = await fetch(`${base}/current.json?at=${encodeURIComponent('2026-07-22T00:00:00.000Z')}`);
  assert.equal(mid.status, 200);
  assert.equal(mid.headers.get('x-archive-captured-at'), CUR_T1);
  assert.equal(await mid.text(), CUR_BODY_A.toString('utf8'));

  // After T2 (but before SEED_TIME) → the T2 version.
  const later = await fetch(`${base}/current.json?at=${encodeURIComponent('2026-07-28T00:00:00.000Z')}`);
  assert.equal(later.status, 200);
  assert.equal(later.headers.get('x-archive-captured-at'), CUR_T2);
  assert.equal(await later.text(), CUR_BODY_B.toString('utf8'));
});

test('POST /api/subscribe is a read-only replica stub', async () => {
  const r = await fetch(`${base}/api/subscribe`, {
    method: 'POST', headers: { 'content-type': 'application/json' }, body: '{"email":"x@example.com"}',
  });
  assert.equal(r.status, 200);
  assert.deepEqual(await r.json(), { ok: false, error: 'archive replica — 订阅在存档副本中不可用' });
});

test('GET /deng-api/api/v1/whoami → 401 replica', async () => {
  const r = await fetch(`${base}/deng-api/api/v1/whoami`);
  assert.equal(r.status, 401);
  assert.deepEqual(await r.json(), { detail: 'archive replica' });
});

test('write methods against /deng-api/* → 403 read-only', async () => {
  const r = await fetch(`${base}/deng-api/api/v1/tasks/claim`, { method: 'POST' });
  assert.equal(r.status, 403);
  assert.deepEqual(await r.json(), { detail: 'read-only archive' });
});

test('GET /archive-api/health reports ok + feeds + db', async () => {
  const r = await fetch(`${base}/archive-api/health`);
  assert.equal(r.status, 200);
  const j = await r.json();
  assert.equal(j.ok, true);
  assert.ok(Array.isArray(j.feeds), 'health lists feeds');
  assert.ok(j.db && typeof j.db === 'object', 'health includes db stats');
});

test('history API smoke: iq-series non-empty and events queryable', async () => {
  const series = await fetch(`${base}/archive-api/iq-series`);
  assert.equal(series.status, 200);
  const seriesJson = await series.json();
  const seriesArr = Array.isArray(seriesJson) ? seriesJson : seriesJson.series;
  assert.ok(Array.isArray(seriesArr) && seriesArr.length > 0, 'iq-series returns rows');

  const events = await fetch(`${base}/archive-api/events?limit=5`);
  assert.equal(events.status, 200);
  const ev = await events.json();
  assert.equal(ev.total, 20, 'all 20 seeded events counted');
  assert.ok(Array.isArray(ev.rows) && ev.rows.length <= 5, 'limit honoured');
});
