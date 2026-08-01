-- dradar2 archive schema (authoritative — applied idempotently by src/db.js)

-- Content-addressed raw payloads. New blobs are stored gzip level 9 in body_gz.
-- The packer later moves text-like history into per-feed brotli packs (consecutive
-- versions are ~99% identical, so a shared compression window is ~8x smaller):
-- a packed blob has pack_id/pack_offset set and a zero-length body_gz; its bytes
-- column still holds the uncompressed length (= slice length inside the pack).
CREATE TABLE IF NOT EXISTS blobs (
  hash        TEXT PRIMARY KEY,           -- sha256 hex of raw (uncompressed) bytes
  bytes       INTEGER NOT NULL,           -- uncompressed size
  body_gz     BLOB NOT NULL,              -- zero-length when packed
  pack_id     INTEGER REFERENCES blob_packs(id),
  pack_offset INTEGER
);

-- Per-feed brotli streams of concatenated consecutive blob bodies (lgwin=24 so
-- the window spans every version in the pack). One open (sealed=0) pack per
-- feed is appended to by rewriting; packs seal for good once raw_bytes reaches
-- the packer's target and are never modified again.
CREATE TABLE IF NOT EXISTS blob_packs (
  id         INTEGER PRIMARY KEY,
  feed       TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sealed     INTEGER NOT NULL DEFAULT 0,
  raw_bytes  INTEGER NOT NULL,            -- uncompressed concatenation length
  body_br    BLOB NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_blob_packs_feed_sealed ON blob_packs(feed, sealed);

-- One row per observed content-state period of a feed. Consecutive identical polls
-- extend last_at instead of inserting.
CREATE TABLE IF NOT EXISTS captures (
  id            INTEGER PRIMARY KEY,
  feed          TEXT NOT NULL,
  hash          TEXT NOT NULL REFERENCES blobs(hash),
  first_at      TEXT NOT NULL,            -- ISO-8601 UTC
  last_at       TEXT NOT NULL,
  capture_count INTEGER NOT NULL DEFAULT 1,
  http_status   INTEGER NOT NULL DEFAULT 200,
  upstream_ts   TEXT,
  content_type  TEXT
);
CREATE INDEX IF NOT EXISTS idx_captures_feed_first ON captures(feed, first_at);

-- Collection audit log.
CREATE TABLE IF NOT EXISTS runs (
  id          INTEGER PRIMARY KEY,
  feed        TEXT NOT NULL,
  started_at  TEXT NOT NULL,
  ok          INTEGER NOT NULL,
  http_status INTEGER,
  error       TEXT,
  duration_ms INTEGER NOT NULL DEFAULT 0,
  changed     INTEGER NOT NULL DEFAULT 0,
  bytes       INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_runs_feed_started ON runs(feed, started_at);
CREATE INDEX IF NOT EXISTS idx_runs_started ON runs(started_at);

-- Collector per-feed state (etag cache, backoff).
CREATE TABLE IF NOT EXISTS feed_state (
  feed          TEXT PRIMARY KEY,
  etag          TEXT,
  fail_count    INTEGER NOT NULL DEFAULT 0,
  backoff_until TEXT,
  last_ok_at    TEXT
);

-- ---- long-term merged history (the data upstream discards) ----

-- deng iq-history hourly points, unlimited retention (upstream keeps 7 days).
CREATE TABLE IF NOT EXISTS iq_points (
  series TEXT NOT NULL,
  ts     TEXT NOT NULL,
  score  REAL NOT NULL,
  n      INTEGER,
  PRIMARY KEY (series, ts)
) WITHOUT ROWID;

-- deng graded-event feed, unlimited retention (upstream keeps last 20).
CREATE TABLE IF NOT EXISTS deng_events (
  graded_at        TEXT NOT NULL,
  task_id          TEXT NOT NULL,
  model            TEXT NOT NULL,
  effort           TEXT NOT NULL,
  nickname         TEXT NOT NULL DEFAULT '',
  passed           INTEGER,
  cost_usd         REAL,
  cost_source      TEXT,
  cost_is_estimate INTEGER,
  points           REAL,
  avatar_seed      TEXT,
  PRIMARY KEY (graded_at, task_id, model, effort, nickname)
) WITHOUT ROWID;
CREATE INDEX IF NOT EXISTS idx_deng_events_model ON deng_events(model, effort, graded_at);
CREATE INDEX IF NOT EXISTS idx_deng_events_task ON deng_events(task_id, graded_at);
-- Drives the avatar sweep's missingAvatarSeeds() anti-join/GROUP BY so it does
-- not full-scan the ever-growing deng_events table on every deng:events poll.
CREATE INDEX IF NOT EXISTS idx_deng_events_avatar_seed ON deng_events(avatar_seed, graded_at);

-- Benchmark-cell state history (upstream keeps only the latest state per cell).
CREATE TABLE IF NOT EXISTS cell_history (
  id         INTEGER PRIMARY KEY,
  cell_key   TEXT NOT NULL,              -- "<taskId>|<model>|<effort>"
  hash       TEXT NOT NULL,              -- sha256 of canonical payload JSON
  payload    TEXT NOT NULL,              -- canonical JSON of the cell object
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_cell_history_key ON cell_history(cell_key, id);

CREATE TABLE IF NOT EXISTS deng_tasks (
  id         TEXT PRIMARY KEY,
  title      TEXT,
  language   TEXT,
  repo       TEXT,
  category   TEXT,
  json       TEXT NOT NULL,
  first_seen TEXT NOT NULL,
  last_seen  TEXT NOT NULL
);

-- Daily model rating averages (upstream serves a rolling 14-day history).
CREATE TABLE IF NOT EXISTS model_ratings_daily (
  day        TEXT NOT NULL,              -- YYYY-MM-DD (Asia/Shanghai days, as upstream)
  model_id   TEXT NOT NULL,
  label      TEXT,
  grp        TEXT,
  average    REAL,
  count      INTEGER,
  updated_at TEXT,
  PRIMARY KEY (day, model_id)
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS subscriber_counts (
  ts    TEXT PRIMARY KEY,
  count INTEGER NOT NULL
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS rss_items (
  guid        TEXT PRIMARY KEY,
  pub_date    TEXT,
  title       TEXT,
  link        TEXT,
  description TEXT,
  first_seen  TEXT NOT NULL
);

-- deng operational stats time series (sampled every leaderboard poll).
CREATE TABLE IF NOT EXISTS deng_stats (
  ts                 TEXT PRIMARY KEY,
  online_volunteers  INTEGER,
  pending_grades     INTEGER,
  error_grades       INTEGER,
  contributors_count INTEGER,
  pedal_usd_per_hour REAL,
  pedal_runs         INTEGER,
  burn_tokens        INTEGER,
  burn_usd           REAL,
  total_tokens       INTEGER,
  total_usd          REAL,
  month_label        TEXT
) WITHOUT ROWID;

CREATE TABLE IF NOT EXISTS avatars (
  seed       TEXT PRIMARY KEY,
  svg        BLOB NOT NULL,              -- 1-byte tombstone when upstream has none
  fetched_at TEXT NOT NULL
);

-- Shared decoded-image tiles for composite assets. The capture row stores a
-- small manifest blob; tile bytes are content-addressed across every image.
CREATE TABLE IF NOT EXISTS image_tiles (
  hash       TEXT PRIMARY KEY,
  bytes      INTEGER NOT NULL,
  body       BLOB NOT NULL
);

CREATE TABLE IF NOT EXISTS image_manifests (
  capture_hash TEXT PRIMARY KEY REFERENCES blobs(hash),
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  tile_size    INTEGER NOT NULL,
  channels     INTEGER NOT NULL DEFAULT 4,
  content_type TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS image_manifest_tiles (
  capture_hash TEXT NOT NULL REFERENCES image_manifests(capture_hash),
  tile_index   INTEGER NOT NULL,
  tile_hash    TEXT NOT NULL REFERENCES image_tiles(hash),
  x            INTEGER NOT NULL,
  y            INTEGER NOT NULL,
  width        INTEGER NOT NULL,
  height       INTEGER NOT NULL,
  PRIMARY KEY (capture_hash, tile_index)
);
CREATE INDEX IF NOT EXISTS idx_image_manifest_tiles_hash ON image_manifest_tiles(tile_hash);
