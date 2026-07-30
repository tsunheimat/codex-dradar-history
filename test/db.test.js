// Tests for src/db.js (the Archive store). Contract: SPEC §2 + schema.sql.
// All temp dirs via mkdtempSync — never ./data. No network.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import crypto from 'node:crypto';

import { openArchive } from '../src/db.js';

function tmpArchive() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'dradar2-db-'));
  const archive = openArchive(dir);
  return { dir, archive };
}
function done(dir, archive) {
  try { archive.close(); } catch { /* ignore */ }
  fs.rmSync(dir, { recursive: true, force: true });
}
const sha256 = (buf) => crypto.createHash('sha256').update(buf).digest('hex');

test('saveCapture: first insert reports changed and correct hash', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = Buffer.from('hello-v1');
    const r = archive.saveCapture({ feed: 'x', capturedAt: '2026-07-20T00:00:00.000Z', body });
    assert.equal(r.changed, true);
    assert.equal(r.deduped ?? false, false);
    assert.equal(r.hash, sha256(body));

    // Blob round-trips through gzip.
    assert.deepEqual(archive.captureBody(r.hash), body);

    const versions = archive.listVersions('x');
    assert.equal(versions.length, 1);
    assert.equal(versions[0].captureCount, 1);
    assert.equal(versions[0].bytes, body.length);
  } finally { done(dir, archive); }
});

test('saveCapture: identical body dedups into the same state period', () => {
  const { dir, archive } = tmpArchive();
  try {
    const body = Buffer.from('same-bytes');
    const r1 = archive.saveCapture({ feed: 'x', capturedAt: '2026-07-20T00:00:00.000Z', body });
    const r2 = archive.saveCapture({ feed: 'x', capturedAt: '2026-07-20T00:10:00.000Z', body });
    assert.equal(r1.changed, true);
    assert.equal(r2.changed, false);
    assert.equal(r2.deduped, true);
    assert.equal(r1.hash, r2.hash);

    const versions = archive.listVersions('x');
    assert.equal(versions.length, 1, 'identical polls extend one period, not a new version');
    assert.equal(versions[0].captureCount, 2);
    assert.equal(versions[0].lastAt, '2026-07-20T00:10:00.000Z', 'last_at advanced to the newer poll');
    assert.equal(versions[0].firstAt, '2026-07-20T00:00:00.000Z');

    const latest = archive.latestCapture('x');
    assert.equal(latest.lastAt, '2026-07-20T00:10:00.000Z');
  } finally { done(dir, archive); }
});

test('saveCapture: a different body opens a new version', () => {
  const { dir, archive } = tmpArchive();
  try {
    archive.saveCapture({ feed: 'x', capturedAt: '2026-07-20T00:00:00.000Z', body: Buffer.from('A') });
    const r = archive.saveCapture({ feed: 'x', capturedAt: '2026-07-21T00:00:00.000Z', body: Buffer.from('B') });
    assert.equal(r.changed, true);
    assert.equal(r.deduped ?? false, false);
    assert.equal(archive.listVersions('x').length, 2);
  } finally { done(dir, archive); }
});

test('saveCapture: storeRaw=false with a changed hash records change but stores nothing', () => {
  const { dir, archive } = tmpArchive();
  try {
    // Seed one real version.
    archive.saveCapture({ feed: 'sampled', capturedAt: '2026-07-20T00:00:00.000Z', body: Buffer.from('base') });
    const before = archive.listVersions('sampled').length;

    const changedBody = Buffer.from('different-but-sampled-away');
    const r = archive.saveCapture({
      feed: 'sampled', capturedAt: '2026-07-20T00:05:00.000Z', body: changedBody, storeRaw: false,
    });
    assert.equal(r.changed, true);
    assert.equal(r.deduped, false);

    // No new capture row, and the sampled-away body is not persisted.
    assert.equal(archive.listVersions('sampled').length, before, 'no version row inserted when storeRaw=false');
    assert.equal(archive.captureBody(sha256(changedBody)), null, 'blob not stored when storeRaw=false');
  } finally { done(dir, archive); }
});

test('latestCapture: at-semantics (before-first, between, after-last)', () => {
  const { dir, archive } = tmpArchive();
  try {
    const T1 = '2026-07-20T00:00:00.000Z';
    const T2 = '2026-07-25T00:00:00.000Z';
    archive.saveCapture({ feed: 'ff', capturedAt: T1, body: Buffer.from('V1') });
    archive.saveCapture({ feed: 'ff', capturedAt: T2, body: Buffer.from('V2') });

    // null → newest
    assert.equal(archive.latestCapture('ff').firstAt, T2);

    // between T1 and T2 → newest with first_at <= at → V1
    const between = archive.latestCapture('ff', '2026-07-22T00:00:00.000Z');
    assert.equal(between.firstAt, T1);

    // after T2 → V2
    const after = archive.latestCapture('ff', '2026-07-28T00:00:00.000Z');
    assert.equal(after.firstAt, T2);

    // before first data → oldest row, detectable via firstAt > atIso
    const before = archive.latestCapture('ff', '2026-07-01T00:00:00.000Z');
    assert.equal(before.firstAt, T1, 'before-history returns the oldest row so something still renders');
    assert.ok(before.firstAt > '2026-07-01T00:00:00.000Z', 'caller can detect before-history via firstAt > at');

    // unknown feed → null
    assert.equal(archive.latestCapture('nope'), null);
  } finally { done(dir, archive); }
});

