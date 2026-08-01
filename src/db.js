// SQLite archive store. Applies schema.sql idempotently and exposes the full
// synchronous Archive API consumed by the collector, server and history APIs.
import fs from "node:fs";
import path from "node:path";
import zlib from "node:zlib";
import crypto from "node:crypto";
import { DatabaseSync } from "node:sqlite";

function sha256(buf) {
  return crypto.createHash("sha256").update(buf).digest("hex");
}

// ---- blob packing ----------------------------------------------------------
// Consecutive versions of the text feeds differ by ~1 KB while each gzip-9 blob
// costs 60-110 KB: gzip's 32 KB window cannot see the previous version. Packing
// a feed's history into one brotli stream (lgwin=24 → 16 MB window) stores the
// shared page shell once; measured on the live archive this is ~8x smaller.
const PACK_TARGET_RAW_BYTES = 8 * 1024 * 1024; // seal a pack at ~8 MB uncompressed
const PACK_KEEP_LATEST = 2;                    // newest versions stay individually gzipped
const PACK_BROTLI_QUALITY = 9;
const PACK_CACHE_MAX_BYTES = 48 * 1024 * 1024; // decompressed-pack LRU budget
const EMPTY_BLOB = Buffer.alloc(0);

function brotliPackOptions(sizeHint) {
  return {
    params: {
      [zlib.constants.BROTLI_PARAM_QUALITY]: PACK_BROTLI_QUALITY,
      [zlib.constants.BROTLI_PARAM_LGWIN]: 24,
      [zlib.constants.BROTLI_PARAM_SIZE_HINT]: sizeHint,
    },
  };
}

// Only text-like bodies benefit from a shared window; already-compressed
// formats (png/jpeg/webp/fonts/media) stay as individual gzip blobs.
function isPackableContentType(ct) {
  if (!ct) return false;
  const t = String(ct).toLowerCase();
  return (
    t.startsWith("text/") ||
    t.includes("json") ||
    t.includes("xml") ||
    t.includes("javascript") ||
    t.includes("svg")
  );
}

// Bind-safe coercion: node:sqlite accepts null/number/bigint/string/TypedArray.
// booleans and undefined must be converted before binding.
function b(v) {
  if (v === true) return 1;
  if (v === false) return 0;
  if (v === undefined) return null;
  return v;
}

function downsample(rows, maxPoints) {
  const max = Math.max(2, Math.trunc(maxPoints) || 2);
  if (rows.length <= max) return rows;
  const stride = (rows.length - 1) / (max - 1);
  const out = [];
  let prevIdx = -1;
  for (let i = 0; i < max; i++) {
    const idx = Math.round(i * stride);
    if (idx !== prevIdx) {
      out.push(rows[idx]);
      prevIdx = idx;
    }
  }
  return out;
}

function applySchema(db) {
  db.exec("PRAGMA journal_mode=WAL;");
  db.exec("PRAGMA synchronous=NORMAL;");
  const schema = fs.readFileSync(new URL("../schema.sql", import.meta.url), "utf8");
  db.exec(schema);
  // Existing archives need the summary columns without a destructive rebuild.
  for (const column of ["total_tokens INTEGER", "total_usd REAL"]) {
    try { db.exec(`ALTER TABLE deng_stats ADD COLUMN ${column}`); } catch { /* already present */ }
  }
  try { db.exec("ALTER TABLE image_manifests ADD COLUMN channels INTEGER NOT NULL DEFAULT 4"); } catch { /* already present */ }
  for (const column of ["pack_id INTEGER REFERENCES blob_packs(id)", "pack_offset INTEGER"]) {
    try { db.exec(`ALTER TABLE blobs ADD COLUMN ${column}`); } catch { /* already present */ }
  }
}

export function openArchive(dataDir, { readonly = false } = {}) {
  fs.mkdirSync(dataDir, { recursive: true });
  const dbPath = path.join(dataDir, "archive.sqlite");

  if (readonly && !fs.existsSync(dbPath)) {
    // A read-only connection cannot create the file or apply DDL, but the
    // server must serve even when the archive has never been written. Create
    // an empty, schema'd database first, then reopen read-only.
    const seed = new DatabaseSync(dbPath);
    applySchema(seed);
    seed.close();
  }

  const db = new DatabaseSync(dbPath, { readOnly: readonly });
  db.exec("PRAGMA busy_timeout=5000;");
  if (!readonly) applySchema(db);
  return new Archive(db);
}

export class Archive {
  constructor(db) {
    this.db = db;
    this._stmts = new Map();
    // A read-only connection to a pre-pack database cannot run the ALTERs, so
    // probe for the pack columns and fall back to legacy SQL when absent.
    this._hasPacks =
      db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('blobs') WHERE name='pack_id'").get().c > 0;
    this._packCache = new Map(); // pack_id → decompressed Buffer, insertion order = LRU
    this._packCacheBytes = 0;
  }

