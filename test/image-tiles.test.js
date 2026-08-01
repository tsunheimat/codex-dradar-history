import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import sharp from "sharp";

import { openArchive } from "../src/db.js";
import { composeTiledPng, isLosslessWebp, tileComicPng } from "../src/image-tiles.js";

async function fixturePng() {
  const width = 512;
  const height = 512;
  const raw = Buffer.alloc(width * height * 4, 0);
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const i = (y * width + x) * 4;
      raw[i] = 12;
      raw[i + 1] = 34;
      raw[i + 2] = 56;
      raw[i + 3] = 255;
    }
  }
  // A small dynamic region changes only one tile.
  for (let y = 20; y < 40; y++) {
    for (let x = 270; x < 290; x++) {
      const i = (y * width + x) * 4;
      raw[i] = 240;
      raw[i + 1] = 100;
      raw[i + 2] = 20;
    }
  }
  return sharp(raw, { raw: { width, height, channels: 4 } }).png().toBuffer();
}

test("tile/composition round-trip stays visually faithful (q90 lossy tiles)", async () => {
  const original = await fixturePng();
  const tiled = await tileComicPng(original);
  assert.equal(tiled.tiles.length, 4);
  // Hashes are computed on the decoded source pixels, so identical source
  // tiles still dedup to one hash even though the stored encoding is lossy.
  assert.equal(new Set(tiled.tiles.map((tile) => tile.hash)).size, 2);
  for (const tile of tiled.tiles) {
    assert.equal(isLosslessWebp(tile.body), false, "tiles are stored as lossy WebP");
  }
  const composed = await composeTiledPng(tiled, (hash) => {
    const tile = tiled.tiles.find((entry) => entry.hash === hash);
    return tile?.body || null;
  });
  const expected = await sharp(original).ensureAlpha().raw().toBuffer();
  const actual = await sharp(composed).ensureAlpha().raw().toBuffer();
  assert.equal(actual.length, expected.length);
  let sum = 0;
  let max = 0;
  for (let i = 0; i < expected.length; i++) {
    const d = Math.abs(actual[i] - expected[i]);
    sum += d;
    if (d > max) max = d;
  }
  const avg = sum / expected.length;
  assert.ok(avg < 4, `average per-channel error too high: ${avg.toFixed(3)}`);
  assert.ok(max <= 96, `max per-channel error too high: ${max}`);
});

test("isLosslessWebp distinguishes VP8L from lossy encodings", async () => {
  const raw = Buffer.alloc(64 * 64 * 3, 128);
  const opts = { raw: { width: 64, height: 64, channels: 3 } };
  const lossless = await sharp(raw, opts).webp({ lossless: true }).toBuffer();
  const lossy = await sharp(raw, opts).webp({ quality: 90 }).toBuffer();
  assert.equal(isLosslessWebp(lossless), true);
  assert.equal(isLosslessWebp(lossy), false);
  assert.equal(isLosslessWebp(Buffer.from("not a webp")), false);
});

test("saveImageCapture stores one shared tile and a small manifest", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dradar2-image-tiles-"));
  const archive = openArchive(dir);
  try {
    const tiles = await tileComicPng(await fixturePng());
    const first = archive.saveImageCapture({
      feed: "codex:asset:assets/radar-high-readout-comic-20260801-0336.png",
      capturedAt: "2026-08-01T00:00:00.000Z",
      tiles,
    });
    const second = archive.saveImageCapture({
      feed: "codex:asset:assets/radar-high-readout-comic-20260801-0336.png",
      capturedAt: "2026-08-01T00:01:00.000Z",
      tiles,
    });
    assert.equal(first.changed, true);
    assert.equal(second.deduped, true);
    const manifest = archive.imageManifest(first.hash);
    assert.equal(manifest.tiles.length, 4);
    assert.deepEqual(archive.captureBody(first.hash), archive.captureBody(second.hash));
    assert.ok(archive.imageTileBody(manifest.tiles[0].hash).length > 0);
  } finally {
    archive.close();
    rmSync(dir, { recursive: true, force: true });
  }
});