test('upsertCellState: new / same-hash / changed-hash transitions', () => {
  const { dir, archive } = tmpArchive();
  try {
    const cellKey = 't|m|e';
    assert.equal(archive.latestCellHash(cellKey), null);

    const a = archive.upsertCellState({ cellKey, payloadJson: '{"st":"a"}', hash: 'h1', seenAt: '2026-07-20T00:00:00.000Z' });
    assert.equal(a, true, 'first observation inserts');
    assert.equal(archive.latestCellHash(cellKey), 'h1');

    const b = archive.upsertCellState({ cellKey, payloadJson: '{"st":"a"}', hash: 'h1', seenAt: '2026-07-20T01:00:00.000Z' });
    assert.equal(b, false, 'same hash only extends last_seen');
    assert.equal(archive.latestCellHash(cellKey), 'h1');

    const c = archive.upsertCellState({ cellKey, payloadJson: '{"st":"b"}', hash: 'h2', seenAt: '2026-07-21T00:00:00.000Z' });
    assert.equal(c, true, 'changed hash inserts a new state period');
    assert.equal(archive.latestCellHash(cellKey), 'h2');

    const hist = archive.queryCellHistory({ taskId: 't', model: 'm', effort: 'e' });
    assert.equal(hist.length, 2, 'two state periods, oldest first');
    assert.equal(hist[0].hash, 'h1');
    assert.equal(hist[0].last_seen ?? hist[0].lastSeen, '2026-07-20T01:00:00.000Z');
    assert.equal(hist[1].hash, 'h2');
  } finally { done(dir, archive); }
});

test('runs audit + pruneRuns + feed_state upsert', () => {
  const { dir, archive } = tmpArchive();
  try {
    // Fresh state is absent.
    assert.equal(archive.getFeedState('codex:current'), null);

    archive.setFeedState('codex:current', { etag: 'W/"1"', failCount: 0, backoffUntil: null, lastOkAt: '2026-07-20T00:00:00.000Z' });
    const st = archive.getFeedState('codex:current');
    assert.equal(st.etag, 'W/"1"');
    assert.equal(st.failCount, 0);
    assert.equal(st.lastOkAt, '2026-07-20T00:00:00.000Z');

    // Partial update leaves other fields intact.
    archive.setFeedState('codex:current', { failCount: 2 });
    assert.equal(archive.getFeedState('codex:current').failCount, 2);
    assert.equal(archive.getFeedState('codex:current').etag, 'W/"1"', 'partial setFeedState keeps prior etag');

    const oldRun = '2000-01-01T00:00:00.000Z';
    const newRun = new Date().toISOString();
    archive.recordRun({ feed: 'codex:current', startedAt: oldRun, ok: true, httpStatus: 200, durationMs: 10, changed: true, bytes: 100 });
    archive.recordRun({ feed: 'codex:current', startedAt: newRun, ok: false, httpStatus: 500, error: 'boom', durationMs: 5, changed: false, bytes: 0 });

    const recent = archive.recentRuns({ feed: 'codex:current', limit: 10 });
    assert.equal(recent.length, 2);
    // newest first
    assert.equal(recent[0].startedAt ?? recent[0].started_at, newRun);

    archive.pruneRuns(30); // drops the year-2000 run
    const afterPrune = archive.recentRuns({ feed: 'codex:current', limit: 10 });
    assert.equal(afterPrune.length, 1, 'pruneRuns removed the stale run');
  } finally { done(dir, archive); }
});

test('feedsSummary + dbStats reflect stored captures', () => {
  const { dir, archive } = tmpArchive();
  try {
    archive.saveCapture({ feed: 'codex:html', capturedAt: '2026-07-20T00:00:00.000Z', body: Buffer.from('page-v1') });
    archive.saveCapture({ feed: 'codex:html', capturedAt: '2026-07-21T00:00:00.000Z', body: Buffer.from('page-v2') });

    const summary = archive.feedsSummary();
    const row = summary.find((r) => r.feed === 'codex:html');
    assert.ok(row, 'feed appears in summary');
    assert.equal(row.versions, 2);

    const stats = archive.dbStats();
    assert.ok(stats.dbBytes > 0);
    assert.ok(stats.blobCount >= 2);
    assert.ok(stats.tables && typeof stats.tables === 'object');
  } finally { done(dir, archive); }
});