  _p(sql) {
    let s = this._stmts.get(sql);
    if (!s) {
      s = this.db.prepare(sql);
      this._stmts.set(sql, s);
    }
    return s;
  }

  // ---------------------------------------------------------------- captures

  saveCapture({
    feed,
    capturedAt,
    body,
    httpStatus = 200,
    upstreamTs = null,
    contentType = null,
    storeRaw = true,
  }) {
    const hash = sha256(body);
    const latest = this._p(
      "SELECT id, hash FROM captures WHERE feed=? ORDER BY first_at DESC, id DESC LIMIT 1"
    ).get(feed);

    if (latest && latest.hash === hash) {
      // unchanged content — extend the current state period
      this._p(
        "UPDATE captures SET last_at=?, capture_count=capture_count+1 WHERE id=?"
      ).run(capturedAt, latest.id);
      return { changed: false, hash, deduped: true };
    }

    if (!storeRaw) {
      // caller sampled away the raw body; content differs but is not archived
      return { changed: true, hash, deduped: false };
    }

    const known = this._p("SELECT 1 FROM blobs WHERE hash=?").get(hash);
    if (!known) {
      const gz = zlib.gzipSync(body, { level: 9 });
      this._p("INSERT INTO blobs (hash, bytes, body_gz) VALUES (?,?,?)").run(
        hash,
        body.length,
        gz
      );
    }
    this._p(
      `INSERT INTO captures (feed, hash, first_at, last_at, capture_count, http_status, upstream_ts, content_type)
       VALUES (?,?,?,?,1,?,?,?)`
    ).run(feed, hash, capturedAt, capturedAt, b(httpStatus), b(upstreamTs), b(contentType));
    return { changed: true, hash, deduped: false };
  }

  saveImageCapture({
    feed,
    capturedAt,
    tiles,
    rawBody = null,
    httpStatus = 200,
    upstreamTs = null,
    contentType = "image/png",
  }) {
    if (!tiles || !Array.isArray(tiles.tiles) || !tiles.tiles.length) {
      throw new Error("image capture requires at least one tile");
    }
    const manifestBody = Buffer.from(JSON.stringify({
      format: "dradar-image-tiles-v1",
      width: tiles.width,
      height: tiles.height,
      tileSize: tiles.tileSize,
      channels: tiles.channels || 4,
      tiles: tiles.tiles.map(({ hash, x, y, width, height }) => ({ hash, x, y, width, height })),
    }), "utf8");
    if (rawBody) {
      const uniqueTileBytes = new Map();
      for (const tile of tiles.tiles) uniqueTileBytes.set(tile.hash, tile.bytes);
      const tiledBytes = zlib.gzipSync(manifestBody).length +
        [...uniqueTileBytes.values()].reduce((sum, bytes) => sum + bytes, 0);
      const rawBytes = zlib.gzipSync(rawBody, { level: 9 }).length;
      if (tiledBytes >= rawBytes) {
        return this.saveCapture({
          feed,
          capturedAt,
          body: rawBody,
          httpStatus,
          upstreamTs,
          contentType,
        });
      }
    }
    this.db.exec("BEGIN");
    try {
      const tileStmt = this._p(
        "INSERT OR IGNORE INTO image_tiles (hash, bytes, body) VALUES (?,?,?)"
      );
      for (const tile of tiles.tiles) {
        tileStmt.run(tile.hash, tile.bytes, tile.body);
      }
      const cap = this.saveCapture({
        feed,
        capturedAt,
        body: manifestBody,
        httpStatus,
        upstreamTs,
        contentType,
      });
      if (cap.changed && !cap.deduped) {
        this._p(
          `INSERT OR IGNORE INTO image_manifests
             (capture_hash, width, height, tile_size, channels, content_type)
           VALUES (?,?,?,?,?,?)`
        ).run(cap.hash, tiles.width, tiles.height, tiles.tileSize, tiles.channels || 4, contentType);
        const refStmt = this._p(
          `INSERT OR IGNORE INTO image_manifest_tiles
             (capture_hash, tile_index, tile_hash, x, y, width, height)
           VALUES (?,?,?,?,?,?,?)`
        );
        tiles.tiles.forEach((tile, index) => {
          refStmt.run(cap.hash, index, tile.hash, tile.x, tile.y, tile.width, tile.height);
        });
      }
      this.db.exec("COMMIT");
      return cap;
    } catch (err) {
      try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
      throw err;
    }
  }

  imageManifest(captureHash) {
    const meta = this._p(
      `SELECT capture_hash AS captureHash, width, height, tile_size AS tileSize,
              channels, content_type AS contentType
       FROM image_manifests WHERE capture_hash=?`
    ).get(captureHash);
    if (!meta) return null;
    return {
      ...meta,
      tiles: this._p(
        `SELECT tile_hash AS hash, x, y, width, height
         FROM image_manifest_tiles WHERE capture_hash=? ORDER BY tile_index`
      ).all(captureHash),
    };
  }

