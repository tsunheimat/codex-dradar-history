// Discovered-asset mirroring: extraction from real fixtures, replay routes,
// and the external-beacon strip.
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { extractAssetRefs } from "../src/collector.js";
import { assetFeedId, assetContentType } from "../src/feeds.js";
import { patchCodexHtml } from "../src/replay.js";
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
