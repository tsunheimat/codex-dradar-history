// Seed an archive from the captured fixtures for offline demo + integration
// tests. Loads each fixture as a capture (capturedAt = now) and runs its
// matching extractor. Exposes a reusable seedFixtures(dataDir, fixturesDir).
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { openArchive } from "../src/db.js";
import { getFeed } from "../src/feeds.js";
import { runExtractor } from "../src/extractors.js";

// fixture filename → feed id (per SPEC §12)
export const FIXTURE_MAP = {
  "codexradar.html": "codex:html",
  "deng.html": "deng:html",
  "current.json": "codex:current",
  "model-ratings.json": "codex:model-ratings",
  "radar-insights.json": "codex:radar-insights",
  "intel-eff.json": "codex:intel-efficiency",
  "intel-published.json": "codex:intel-published",
  "subscriber-count.json": "codex:subscriber-count",
  "feed.xml": "codex:feed",
  "codex-logo.svg": "codex:logo",
  "deng-intro.html": "deng:intro",
  "i18n.js": "deng:i18n",
  "radar-report.js": "deng:report-js",
  "deng-table.json": "deng:table",
  "deng-iq-history.json": "deng:iq-history",
  "deng-events.json": "deng:events",
  "deng-leaderboard.json": "deng:leaderboard",
};

const DEFAULT_FIXTURES_DIR = fileURLToPath(new URL("../test/fixtures", import.meta.url));

export function seedFixtures(dataDir, fixturesDir = DEFAULT_FIXTURES_DIR) {
  const archive = openArchive(dataDir);
  const results = [];
  try {
    for (const [file, feedId] of Object.entries(FIXTURE_MAP)) {
      const full = path.join(fixturesDir, file);
      let body;
      try {
        body = fs.readFileSync(full);
      } catch {
        results.push({ file, feed: feedId, skipped: true });
        continue;
      }
      const feed = getFeed(feedId);
      const capturedAt = new Date().toISOString();
      let changed = 0;
      if (feed && feed.extractor) {
        changed = runExtractor(feed.extractor, archive, body, capturedAt).changed;
      }
      const cap = archive.saveCapture({
        feed: feedId,
        capturedAt,
        body,
        httpStatus: 200,
        upstreamTs: null,
        contentType: feed ? feed.contentType : null,
        storeRaw: true,
      });
      results.push({
        file,
        feed: feedId,
        bytes: body.length,
        changed,
        hash: cap.hash,
        extractor: feed ? feed.extractor : null,
      });
    }
  } finally {
    archive.close();
  }
  return results;
}

function printSummary(results) {
  console.log("Seeded fixtures:");
  let totalBytes = 0;
  for (const r of results) {
    if (r.skipped) {
      console.log(`  ${r.file.padEnd(24)} -> ${r.feed}  (missing, skipped)`);
      continue;
    }
    totalBytes += r.bytes;
    const ex = r.extractor ? ` extractor=${r.extractor} changed=${r.changed}` : "";
    console.log(
      `  ${r.file.padEnd(24)} -> ${r.feed.padEnd(22)} ${String(r.bytes).padStart(8)}B${ex}`
    );
  }
  const loaded = results.filter((r) => !r.skipped).length;
  console.log(`Total: ${loaded} feeds, ${(totalBytes / 1024).toFixed(1)} KB.`);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  const dataDir = process.argv[2] || "./data";
  const results = seedFixtures(dataDir);
  printSummary(results);
}