  imageTileBody(tileHash) {
    const row = this._p("SELECT body FROM image_tiles WHERE hash=?").get(tileHash);
    return row ? Buffer.from(row.body) : null;
  }

  pruneImageTiles() {
    const result = this._p(
      "DELETE FROM image_tiles WHERE hash NOT IN (SELECT DISTINCT tile_hash FROM image_manifest_tiles)"
    ).run();
    return Number(result.changes);
  }

  latestCapture(feed, atIso = null) {
    let row;
    if (atIso == null) {
      row = this._p(
        `SELECT c.feed, c.hash, c.first_at AS firstAt, c.last_at AS lastAt,
                c.http_status AS httpStatus, c.upstream_ts AS upstreamTs,
                c.content_type AS contentType, bl.bytes AS bytes
         FROM captures c JOIN blobs bl ON bl.hash=c.hash
         WHERE c.feed=? ORDER BY c.first_at DESC, c.id DESC LIMIT 1`
      ).get(feed);
    } else {
      row = this._p(
        `SELECT c.feed, c.hash, c.first_at AS firstAt, c.last_at AS lastAt,
                c.http_status AS httpStatus, c.upstream_ts AS upstreamTs,
                c.content_type AS contentType, bl.bytes AS bytes
         FROM captures c JOIN blobs bl ON bl.hash=c.hash
         WHERE c.feed=? AND c.first_at<=? ORDER BY c.first_at DESC, c.id DESC LIMIT 1`
      ).get(feed, atIso);
      if (!row) {
        // atIso earlier than first data → return the oldest row so time-travel
        // before history begins still renders something.
        row = this._p(
          `SELECT c.feed, c.hash, c.first_at AS firstAt, c.last_at AS lastAt,
                  c.http_status AS httpStatus, c.upstream_ts AS upstreamTs,
                  c.content_type AS contentType, bl.bytes AS bytes
           FROM captures c JOIN blobs bl ON bl.hash=c.hash
           WHERE c.feed=? ORDER BY c.first_at ASC, c.id ASC LIMIT 1`
        ).get(feed);
      }
    }
    return row || null;
  }

  captureBody(hash) {
    if (!this._hasPacks) {
      const row = this._p("SELECT body_gz FROM blobs WHERE hash=?").get(hash);
      if (!row) return null;
      const gz = Buffer.from(row.body_gz);
      if (gz.length > 0) return zlib.gunzipSync(gz);
      // A zero-length body_gz means a writer packed this blob after this
      // connection probed the schema — re-probe and retry via the pack path.
      this._hasPacks =
        this.db.prepare("SELECT COUNT(*) AS c FROM pragma_table_info('blobs') WHERE name='pack_id'").get().c > 0;
      if (!this._hasPacks) return null;
    }
    const row = this._p(
      "SELECT body_gz, bytes, pack_id, pack_offset FROM blobs WHERE hash=?"
    ).get(hash);
    if (!row) return null;
    if (row.pack_id != null) {
      const raw = this._packRaw(row.pack_id, Number(row.pack_offset) + Number(row.bytes));
      if (!raw) return null;
      return Buffer.from(raw.subarray(row.pack_offset, Number(row.pack_offset) + Number(row.bytes)));
    }
    return zlib.gunzipSync(Buffer.from(row.body_gz));
  }

  // Decompressed pack bodies, LRU-cached. minLength guards against a cached
  // copy of an open pack that another connection has since appended to: blob
  // offsets inside a pack never move, so a too-short buffer is simply stale.
  _packRaw(packId, minLength = 0) {
    let raw = this._packCache.get(packId);
    if (raw && raw.length >= minLength) {
      this._packCache.delete(packId); // refresh LRU position
      this._packCache.set(packId, raw);
      return raw;
    }
    const row = this._p("SELECT body_br FROM blob_packs WHERE id=?").get(packId);
    if (!row) return null;
    raw = zlib.brotliDecompressSync(Buffer.from(row.body_br));
    if (this._packCache.has(packId)) {
      this._packCacheBytes -= this._packCache.get(packId).length;
      this._packCache.delete(packId);
    }
    this._packCache.set(packId, raw);
    this._packCacheBytes += raw.length;
    while (this._packCacheBytes > PACK_CACHE_MAX_BYTES && this._packCache.size > 1) {
      const [oldId, oldRaw] = this._packCache.entries().next().value;
      this._packCache.delete(oldId);
      this._packCacheBytes -= oldRaw.length;
    }
    return raw;
  }

