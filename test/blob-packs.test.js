import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { openArchive } from "../src/db.js";

const HTML_CT = "text/html; charset=utf-8";
const BASE_MS = Date.parse("2026-08-01T00:00:00.000Z");

function htmlBody(i) {
  // shared "page shell" plus a small changing data region, like the real feeds
  return Buffer.from(
    `<html><head>${"shell ".repeat(200)}</head><body>data=${i} ${"x".repeat(64)}</body></html>`
  );
}

function saveVersions(archive, feed, bodies, contentType = HTML_CT, startIdx = 0) {
  return bodies.map((body, i) =>
    archive.saveCapture({
      feed,
      capturedAt: new Date(BASE_MS + (startIdx + i) * 60000).toISOString(),
      body,
      contentType,
    })
  );
}

function packState(archive, hash) {
  return archive.db
    .prepare("SELECT pack_id AS packId, LENGTH(body_gz) AS gzLen FROM blobs WHERE hash=?")
    .get(hash);
}

test("packBlobs moves older text blobs into a pack and round-trips exactly", () => {
  const dir = mkdtempSync(join(tmpdir(), "dradar2-packs-"));
  const archive = openArchive(dir);
  try {
    const bodies = Array.from({ length: 8 }, (_, i) => htmlBody(i));
    const caps = saveVersions(archive, "codex:html", bodies);
    const png = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47]), Buffer.alloc(600, 7)]);
    const pngCap = saveVersions(archive, "codex:asset:assets/a.png", [png], "image/png")[0];
    const summaryBefore = archive.feedsSummary();

    const res = archive.packBlobs();
    assert.equal(res.blobs, 6, "all but the newest 2 versions are packed");
    assert.equal(res.packs, 1);

    for (let i = 0; i < 6; i++) {
      const st = packState(archive, caps[i].hash);
      assert.ok(st.packId != null, `version ${i} is packed`);
      assert.equal(st.gzLen, 0, `version ${i} gzip body is emptied`);
    }
    for (let i = 6; i < 8; i++) {
      assert.equal(packState(archive, caps[i].hash).packId, null, `version ${i} stays gzipped`);
    }
    assert.equal(packState(archive, pngCap.hash).packId, null, "image blobs are never packed");

    for (let i = 0; i < 8; i++) {
      assert.deepEqual(archive.captureBody(caps[i].hash), bodies[i], `version ${i} round-trips`);
    }
    assert.deepEqual(archive.captureBody(pngCap.hash), png);

    // packing must not change the logical view of the archive
    assert.deepEqual(archive.feedsSummary(), summaryBefore);
    const stats = archive.dbStats();
    assert.equal(stats.packCount, 1);
    assert.ok(stats.packBytes > 0);

    // idempotent: a second run with nothing new packs nothing
    assert.equal(archive.packBlobs().blobs, 0);
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("packBlobs appends to the open pack instead of creating new ones", () => {
  const dir = mkdtempSync(join(tmpdir(), "dradar2-packs-"));
  const archive = openArchive(dir);
  try {
    const first = Array.from({ length: 5 }, (_, i) => htmlBody(i));
    const caps1 = saveVersions(archive, "deng:html", first);
    archive.packBlobs();

    const more = Array.from({ length: 4 }, (_, i) => htmlBody(100 + i));
    const caps2 = saveVersions(archive, "deng:html", more, HTML_CT, 5);
    const res = archive.packBlobs();
    assert.ok(res.blobs > 0);
    assert.equal(
      archive.db.prepare("SELECT COUNT(*) AS c FROM blob_packs").get().c,
      1,
      "still a single (rewritten) open pack"
    );

    for (let i = 0; i < first.length; i++) {
      assert.deepEqual(archive.captureBody(caps1[i].hash), first[i]);
    }
    for (let i = 0; i < more.length; i++) {
      assert.deepEqual(archive.captureBody(caps2[i].hash), more[i]);
    }
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("packBlobs seals packs at the raw-byte target", () => {
  const dir = mkdtempSync(join(tmpdir(), "dradar2-packs-"));
  const archive = openArchive(dir);
  try {
    const bodies = Array.from({ length: 6 }, (_, i) => htmlBody(i));
    const caps = saveVersions(archive, "codex:html", bodies);
    archive.packBlobs({ targetRawBytes: 2 * bodies[0].length + 10, keepLatest: 0 });

    const packs = archive.db.prepare("SELECT id, sealed, raw_bytes FROM blob_packs ORDER BY id").all();
    assert.ok(packs.length >= 2, "target forces multiple packs");
    assert.ok(packs.some((p) => p.sealed === 1), "at least one pack sealed");
    for (let i = 0; i < bodies.length; i++) {
      assert.deepEqual(archive.captureBody(caps[i].hash), bodies[i]);
    }
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("a read-only connection serves packed bodies, surviving open-pack rewrites", () => {
  const dir = mkdtempSync(join(tmpdir(), "dradar2-packs-"));
  const writer = openArchive(dir);
  let reader = null;
  try {
    const first = Array.from({ length: 5 }, (_, i) => htmlBody(i));
    const caps1 = saveVersions(writer, "codex:html", first);
    writer.packBlobs();

    reader = openArchive(dir, { readonly: true });
    // warm the reader's pack cache with the current (shorter) open pack
    assert.deepEqual(reader.captureBody(caps1[0].hash), first[0]);

    // writer appends to the same open pack → reader's cached copy is stale
    const more = Array.from({ length: 3 }, (_, i) => htmlBody(50 + i));
    const caps2 = saveVersions(writer, "codex:html", more, HTML_CT, 5);
    writer.packBlobs();

    const packedNow = writer.db
      .prepare("SELECT hash FROM blobs WHERE pack_id IS NOT NULL")
      .all()
      .map((r) => r.hash);
    assert.ok(packedNow.includes(caps1[4].hash), "previously-latest version got packed");
    // stale-cache guard: offset beyond the cached buffer forces a refetch
    assert.deepEqual(reader.captureBody(caps1[4].hash), first[4]);
    assert.deepEqual(reader.captureBody(caps1[0].hash), first[0]);
    for (const [i, cap] of caps2.entries()) {
      const viaReader = reader.captureBody(cap.hash);
      assert.deepEqual(viaReader, more[i]);
    }
  } finally {
    if (reader) reader.close();
    writer.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
