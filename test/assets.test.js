// Discovered-asset mirroring: extraction from real fixtures, replay routes,
// and the external-beacon strip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractAssetRefs } from "../src/collector.js";
import { assetFeedId, assetContentType, EXCLUDED_ASSET_PATHS } from "../src/feeds.js";
import { patchCodexHtml, patchDengHtml } from "../src/replay.js";
import { openArchive } from "../src/db.js";
import { startServer } from "../src/server.js";

const FIXTURES = fileURLToPath(new URL("./fixtures/", import.meta.url));

test("extractAssetRefs finds refs in every quoting form the real pages use", () => {
  const codex = readFileSync(join(FIXTURES, "codexradar.html"), "utf8");
  const deng = readFileSync(join(FIXTURES, "deng.html"), "utf8");

  const codexPaths = new Set(extractAssetRefs(codex).map((r) => r.path));
  assert.ok(codexPaths.has("assets/tibo-x-avatar.jpg"), 'src="..." form');

  const dengRefs = extractAssetRefs(deng);
  const dengPaths = new Set(dengRefs.map((r) => r.path));
  assert.ok(dengPaths.has("assets/orbs/terra-transparent.png"), "src='...' JS-string form");
  assert.ok(dengPaths.has("assets/bikes/ladder-mountain.png"), 'url("...") CSS form');

  const orb = dengRefs.find((r) => r.path === "assets/orbs/terra-transparent.png");
  assert.equal(orb.query, "?v=2", "cache-buster query preserved");

  for (const r of [...extractAssetRefs(codex), ...dengRefs]) {
    assert.ok(r.path.startsWith("assets/"));
    assert.ok(!r.path.includes(".."));
  }
});

test("extractAssetRefs dedups by path and ignores traversal", () => {
  const html = `<img src="assets/a.png?v=1"><img src="assets/a.png?v=1">
    <img src='assets/../secret.png'> <div style='background:url(assets/b.css)'>`;
  const refs = extractAssetRefs(html);
  assert.deepEqual(
    refs.map((r) => r.path).sort(),
    ["assets/a.png", "assets/b.css"]
  );
});

test("assetContentType maps extensions and defaults safely", () => {
  assert.equal(assetContentType("assets/x.png"), "image/png");
  assert.equal(assetContentType("assets/dir/y.jpg"), "image/jpeg");
  assert.equal(assetContentType("assets/unknown.bin"), "application/octet-stream");
  assert.equal(assetContentType("assets/noext"), "application/octet-stream");
});

test("removed QR/community asset paths are excluded for every swept site", () => {
  for (const path of [
    "assets/codex-radar-group-qrcode-20260729.jpg",
    "assets/codex-radar-group-qrcode-20260731.jpg",
    "assets/wechat-qrcode.jpg",
    "assets/community/official-account.png",
    "assets/community/wechat-group.jpg",
  ]) assert.equal(EXCLUDED_ASSET_PATHS.has(path), true, path);
});

test("server replays swept assets at /assets/* and /deng/assets/*", async () => {
  const dir = mkdtempSync(join(tmpdir(), "dradar2-assets-"));
  const archive = openArchive(dir);
  const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 1, 2, 3]);
  archive.saveCapture({
    feed: assetFeedId("codex", "assets/tibo-x-avatar.jpg"),
    capturedAt: new Date().toISOString(),
    body: Buffer.from("jpegbytes"),
    contentType: "image/jpeg",
  });
  archive.saveCapture({
    feed: assetFeedId("deng", "assets/orbs/terra-transparent.png"),
    capturedAt: new Date().toISOString(),
    body: png,
    contentType: "image/png",
  });
  archive.close();

  const srv = await startServer({ port: 0, bind: "127.0.0.1", dataDir: dir });
  try {
    const base = `http://127.0.0.1:${srv.port}`;

    const jpg = await fetch(`${base}/assets/tibo-x-avatar.jpg`);
    assert.equal(jpg.status, 200);
    assert.equal(jpg.headers.get("content-type"), "image/jpeg");
    assert.equal(await jpg.text(), "jpegbytes");

    // cache-buster query is ignored; bytes come from the archive
    const orb = await fetch(`${base}/deng/assets/orbs/terra-transparent.png?v=2`);
    assert.equal(orb.status, 200);
    assert.equal(orb.headers.get("content-type"), "image/png");
    assert.deepEqual(Buffer.from(await orb.arrayBuffer()), png);

    const missing = await fetch(`${base}/assets/never-seen.png`);
    assert.equal(missing.status, 404);
  } finally {
    await srv.close();
    rmSync(dir, { recursive: true, force: true });
  }
});

test("patchCodexHtml strips the Cloudflare RUM beacon", () => {
  const codex = readFileSync(join(FIXTURES, "codexradar.html"), "utf8");
  assert.ok(codex.includes("static.cloudflareinsights.com"), "fixture has the beacon");
  const out = patchCodexHtml(codex, {
    feedId: "codex:html",
    capturedAt: "2026-07-31T00:00:00.000Z",
    at: null,
  });
  assert.ok(!out.includes("cloudflareinsights.com"), "beacon removed from replay");
});

test("removed QR/community assets are excluded from replay markup", () => {
  const codex = readFileSync(join(FIXTURES, "codexradar.html"), "utf8");
  const deng = readFileSync(join(FIXTURES, "deng.html"), "utf8");
  const ctx = { feedId: "test", capturedAt: "2026-07-31T00:00:00.000Z", at: null };
  const codexOut = patchCodexHtml(codex, ctx);
  const dengOut = patchDengHtml(deng, ctx);
  for (const path of [
    "codex-radar-group-qrcode-20260729.jpg",
    "codex-radar-group-qrcode-20260731.jpg",
    "wechat-qrcode.jpg",
    "community/official-account.png",
    "community/wechat-group.jpg",
  ]) {
    assert.equal(codexOut.includes(path) || dengOut.includes(path), false, `${path} removed`);
  }
});

test("unchanged asset bytes are deduplicated across cache-buster updates", () => {
  const dir = mkdtempSync(join(tmpdir(), "dradar2-asset-dedup-"));
  const archive = openArchive(dir);
  const feed = assetFeedId("deng", "assets/orbs/terra-transparent.png");
  const body = Buffer.from("same-image-bytes");
  const first = archive.saveCapture({ feed, capturedAt: "2026-07-31T00:00:00.000Z", body });
  const second = archive.saveCapture({ feed, capturedAt: "2026-07-31T01:00:00.000Z", body });
  assert.equal(first.changed, true);
  assert.equal(second.changed, false);
  assert.equal(second.deduped, true);
  assert.equal(archive.feedsSummary().find((row) => row.feed === feed).versions, 1);
  archive.close();
  rmSync(dir, { recursive: true, force: true });
});