  /**
   * packBlobs — move each feed's older text-like blobs into per-feed brotli
   * packs. Keeps the newest `keepLatest` versions individually gzipped, appends
   * to the feed's open pack (rewriting it) and seals packs at `targetRawBytes`
   * uncompressed. Every appended slice is verified against its sha256 before
   * commit. Idempotent; safe to run on every collector start / daily prune.
   * → {feeds, blobs, packs, rawBytes, packedBytes}
   */
  packBlobs({ targetRawBytes = PACK_TARGET_RAW_BYTES, keepLatest = PACK_KEEP_LATEST } = {}) {
    const totals = { feeds: 0, blobs: 0, packs: 0, rawBytes: 0, packedBytes: 0 };
    const feeds = this._p("SELECT DISTINCT feed FROM captures").all().map((r) => r.feed);
    for (const feed of feeds) {
      const keep = new Set(
        this._p("SELECT hash FROM captures WHERE feed=? ORDER BY first_at DESC, id DESC LIMIT ?")
          .all(feed, keepLatest)
          .map((r) => r.hash)
      );
      const eligible = this._p(
        `SELECT bl.hash AS hash, bl.bytes AS bytes, MAX(c.content_type) AS contentType
         FROM captures c JOIN blobs bl ON bl.hash=c.hash
         WHERE c.feed=? AND bl.pack_id IS NULL
         GROUP BY bl.hash ORDER BY MIN(c.first_at) ASC, MIN(c.id) ASC`
      ).all(feed).filter((r) => !keep.has(r.hash) && isPackableContentType(r.contentType));
      if (!eligible.length) continue;

      const open = this._p(
        "SELECT id, body_br AS bodyBr FROM blob_packs WHERE feed=? AND sealed=0 ORDER BY id DESC LIMIT 1"
      ).get(feed);
      let group = {
        packId: open ? open.id : null,
        baseRaw: open ? zlib.brotliDecompressSync(Buffer.from(open.bodyBr)) : EMPTY_BLOB,
        members: [],
      };
      let runningRaw = group.baseRaw.length;
      let packedAny = false;

      const flush = (sealed) => {
        if (!group.members.length) return;
        const raw = Buffer.concat([group.baseRaw, ...group.members.map((m) => m.body)]);
        const bodyBr = zlib.brotliCompressSync(raw, brotliPackOptions(raw.length));
        const check = zlib.brotliDecompressSync(bodyBr);
        for (const m of group.members) {
          if (sha256(check.subarray(m.offset, m.offset + m.body.length)) !== m.hash) {
            throw new Error(`blob pack verification failed for ${m.hash} (feed ${feed})`);
          }
        }
        this.db.exec("BEGIN");
        try {
          let packId = group.packId;
          if (packId == null) {
            packId = Number(
              this._p(
                "INSERT INTO blob_packs (feed, created_at, sealed, raw_bytes, body_br) VALUES (?,?,?,?,?)"
              ).run(feed, new Date().toISOString(), sealed ? 1 : 0, raw.length, bodyBr).lastInsertRowid
            );
          } else {
            this._p("UPDATE blob_packs SET sealed=?, raw_bytes=?, body_br=? WHERE id=?").run(
              sealed ? 1 : 0, raw.length, bodyBr, packId
            );
          }
          const upd = this._p(
            "UPDATE blobs SET pack_id=?, pack_offset=?, body_gz=? WHERE hash=?"
          );
          for (const m of group.members) upd.run(packId, m.offset, EMPTY_BLOB, m.hash);
          this.db.exec("COMMIT");
          if (this._packCache.has(packId)) {
            this._packCacheBytes -= this._packCache.get(packId).length;
            this._packCache.delete(packId);
          }
        } catch (err) {
          try { this.db.exec("ROLLBACK"); } catch { /* preserve original error */ }
          throw err;
        }
        totals.packs++;
        totals.blobs += group.members.length;
        totals.rawBytes += raw.length - group.baseRaw.length;
        totals.packedBytes += bodyBr.length;
        packedAny = true;
        group = { packId: null, baseRaw: EMPTY_BLOB, members: [] };
        runningRaw = 0;
      };

      for (const r of eligible) {
        const body = this.captureBody(r.hash);
        if (!body || body.length !== Number(r.bytes)) continue;
        group.members.push({ hash: r.hash, body, offset: runningRaw });
        runningRaw += body.length;
        if (runningRaw >= targetRawBytes) flush(true);
      }
      flush(false); // remainder stays as the feed's open pack
      if (packedAny) totals.feeds++;
    }
    return totals;
  }

  listVersions(feed, { fromIso = null, toIso = null, limit = 500, order = "desc" } = {}) {
    const dir = String(order).toLowerCase() === "asc" ? "ASC" : "DESC";
    const lim = Math.min(Math.max(1, Math.trunc(limit) || 500), 5000);
    const clauses = ["c.feed=?"];
    const params = [feed];
    if (fromIso != null) {
      clauses.push("c.first_at>=?");
      params.push(fromIso);
    }
    if (toIso != null) {
      clauses.push("c.first_at<=?");
      params.push(toIso);
    }
    params.push(lim);
    return this._p(
      `SELECT c.first_at AS firstAt, c.last_at AS lastAt, c.hash AS hash,
              bl.bytes AS bytes, c.capture_count AS captureCount
       FROM captures c JOIN blobs bl ON bl.hash=c.hash
       WHERE ${clauses.join(" AND ")}
       ORDER BY c.first_at ${dir}, c.id ${dir} LIMIT ?`
    ).all(...params);
  }

