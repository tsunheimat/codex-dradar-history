// One-time archive compaction: re-encode existing lossless comic tiles to the
// current quality-90 WebP setting, pack historical text blobs into per-feed
// brotli packs, then checkpoint + VACUUM to return the space to the OS.
//
// Safe to re-run (lossless tiles are detected by their VP8L chunk; the packer
// is idempotent). SQLite serializes writers, so this can run alongside the
// collector, but VACUUM needs a quiet moment — stop the collector if the final
// step reports the database is busy.
import sharp from "sharp";
import { loadConfig } from "../src/config.js";
import { openArchive } from "../src/db.js";
import { encodeTileWebp, isLosslessWebp } from "../src/image-tiles.js";

const MB = (n) => `${(n / 1048576).toFixed(2)} MB`;

async function main() {
  const config = loadConfig();
  const archive = openArchive(config.dataDir);
  archive.db.exec("PRAGMA busy_timeout=60000;");
  const before = archive.dbStats();

  // 1. lossless → q90 tiles (keep whichever encoding is smaller)
  const tiles = archive.db.prepare("SELECT hash, body FROM image_tiles").all();
  const upd = archive.db.prepare("UPDATE image_tiles SET body=?, bytes=? WHERE hash=?");
  let reencoded = 0;
  let tileSaved = 0;
  for (const t of tiles) {
    const body = Buffer.from(t.body);
    if (!isLosslessWebp(body)) continue;
    const { data, info } = await sharp(body).raw().toBuffer({ resolveWithObject: true });
    const encoded = await encodeTileWebp(data, info);
    if (encoded.length >= body.length) continue;
    upd.run(encoded, encoded.length, t.hash);
    reencoded++;
    tileSaved += body.length - encoded.length;
  }
  console.log(`tiles: ${reencoded}/${tiles.length} re-encoded to q90, saved ${MB(tileSaved)}`);

  // 2. pack historical text blobs
  const p = archive.packBlobs();
  console.log(
    `blobs: packed ${p.blobs} from ${p.feeds} feeds → ${p.packs} pack writes, ` +
    `${MB(p.rawBytes)} raw → ${MB(p.packedBytes)} brotli`
  );

  // 3. reclaim space
  archive.db.exec("PRAGMA wal_checkpoint(TRUNCATE);");
  try {
    archive.db.exec("VACUUM;");
  } catch (err) {
    console.warn(`VACUUM skipped (${err.message}) — rerun while the collector is idle to reclaim space`);
  }

  const after = archive.dbStats();
  console.log(`database: ${MB(before.dbBytes)} → ${MB(after.dbBytes)}`);
  archive.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
