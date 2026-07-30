// Tests for src/extractors.js against the real captured fixtures. Contract: SPEC §5.
// Expected counts are computed FROM the fixtures where possible, not hard-guessed.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

import { openArchive } from '../src/db.js';
import { runExtractor } from '../src/extractors.js';

const FIX = path.join(import.meta.dirname, 'fixtures');
const load = (name) => fs.readFileSync(path.join(FIX, name));
const loadJson = (name) => JSON.parse(load(name).toString('utf8'));

function tmpArchive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dradar2-ex-'));
  const archive = openArchive(dir);
  return { dir, archive };
}
function done(dir, archive) {
  try { archive.close(); } catch { /* ignore */ }
  fs.rmSync(dir, { recursive: true, force: true });
}
const ISO = '2026-07-31T00:00:00.000Z';

test('iq: inserts every scored point once, is idempotent, 46 series', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = load('deng-iq-history.json');
    const raw = loadJson('deng-iq-history.json');
    const seriesNames = Object.keys(raw).filter((k) => Array.isArray(raw[k]));
    const expectedPoints = seriesNames.reduce(
      (acc, k) => acc + raw[k].filter((p) => p && typeof p.score === 'number').length, 0);

    const first = runExtractor('iq', archive, body, ISO);
    assert.equal(first.changed, expectedPoints);

    const second = runExtractor('iq', archive, body, ISO);
    assert.equal(second.changed, 0, 're-running the same payload inserts nothing');

    const series = archive.listIqSeries();
    assert.equal(series.length, seriesNames.length);
    assert.equal(series.length, 46, 'fixture has 46 IQ series');
  } finally { done(dir, archive); }
});

test('events: dedups on PK, first event nickname is JJ-Lin', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = load('deng-events.json');
    const raw = loadJson('deng-events.json');

    const first = runExtractor('events', archive, body, ISO);
    assert.equal(first.changed, raw.events.length);

    const second = runExtractor('events', archive, body, ISO);
    assert.equal(second.changed, 0);

    const all = archive.queryEvents({});
    assert.equal(all.total, raw.events.length);

    const jj = archive.queryEvents({ nickname: 'JJ-Lin' });
    assert.ok(jj.total >= 1, 'the JJ-Lin event is present');
    assert.equal(raw.events[0].nickname, 'JJ-Lin', 'sanity: fixture first event is JJ-Lin');
  } finally { done(dir, archive); }
});

test('cells: inserts each cell + task once, idempotent', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = load('deng-table.json');
    const raw = loadJson('deng-table.json');
    const cellCount = Object.keys(raw.cells).length;
    const taskCount = raw.tasks.length;

    const first = runExtractor('cells', archive, body, ISO);
    assert.equal(first.changed, cellCount, 'every cell is a change on first sight');

    const second = runExtractor('cells', archive, body, ISO);
    assert.equal(second.changed, 0, 'unchanged cells re-hash to no change');

    assert.equal(archive.listDengTasks().length, taskCount);
  } finally { done(dir, archive); }
});

test('ratings: flattens current + history days, idempotent second run', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = load('model-ratings.json');
    const raw = loadJson('model-ratings.json');
    // Distinct (Asia/Shanghai) days across current + history; in this fixture today
    // already appears inside history, so the union is what we assert against.
    const expectedDays = new Set([raw.day, ...raw.history.map((h) => h.day)]);

    runExtractor('ratings', archive, body, ISO);
    const second = runExtractor('ratings', archive, body, ISO);
    assert.equal(second.changed, 0, 're-running identical ratings changes nothing');

    const rows = archive.queryRatings({ fromDay: '2000-01-01', toDay: '2100-01-01' });
    const days = new Set(rows.map((r) => r.day));
    assert.equal(days.size, expectedDays.size);
    assert.ok(days.has(raw.day), 'current day is stored');
  } finally { done(dir, archive); }
});

test('subscribers: stores a point only when the count moves', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = load('subscriber-count.json');
    const count = loadJson('subscriber-count.json').count;

    const first = runExtractor('subscribers', archive, body, ISO);
    assert.equal(first.changed, 1, 'first sample is a change vs no prior value');

    const second = runExtractor('subscribers', archive, body, '2026-07-31T00:10:00.000Z');
    assert.equal(second.changed, 0, 'same count later is not a new sample');

    const subs = archive.querySubscribers({ fromIso: '2000-01-01T00:00:00.000Z', toIso: '2100-01-01T00:00:00.000Z' });
    assert.equal(subs.length, 1);
    assert.equal(subs[0].count, count);
  } finally { done(dir, archive); }
});

test('rss: extracts every <item> once', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = load('feed.xml');
    const expectedItems = (load('feed.xml').toString('utf8').match(/<item[\s>]/g) || []).length;
    assert.ok(expectedItems > 0, 'fixture actually has items');

    const first = runExtractor('rss', archive, body, ISO);
    assert.equal(first.changed, expectedItems);

    const second = runExtractor('rss', archive, body, ISO);
    assert.equal(second.changed, 0);

    assert.equal(archive.dbStats().tables.rss_items, expectedItems);
  } finally { done(dir, archive); }
});

test('dengstats: always samples one row per poll (not idempotent by design)', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = load('deng-leaderboard.json');

    const first = runExtractor('dengstats', archive, body, '2026-07-31T00:00:00.000Z');
    assert.equal(first.changed, 1);

    // A later poll of the same payload is still a distinct time-series sample.
    const second = runExtractor('dengstats', archive, body, '2026-07-31T00:15:00.000Z');
    assert.equal(second.changed, 1, 'dengstats always records a sample');

    assert.equal(archive.dbStats().tables.deng_stats, 2, 'two polls → two rows');

    const rows = archive.queryDengStats({ fromIso: '2000-01-01T00:00:00.000Z', toIso: '2100-01-01T00:00:00.000Z' });
    assert.equal(rows.length, 2);
  } finally { done(dir, archive); }
});