  feedsSummary() {
    const agg = this._p(
      `SELECT feed,
              COUNT(*) AS versions,
              SUM(capture_count) AS captures,
              MAX(last_at) AS lastCapturedAt,
              MAX(first_at) AS lastChangedAt
       FROM captures GROUP BY feed`
    ).all();
    const bytesRows = this._p(
      `SELECT feed, SUM(bytes) AS blobBytes FROM
         (SELECT DISTINCT c.feed AS feed, c.hash AS hash, bl.bytes AS bytes
          FROM captures c JOIN blobs bl ON bl.hash=c.hash)
       GROUP BY feed`
    ).all();
    const bytesByFeed = new Map(bytesRows.map((r) => [r.feed, r.blobBytes]));
    return agg
      .map((r) => ({
        feed: r.feed,
        versions: r.versions,
        captures: r.captures,
        lastCapturedAt: r.lastCapturedAt,
        lastChangedAt: r.lastChangedAt,
        blobBytes: bytesByFeed.get(r.feed) || 0,
      }))
      .sort((a, x) => (a.feed < x.feed ? -1 : a.feed > x.feed ? 1 : 0));
  }

  // ------------------------------------------------------------ runs / state

  recordRun({
    feed,
    startedAt,
    ok,
    httpStatus = null,
    error = null,
    durationMs,
    changed = false,
    bytes = 0,
  }) {
    this._p(
      `INSERT INTO runs (feed, started_at, ok, http_status, error, duration_ms, changed, bytes)
       VALUES (?,?,?,?,?,?,?,?)`
    ).run(
      feed,
      startedAt,
      b(ok),
      b(httpStatus),
      b(error),
      b(Math.trunc(durationMs || 0)),
      b(changed),
      b(Math.trunc(bytes || 0))
    );
  }

  recentRuns({ feed = null, limit = 100 } = {}) {
    const lim = Math.min(Math.max(1, Math.trunc(limit) || 100), 2000);
    const rows = feed
      ? this._p(
          `SELECT feed, started_at AS startedAt, ok, http_status AS httpStatus, error,
                  duration_ms AS durationMs, changed, bytes
           FROM runs WHERE feed=? ORDER BY started_at DESC, id DESC LIMIT ?`
        ).all(feed, lim)
      : this._p(
          `SELECT feed, started_at AS startedAt, ok, http_status AS httpStatus, error,
                  duration_ms AS durationMs, changed, bytes
           FROM runs ORDER BY started_at DESC, id DESC LIMIT ?`
        ).all(lim);
    return rows.map((r) => ({
      feed: r.feed,
      startedAt: r.startedAt,
      ok: !!r.ok,
      httpStatus: r.httpStatus,
      error: r.error,
      durationMs: r.durationMs,
      changed: !!r.changed,
      bytes: r.bytes,
    }));
  }

  pruneRuns(keepDays) {
    const cutoff = new Date(Date.now() - keepDays * 86400000).toISOString();
    const r = this._p("DELETE FROM runs WHERE started_at < ?").run(cutoff);
    return Number(r.changes);
  }

  getFeedState(feed) {
    const row = this._p(
      "SELECT etag, fail_count AS failCount, backoff_until AS backoffUntil, last_ok_at AS lastOkAt FROM feed_state WHERE feed=?"
    ).get(feed);
    return row || null;
  }

  setFeedState(feed, patch = {}) {
    const cur = this.getFeedState(feed) || {
      etag: null,
      failCount: 0,
      backoffUntil: null,
      lastOkAt: null,
    };
    const next = {
      etag: "etag" in patch ? patch.etag : cur.etag,
      failCount: "failCount" in patch ? patch.failCount : cur.failCount,
      backoffUntil: "backoffUntil" in patch ? patch.backoffUntil : cur.backoffUntil,
      lastOkAt: "lastOkAt" in patch ? patch.lastOkAt : cur.lastOkAt,
    };
    this._p(
      `INSERT INTO feed_state (feed, etag, fail_count, backoff_until, last_ok_at)
       VALUES (?,?,?,?,?)
       ON CONFLICT(feed) DO UPDATE SET
         etag=excluded.etag, fail_count=excluded.fail_count,
         backoff_until=excluded.backoff_until, last_ok_at=excluded.last_ok_at`
    ).run(feed, b(next.etag), b(Math.trunc(next.failCount || 0)), b(next.backoffUntil), b(next.lastOkAt));
  }

  // ------------------------------------------------------ merged history tables

  upsertIqPoints(rows) {
    if (!rows || !rows.length) return 0;
    // SPEC §2/§5: the return value is the number of NEWLY INSERTED (series, ts)
    // points. Revisions to an already-stored hour are still persisted (upstream
    // revises the current in-progress hour's score/n on every poll), but a
    // revision must NOT be counted as an insert — otherwise a revision-only poll
    // is audited/logged as new data captured.
    const ins = this._p(
      "INSERT OR IGNORE INTO iq_points (series, ts, score, n) VALUES (?,?,?,?)"
    );
    const upd = this._p(
      `UPDATE iq_points SET score=?, n=? WHERE series=? AND ts=?
         AND (score<>? OR IFNULL(n,-1)<>IFNULL(?,-1))`
    );
    let inserted = 0;
    for (const r of rows) {
      const n = b(r.n);
      if (Number(ins.run(r.series, r.ts, r.score, n).changes) > 0) {
        inserted++;
      } else {
        upd.run(r.score, n, r.series, r.ts, r.score, n);
      }
    }
    return inserted;
  }

  insertEvents(rows) {
    if (!rows || !rows.length) return 0;
    const stmt = this._p(
      `INSERT OR IGNORE INTO deng_events
        (graded_at, task_id, model, effort, nickname, passed, cost_usd, cost_source, cost_is_estimate, points, avatar_seed)
       VALUES (?,?,?,?,?,?,?,?,?,?,?)`
    );
    let count = 0;
    for (const r of rows) {
      count += Number(
        stmt.run(
          r.gradedAt,
          r.taskId,
          r.model,
          r.effort,
          r.nickname ?? "",
          b(r.passed),
          b(r.costUsd),
          b(r.costSource),
          b(r.costIsEstimate),
          b(r.points),
          b(r.avatarSeed)
        ).changes
      );
    }
    return count;
  }

  upsertCellState({ cellKey, payloadJson, hash, seenAt }) {
    const latest = this._p(
      "SELECT id, hash FROM cell_history WHERE cell_key=? ORDER BY id DESC LIMIT 1"
    ).get(cellKey);
    if (latest && latest.hash === hash) {
      this._p("UPDATE cell_history SET last_seen=? WHERE id=?").run(seenAt, latest.id);
      return false;
    }
    this._p(
      "INSERT INTO cell_history (cell_key, hash, payload, first_seen, last_seen) VALUES (?,?,?,?,?)"
    ).run(cellKey, hash, payloadJson, seenAt, seenAt);
    return true;
  }

  latestCellHash(cellKey) {
    const row = this._p(
      "SELECT hash FROM cell_history WHERE cell_key=? ORDER BY id DESC LIMIT 1"
    ).get(cellKey);
    return row ? row.hash : null;
  }

  upsertDengTask({ id, title, language, repo, category, json, seenAt }) {
    const r = this._p(
      `INSERT INTO deng_tasks (id, title, language, repo, category, json, first_seen, last_seen)
       VALUES (?,?,?,?,?,?,?,?)
       ON CONFLICT(id) DO UPDATE SET
         title=excluded.title, language=excluded.language, repo=excluded.repo,
         category=excluded.category, json=excluded.json, last_seen=excluded.last_seen`
    ).run(id, b(title), b(language), b(repo), b(category), json, seenAt, seenAt);
    return Number(r.changes) > 0;
  }

  upsertRatingDays(rows) {
    if (!rows || !rows.length) return 0;
    const existing = this._p(
      "SELECT average, count FROM model_ratings_daily WHERE day=? AND model_id=?"
    );
    const repl = this._p(
      `INSERT OR REPLACE INTO model_ratings_daily
         (day, model_id, label, grp, average, count, updated_at)
       VALUES (?,?,?,?,?,?,?)`
    );
    let changed = 0;
    for (const r of rows) {
      const prev = existing.get(r.day, r.modelId);
      if (!prev || prev.average !== r.average || prev.count !== r.count) changed++;
      repl.run(r.day, r.modelId, b(r.label), b(r.grp), b(r.average), b(r.count), b(r.updatedAt));
    }
    return changed;
  }

  latestSubscriberCount() {
    const row = this._p(
      "SELECT count FROM subscriber_counts ORDER BY ts DESC LIMIT 1"
    ).get();
    return row ? row.count : null;
  }

  insertSubscriberCount({ ts, count }) {
    const r = this._p(
      "INSERT OR IGNORE INTO subscriber_counts (ts, count) VALUES (?,?)"
    ).run(ts, b(count));
    return Number(r.changes) > 0;
  }

  upsertRssItems(rows) {
    if (!rows || !rows.length) return 0;
    const stmt = this._p(
      `INSERT OR IGNORE INTO rss_items (guid, pub_date, title, link, description, first_seen)
       VALUES (?,?,?,?,?,?)`
    );
    let count = 0;
    for (const r of rows) {
      count += Number(
        stmt.run(r.guid, b(r.pubDate), b(r.title), b(r.link), b(r.description), r.firstSeen).changes
      );
    }
    return count;
  }

  insertDengStats(row) {
    const r = this._p(
      `INSERT OR IGNORE INTO deng_stats
        (ts, online_volunteers, pending_grades, error_grades, contributors_count,
         pedal_usd_per_hour, pedal_runs, burn_tokens, burn_usd,
         total_tokens, total_usd, month_label)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,?)`
    ).run(
      row.ts,
      b(row.onlineVolunteers),
      b(row.pendingGrades),
      b(row.errorGrades),
      b(row.contributorsCount),
      b(row.pedalUsdPerHour),
      b(row.pedalRuns),
      b(row.burnTokens),
      b(row.burnUsd),
      b(row.totalTokens),
      b(row.totalUsd),
      b(row.monthLabel)
    );
    return Number(r.changes) > 0;
  }

  upsertAvatar({ seed, svg, fetchedAt }) {
    this._p(
      `INSERT INTO avatars (seed, svg, fetched_at) VALUES (?,?,?)
       ON CONFLICT(seed) DO UPDATE SET svg=excluded.svg, fetched_at=excluded.fetched_at`
    ).run(seed, svg, fetchedAt);
  }

  getAvatar(seed) {
    const row = this._p("SELECT svg FROM avatars WHERE seed=?").get(seed);
    if (!row) return null;
    return Buffer.from(row.svg);
  }

  missingAvatarSeeds(limit) {
    const lim = Math.min(Math.max(1, Math.trunc(limit) || 40), 500);
    const rows = this._p(
      `SELECT avatar_seed AS seed FROM deng_events
       WHERE avatar_seed IS NOT NULL AND avatar_seed<>''
         AND avatar_seed NOT IN (SELECT seed FROM avatars)
       GROUP BY avatar_seed
       ORDER BY MAX(graded_at) DESC
       LIMIT ?`
    ).all(lim);
    return rows.map((r) => r.seed);
  }

  // ------------------------------------------------------------- history queries

  listIqSeries() {
    return this._p(
      `SELECT series, COUNT(*) AS points, MIN(ts) AS firstTs, MAX(ts) AS lastTs
       FROM iq_points GROUP BY series ORDER BY series`
    ).all();
  }

  queryIqSeries({ series, fromIso = null, toIso = null, maxPoints = 2000 } = {}) {
    const names = Array.isArray(series) ? series : [];
    const out = {};
    for (const name of names) {
      const clauses = ["series=?"];
      const params = [name];
      if (fromIso != null) {
        clauses.push("ts>=?");
        params.push(fromIso);
      }
      if (toIso != null) {
        clauses.push("ts<=?");
        params.push(toIso);
      }
      const rows = this._p(
        `SELECT ts, score, n FROM iq_points WHERE ${clauses.join(" AND ")} ORDER BY ts ASC`
      ).all(...params);
      out[name] = downsample(rows, maxPoints);
    }
    return { series: out };
  }

  queryEvents({
    model,
    effort,
    taskId,
    nickname,
    passed,
    q,
    fromIso = null,
    toIso = null,
    limit = 100,
    offset = 0,
  } = {}) {
    const clauses = [];
    const params = [];
    if (model) {
      clauses.push("model=?");
      params.push(model);
    }
    if (effort) {
      clauses.push("effort=?");
      params.push(effort);
    }
    if (taskId) {
      clauses.push("task_id=?");
      params.push(taskId);
    }
    if (nickname) {
      clauses.push("nickname=?");
      params.push(nickname);
    }
    let passedVal = null;
    if (passed === true || passed === 1 || passed === "1" || passed === "true") passedVal = 1;
    else if (passed === false || passed === 0 || passed === "0" || passed === "false") passedVal = 0;
    if (passedVal !== null) {
      clauses.push("passed=?");
      params.push(passedVal);
    }
    if (q) {
      clauses.push("(task_id LIKE ? ESCAPE '\\' OR nickname LIKE ? ESCAPE '\\')");
      // Escape LIKE metacharacters so the search box matches the literal text a
      // user typed — a '_' or '%' should match itself, not act as a wildcard.
      const like = `%${String(q).replace(/[\\%_]/g, "\\$&")}%`;
      params.push(like, like);
    }
    if (fromIso != null) {
      clauses.push("graded_at>=?");
      params.push(fromIso);
    }
    if (toIso != null) {
      clauses.push("graded_at<=?");
      params.push(toIso);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const total = this._p(`SELECT COUNT(*) AS c FROM deng_events ${where}`).get(...params).c;
    const lim = Math.min(Math.max(1, Math.trunc(limit) || 100), 500);
    const off = Math.max(0, Math.trunc(offset) || 0);
    const rows = this._p(
      `SELECT graded_at AS gradedAt, task_id AS taskId, model, effort, nickname,
              passed, cost_usd AS costUsd, cost_source AS costSource,
              cost_is_estimate AS costIsEstimate, points, avatar_seed AS avatarSeed
       FROM deng_events ${where}
       ORDER BY graded_at DESC LIMIT ? OFFSET ?`
    ).all(...params, lim, off);
    return { total, rows };
  }

  queryCellHistory({ taskId, model, effort }) {
    const cellKey = `${taskId}|${model}|${effort}`;
    const rows = this._p(
      `SELECT hash, payload, first_seen AS firstSeen, last_seen AS lastSeen
       FROM cell_history WHERE cell_key=? ORDER BY id ASC`
    ).all(cellKey);
    return rows.map((r) => {
      let payload = null;
      try {
        payload = JSON.parse(r.payload);
      } catch {
        payload = null;
      }
      return { firstSeen: r.firstSeen, lastSeen: r.lastSeen, hash: r.hash, payload };
    });
  }

  listDengTasks() {
    return this._p(
      "SELECT id, title, language, repo, category FROM deng_tasks ORDER BY id"
    ).all();
  }

  queryRatings({ fromDay = null, toDay = null } = {}) {
    const clauses = [];
    const params = [];
    if (fromDay != null) {
      clauses.push("day>=?");
      params.push(fromDay);
    }
    if (toDay != null) {
      clauses.push("day<=?");
      params.push(toDay);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this._p(
      `SELECT day, model_id AS modelId, label, grp, average, count
       FROM model_ratings_daily ${where} ORDER BY day ASC, model_id ASC`
    ).all(...params);
  }

  querySubscribers({ fromIso = null, toIso = null } = {}) {
    const clauses = [];
    const params = [];
    if (fromIso != null) {
      clauses.push("ts>=?");
      params.push(fromIso);
    }
    if (toIso != null) {
      clauses.push("ts<=?");
      params.push(toIso);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    return this._p(
      `SELECT ts, count FROM subscriber_counts ${where} ORDER BY ts ASC`
    ).all(...params);
  }

  queryDengStats({ fromIso = null, toIso = null, maxPoints = 2000 } = {}) {
    const clauses = [];
    const params = [];
    if (fromIso != null) {
      clauses.push("ts>=?");
      params.push(fromIso);
    }
    if (toIso != null) {
      clauses.push("ts<=?");
      params.push(toIso);
    }
    const where = clauses.length ? `WHERE ${clauses.join(" AND ")}` : "";
    const rows = this._p(
      `SELECT ts, online_volunteers AS onlineVolunteers, pending_grades AS pendingGrades,
              error_grades AS errorGrades, contributors_count AS contributorsCount,
              pedal_usd_per_hour AS pedalUsdPerHour, pedal_runs AS pedalRuns,
              burn_tokens AS burnTokens, burn_usd AS burnUsd,
              total_tokens AS totalTokens, total_usd AS totalUsd, month_label AS monthLabel
       FROM deng_stats ${where} ORDER BY ts ASC`
    ).all(...params);
    return downsample(rows, maxPoints);
  }

  latestDengStats() {
    return this._p(
      `SELECT ts, online_volunteers AS onlineVolunteers,
              pedal_usd_per_hour AS pedalUsdPerHour, burn_tokens AS burnTokens,
              burn_usd AS burnUsd, total_tokens AS totalTokens, total_usd AS totalUsd
       FROM deng_stats ORDER BY ts DESC LIMIT 1`
    ).get() || null;
  }

  dbStats() {
    const pageCount = this._p("PRAGMA page_count").get().page_count;
    const pageSize = this._p("PRAGMA page_size").get().page_size;
    const blobAgg = this._p(
      "SELECT COUNT(*) AS c, IFNULL(SUM(bytes),0) AS bytes FROM blobs"
    ).get();
    const packAgg = this._hasPacks
      ? this._p("SELECT COUNT(*) AS c, IFNULL(SUM(LENGTH(body_br)),0) AS bytes FROM blob_packs").get()
      : { c: 0, bytes: 0 };
    const tileAgg = this._p(
      "SELECT COUNT(*) AS c, IFNULL(SUM(bytes),0) AS bytes FROM image_tiles"
    ).get();
    const tableRows = this.db
      .prepare(
        "SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%' ORDER BY name"
      )
      .all();
    const tables = {};
    for (const { name } of tableRows) {
      // table names come from schema, not user input — safe to interpolate.
      tables[name] = this.db.prepare(`SELECT COUNT(*) AS c FROM "${name}"`).get().c;
    }
    return {
      dbBytes: pageCount * pageSize,
      blobBytes: blobAgg.bytes,
      blobCount: blobAgg.c,
      packBytes: packAgg.bytes,
      packCount: packAgg.c,
      tileBytes: tileAgg.bytes,
      tileCount: tileAgg.c,
      tables,
    };
  }

  close() {
    this.db.close();
  }
}
