# dradar2 — Codex Radar long-term archive & clone UI

**Goal.** The public sites [codexradar.com](https://codexradar.com) (Codex 雷达) and
[deng.codexradar.com](https://deng.codexradar.com) (分布式雷达 Codex 站) only retain short rolling
windows (last 20 events, 7 days of hourly IQ points, latest result per benchmark cell, 48 h
comparisons). dradar2 is a personal, read-only, long-term archive: a **collector** polls the same
public GET endpoints the pages themselves use, stores every observation forever in SQLite, and a
**server** replays pixel-faithful clones of both sites at any archived point in time, plus custom
long-range history dashboards that exceed the upstream windows.

Non-goals: no login/OAuth, no task claiming, no rating submission, no subscribe, no use of the
key-gated `api/v1/current` full API. GET-only against a fixed allowlist. Attribution
"数据来自 Codex 雷达 codexradar.com" is displayed in the injected archive toolbar.

**Stack: Node ≥ 22.5 (dev/prod: 24), ZERO runtime npm dependencies.**
`node:sqlite` (DatabaseSync), `node:http`, `node:zlib`, `node:crypto`, `node:test`.
Plain ESM JavaScript (`"type": "module"`), no TypeScript, no build step.

Two processes sharing one SQLite file (WAL): `node src/collector.js` and `node src/server.js`.

```
src/
  config.js      db.js        fetchers.js   feeds.js     extractors.js
  collector.js   server.js    replay.js     api-routes.js  history-api.js
  public/        timebar.js  history.html  history-events.html  history-cells.html  sources.html  archive.css? (inline ok)
scripts/seed-fixtures.js
test/*.test.js   test/fixtures/   (fixtures already provided — real payloads captured 2026-07-31)
schema.sql  package.json  .env.example  Dockerfile  compose.yaml  README.md
```

## File ownership (parallel build)

- **Agent A**: `src/config.js`, `src/db.js`, `src/fetchers.js`, `src/feeds.js`,
  `src/extractors.js`, `src/collector.js`, `scripts/seed-fixtures.js`
- **Agent B**: `src/server.js`, `src/replay.js`, `src/api-routes.js`, `src/public/timebar.js`
- **Agent C**: `src/history-api.js`, `src/public/history.html`, `src/public/history-events.html`,
  `src/public/history-cells.html`, `src/public/sources.html`
- **Agent D**: `test/*.test.js`, `Dockerfile`, `compose.yaml`, `README.md`

Nobody touches another agent's files. `schema.sql` is authoritative and already written — read it,
do not edit it.

---

## 1. Timestamps & conventions

- All stored timestamps: ISO-8601 UTC strings `YYYY-MM-DDTHH:mm:ss.sssZ` (`new Date().toISOString()`).
  Upstream timestamps (`+08:00`, `+00:00` offsets) are normalized via `new Date(s).toISOString()`.
  SQLite lexicographic ordering then equals chronological ordering.
- UI display timezone is `Asia/Shanghai` (what upstream uses), via `Intl.DateTimeFormat` with
  `timeZone: "Asia/Shanghai"`; label times `UTC+8`.
- Hashes: `sha256` hex of the **raw uncompressed body bytes**.
- Blobs stored gzip level 9 (`zlib.gzipSync(body, {level: 9})`).

## 2. Database — see `schema.sql` (authoritative)

`src/db.js` exports:

```js
export function openArchive(dataDir, {readonly = false} = {})  // → Archive
```

Creates `dataDir` if missing, opens `${dataDir}/archive.sqlite` with `node:sqlite`'s
`DatabaseSync`, applies `schema.sql` idempotently (all DDL uses IF NOT EXISTS), sets
`PRAGMA journal_mode=WAL; PRAGMA busy_timeout=5000; PRAGMA synchronous=NORMAL;`.
`schema.sql` is loaded from the repo (resolve relative to `src/db.js` via `import.meta.url`).

`Archive` (a class) methods — all synchronous (DatabaseSync), prepared statements cached:

```js
// ---- raw snapshot store (content-addressed blobs + state-period captures) ----
saveCapture({feed, capturedAt, body /*Buffer*/, httpStatus = 200, upstreamTs = null,
             contentType = null, storeRaw = true})
// → {changed: boolean, hash, deduped: boolean}
// hash = sha256(body). If the most recent capture row for `feed` has the same hash:
//   UPDATE its last_at = capturedAt, capture_count += 1  → {changed: false, deduped: true}.
// Else (storeRaw true): INSERT blob if hash unknown, INSERT capture row
//   (first_at = last_at = capturedAt, capture_count = 1) → {changed: true}.
// If storeRaw is false and hash differs from latest: do nothing, return {changed: true,
//   deduped: false} (caller sampled away the raw body — used by keepRaw:"sampled").
latestCapture(feed, atIso = null)
// → {feed, hash, firstAt, lastAt, httpStatus, upstreamTs, contentType, bytes} | null
// atIso null → newest capture row. Else newest row with first_at <= atIso.
// If none (atIso earlier than first data) → the OLDEST row (so time-travel before history
// begins still renders something; callers can compare firstAt > atIso to detect this).
captureBody(hash)                    // → Buffer (gunzipped) | null
listVersions(feed, {fromIso = null, toIso = null, limit = 500, order = "desc"})
// → [{firstAt, lastAt, hash, bytes, captureCount}]
feedsSummary()
// → [{feed, versions, captures, lastCapturedAt, lastChangedAt, blobBytes}] (one row per feed seen)

// ---- collection audit + per-feed collector state ----
recordRun({feed, startedAt, ok, httpStatus = null, error = null, durationMs, changed = false, bytes = 0})
recentRuns({feed = null, limit = 100})       // newest first
pruneRuns(keepDays)                          // delete runs older than now - keepDays
getFeedState(feed)                           // → {etag, failCount, backoffUntil, lastOkAt} | null
setFeedState(feed, {etag, failCount, backoffUntil, lastOkAt})  // upsert, partial ok

// ---- long-term merged tables (used by extractors; all idempotent upserts) ----
upsertIqPoints(rows)      // [{series, ts, score, n}]            → number newly inserted
insertEvents(rows)        // [{gradedAt, taskId, model, effort, passed(0/1), costUsd, costSource,
                          //   costIsEstimate(0/1), points, nickname, avatarSeed}] → newly inserted
upsertCellState({cellKey, payloadJson, hash, seenAt})
// latest row for cellKey has same hash → update last_seen, return false;
// else insert new row (first_seen = last_seen = seenAt), return true.
latestCellHash(cellKey)   // → hash | null   (fast path used by cells extractor)
upsertDengTask({id, title, language, repo, category, json, seenAt})  // keep latest, track first/last_seen
upsertRatingDays(rows)    // [{day, modelId, label, grp, average, count, updatedAt}] → upserted count
                          // REPLACE semantics on PK(day, modelId) — later data wins
insertSubscriberCount({ts, count})
upsertRssItems(rows)      // [{guid, pubDate, title, link, description, firstSeen}] → newly inserted
insertDengStats(row)      // {ts, onlineVolunteers, pendingGrades, errorGrades, contributorsCount,
                          //  pedalUsdPerHour, pedalRuns, burnTokens, burnUsd, monthLabel}
upsertAvatar({seed, svg /*Buffer*/, fetchedAt})
getAvatar(seed)                              // → Buffer | null
missingAvatarSeeds(limit)                    // seeds in deng_events not in avatars, newest events first

// ---- queries for history/archive APIs (all bounded) ----
listIqSeries()                                        // → [{series, points, firstTs, lastTs}]
queryIqSeries({series /*string[]*/, fromIso, toIso, maxPoints = 2000})
// → {series: {name: [{ts, score, n}, ...]}} — if a series has more than maxPoints rows in range,
// downsample by uniform stride in SQL/JS (keep first & last).
queryEvents({model, effort, taskId, nickname, passed, q, fromIso, toIso, limit = 100, offset = 0})
// q = LIKE match on task_id/nickname. limit capped at 500. → {total, rows: [...]}
queryCellHistory({taskId, model, effort})             // → rows for cell_key, oldest first
listDengTasks()                                       // → [{id, title, language, repo, category}]
queryRatings({fromDay, toDay})                        // → [{day, modelId, label, grp, average, count}]
querySubscribers({fromIso, toIso})                    // → [{ts, count}]
queryDengStats({fromIso, toIso, maxPoints = 2000})    // → [{ts, ...}] downsampled like iq
dbStats()                                             // → {dbBytes, blobBytes, blobCount, tables: {name: rowCount}}
close()
```

`cell_key` format: `"<taskId>|<model>|<effort>"` (upstream's own key format in `cells`).

## 3. Feeds — `src/feeds.js`

```js
export const FEEDS = [ /* {id, url, kind, intervalSec, extractor, keepRaw, contentType} */ ];
export function getFeed(id)
```

| id | url | kind | intervalSec | extractor | keepRaw |
|---|---|---|---|---|---|
| `codex:html` | `https://codexradar.com/` | page | 600 | – | always |
| `codex:html-en` | `https://codexradar.com/en` | page | 1800 | – | always |
| `codex:current` | `https://codexradar.com/current.json` | json | 300 | – | always |
| `codex:model-ratings` | `https://codexradar.com/api/model-ratings?history=14` | json | 900 | `ratings` | always |
| `codex:radar-insights` | `https://codexradar.com/api/radar-insights` | json | 900 | – | always |
| `codex:intel-efficiency` | `https://codexradar.com/api/intelligence-efficiency` | json | 1800 | – | sampled |
| `codex:intel-published` | `https://codexradar.com/data/intelligence-efficiency.json` | json | 21600 | – | always |
| `codex:subscriber-count` | `https://codexradar.com/api/subscriber-count` | json | 1800 | `subscribers` | always |
| `codex:feed` | `https://codexradar.com/feed.xml` | xml | 1800 | `rss` | always |
| `codex:logo` | `https://codexradar.com/assets/codex-logo.svg` | asset | 86400 | – | always |
| `deng:html` | `https://deng.codexradar.com/` | page | 600 | – | always |
| `deng:intro` | `https://deng.codexradar.com/intro` | page | 21600 | – | always |
| `deng:i18n` | `https://deng.codexradar.com/assets/i18n.js` | asset | 21600 | – | always |
| `deng:report-js` | `https://deng.codexradar.com/assets/radar-report.js` | asset | 21600 | – | always |
| `deng:table` | `https://api.codexradar.com/api/v1/table?ui=1` | json | 600 | `cells` | sampled |
| `deng:iq-history` | `https://api.codexradar.com/api/v1/iq-history` | json | 900 | `iq` | always |
| `deng:events` | `https://api.codexradar.com/api/v1/events?n=20` | json | 300 | `events` | always |
| `deng:leaderboard` | `https://api.codexradar.com/api/v1/leaderboard` | json | 900 | `dengstats` | sampled |

Notes:
- `deng` radar-insights is byte-identical to `codex:radar-insights` (verified) — not collected;
  the replay route aliases it.
- **Discovered-asset sweep**: the pages reference a changing set of same-origin images (QR codes,
  dated comics, orb/bike art) that cannot be enumerated as fixed feeds. After every successful
  poll of `codex:html`, `codex:html-en`, `deng:html`, or `deng:intro`, the collector extracts
  `assets/...` references from the HTML (`extractAssetRefs`) and mirrors new/changed ones (cap 30
  per sweep, dedup via feed_state.etag = cache-buster query) under synthetic feeds
  `<site>:asset:<path>`, audited as `<site>:assets`. Served at `/assets/*` and `/deng/assets/*`
  (prefix routes; explicit asset routes win). Replay pages also strip the upstream Cloudflare RUM
  beacon script so the clone makes no third-party requests (GitHub contributor avatars on the deng
  leaderboard are the accepted exception — live third-party images, not codexradar data).
- `keepRaw: "always"`: call `saveCapture(..., {storeRaw: true})` every poll — content-hash dedup
  makes unchanged polls free.
- `keepRaw: "sampled"`: these payloads embed live counters/timestamps so every poll differs.
  Store the raw body only when (a) the extractor reported changes this poll, OR (b) ≥ 3300 s since
  the last stored raw version (heartbeat), else `storeRaw: false`. Rule (a) is skipped for
  extractors that report churn on essentially every poll (the raw body would then be re-stored every
  poll, defeating the sampling): `codex:intel-efficiency` has no extractor; the leaderboard's
  `dengstats` always samples a row; and `deng:table`'s `cells` reports ≥ 1 changed cell on nearly
  every poll under continuous grading (which would re-store the ~1.9 MB body every 10 min). For all
  three, raw is anchored by the heartbeat (b) only — the per-cell deltas that make `cells` churn are
  still archived compactly in `cell_history`.
- ~600 requests/day total. This is far below the load one open browser tab of the live site
  generates (the deng page itself polls every 15–60 s).

## 4. Fetch layer — `src/fetchers.js`

```js
export const ALLOWED_HOSTS = new Set(["codexradar.com", "www.codexradar.com",
  "deng.codexradar.com", "api.codexradar.com"]);
export async function fetchUrl(url, {etag = null, timeoutMs = 20000, maxBytes, userAgent} = {})
// → {status, body: Buffer|null, etag: string|null, contentType, notModified: boolean, finalUrl}
```

- Reject non-https or host not in `ALLOWED_HOSTS` (throw `FetchPolicyError`).
- Global `fetch` (undici), `redirect: "follow"` but **validate `response.url` host is still
  allowlisted**, else throw.
- Headers: `User-Agent` from config, `Accept: */*`, `If-None-Match: etag` when given.
  (undici negotiates gzip/br transparently.)
- 304 → `{notModified: true, body: null}`.
- Stream the body; abort and throw `FetchSizeError` beyond `maxBytes` (default from config,
  8 MB decompressed).
- `AbortSignal.timeout(timeoutMs)`.
- No retries here — the collector's backoff owns retry policy.

## 5. Extractors — `src/extractors.js`

```js
export const EXTRACTORS = {ratings, subscribers, rss, iq, events, cells, dengstats};
export function runExtractor(name, archive, body /*Buffer*/, capturedAtIso)  // → {changed: number}
```

Each extractor parses the body (JSON except `rss` which parses XML by regex) and upserts via the
Archive API. All are idempotent: re-running on the same payload inserts 0 new rows. Parse errors
throw (collector records the run as failed). Verified payload shapes (fixtures in `test/fixtures/`):

- **iq** — payload `{ "<series>": [{ts, score, n}, ...], ... }` (46 series × 168 hourly points,
  series names like `gpt-5.6-sol` and `gpt-5.6-sol@low`). Skip non-array values, skip points
  missing numeric `score`. Normalize `ts` to UTC ISO. `upsertIqPoints`. changed = newly inserted.
- **events** — `{events: [{graded_at, passed, task_id, model, effort, cost_usd, cost_source,
  cost_is_estimate, points, nickname, avatar_seed}]}` → `insertEvents` (PK dedup:
  graded_at + task_id + model + effort + nickname).
- **cells** — `{tasks: [{id, title, language, repo, category, ...}], cells: {"t|m|e": {...}}}`.
  For each task → `upsertDengTask` (json = full task object stringified). For each cell:
  canonical JSON (recursively sort object keys) → sha256 → compare `latestCellHash`; changed cells
  → `upsertCellState`. changed = changed cell count. (~2128 cells; hash compare must be fast.)
- **ratings** — `{day, updated_at, models: [{id, label, group, average, count}],
  history: [{day, updated_at, models: [...]}]}` → flatten current day + all history days →
  `upsertRatingDays` (`grp` = `group`). changed = rows whose (average, count) actually changed —
  REPLACE always, but count changes by comparing existing row first.
- **subscribers** — `{ok, count}` → `insertSubscriberCount({ts: capturedAtIso, count})` only when
  `count` differs from the latest stored value (else 0 changed).
- **rss** — `feed.xml` `<item>` blocks: extract `<guid>`, `<title>`, `<link>`, `<pubDate>`,
  `<description>` (CDATA-aware, HTML entities left as-is), key = guid or link → `upsertRssItems`.
- **dengstats** — leaderboard payload → one `insertDengStats` row per poll:
  `{ts: capturedAtIso, onlineVolunteers: online_volunteers, pendingGrades: pending_grades,
  errorGrades: error_grades, contributorsCount: contributors.length,
  pedalUsdPerHour: pedal_speed?.usd_per_hour, pedalRuns: pedal_speed?.actual_runs,
  burnTokens: latest_burn?.tokens, burnUsd: latest_burn?.usd, monthLabel: month?.label}`.
  changed = 1 always (it's a time series sample). Missing/null fields → null.

## 6. Collector — `src/collector.js`

CLI: `node src/collector.js [--once] [--feed <id>]`.

- Scheduler: in-memory next-due map seeded from `feed_state.lastOkAt` (so restarts don't
  immediately re-poll everything that isn't due); jitter each scheduled run ±10 %.
  Runs due feeds **sequentially** (concurrency 1) with a ≥ 250 ms gap between requests.
- Per feed run: `fetchUrl` (with stored etag) → on 200: normalize `upstreamTs` (look for
  `generated_at | updated_at | source_updated_at | monitored_at | baseline_generated_at` string at
  the JSON top level), run extractor if any, apply keepRaw policy, `saveCapture`, `recordRun`,
  update feed_state (etag, failCount = 0). On 304: `recordRun(ok, changed: false)` only. The
  extractor and the raw archive are **decoupled**: if the extractor throws (a garbage/truncated body
  or an unforeseen upstream shape), the raw body is still archived per the keepRaw policy, then the
  run is recorded as a failure (below) — a schema drift degrades the feed to "raw-only" instead of
  losing the observation entirely.
- Failure → `recordRun(ok: false, error)`, failCount += 1,
  `backoffUntil = now + min(intervalSec * 2^failCount, 3600) s`. HTTP 429 with `Retry-After` →
  honor it (cap 3600 s). Failures never crash the loop.
- **Avatar sweep**: after any successful `deng:events` poll, `missingAvatarSeeds(40)` → fetch
  `https://api.codexradar.com/api/v1/avatar/<seed>.svg` (rate: ≤ 40/cycle, 250 ms apart).
  200 + svg → `upsertAvatar`; JSON `{"detail": "avatar not found"}` (still 200) or 404 → store a
  1-byte tombstone svg so it's not refetched. Recorded as feed `deng:avatars` in runs.
- `--once`: run every feed once (all due), then exit 0 (exit 1 if every feed failed).
- `pruneRuns(config.runsKeepDays)` at startup **and every 24 h** inside the scheduler loop, so a
  long-running (`restart: unless-stopped`) collector honours `RUNS_KEEP_DAYS` as a rolling window
  rather than only trimming on process restart. SIGINT/SIGTERM → finish current fetch, close db, exit.
- Log one line per run to stdout: `2026-07-31T02:00:00Z codex:current 200 changed=1 812ms 95KB`.

## 7. Config — `src/config.js`

```js
export function loadConfig(env = process.env)  // → frozen config object
```

Reads `.env` in cwd if present (simple KEY=VALUE lines, `#` comments; real env wins), then:
`PORT` (3210), `BIND` ("0.0.0.0"), `DATA_DIR` ("./data"), `USER_AGENT`
("dradar2/1.0 (+personal long-term archive of codexradar.com)"), `MAX_RESPONSE_MB` (8),
`RUNS_KEEP_DAYS` (30), `INTERVAL_SCALE` (1.0 — multiplies every feed interval),
`FEED_INTERVALS` (optional JSON object `{"feed:id": seconds}` overrides).

## 8. Server — `src/server.js` + `src/replay.js` + `src/api-routes.js`

`node:http` server; tiny router (method + exact path or prefix). All responses set
`X-Archive: dradar2`. JSON replay responses also set `X-Archive-Captured-At: <firstAt>` and
`Access-Control-Allow-Origin: *`. 404s: JSON `{error: "not archived"}` for API paths, minimal
HTML page for pages. Never throws to the client — top-level try/catch → 500 JSON.
Query param `at` (ISO-8601 or epoch-ms) on ANY replay route selects the newest capture
`first_at <= at`. Server opens the archive once (`openArchive`) and serves even when empty
(pages → friendly "archive is empty — run the collector" page).

### Replay routes (upstream-compatible paths)

| route | feed | notes |
|---|---|---|
| `GET /` | `codex:html` | patched page (below) |
| `GET /en` | `codex:html-en` | patched page |
| `GET /current.json` | `codex:current` | |
| `GET /feed.xml` | `codex:feed` | `application/rss+xml` |
| `GET /api/model-ratings` | `codex:model-ratings` | upstream query ignored |
| `GET /api/radar-insights` | `codex:radar-insights` | |
| `GET /api/intelligence-efficiency` | `codex:intel-efficiency` | |
| `GET /data/intelligence-efficiency.json` | `codex:intel-published` | any `?v=` |
| `GET /api/subscriber-count` | `codex:subscriber-count` | |
| `POST /api/subscribe` | – | 200 `{ok:false, error:"archive replica — 订阅在存档副本中不可用"}` |
| `GET /assets/codex-logo.svg`, `/favicon.ico` | `codex:logo` | `image/svg+xml` |
| `GET /deng/` `/deng/en` | `deng:html` | patched page (upstream serves identical bytes for `/en`) |
| `GET /deng` | – | 301 redirect → `/deng/` (so the page's document-relative asset URLs resolve under the mount; preserves `?at=`) |
| `GET /deng/intro` | `deng:intro` | patched page (timebar only) |
| `GET /deng/assets/i18n.js` | `deng:i18n` | `text/javascript`, any `?v=` |
| `GET /deng/assets/radar-report.js` | `deng:report-js` | `text/javascript`, any `?v=`; **patched** — `apiRoot()` rewritten to `location.origin + "/deng-api"` (else the report launcher would fetch live upstream / the dead dev port) |
| `GET /deng-api/api/v1/table` | `deng:table` | |
| `GET /deng-api/api/v1/iq-history` | `deng:iq-history` | |
| `GET /deng-api/api/v1/events` | `deng:events` | |
| `GET /deng-api/api/v1/leaderboard` | `deng:leaderboard` | |
| `GET /deng-api/api/v1/radar-insights` | `codex:radar-insights` | alias (verified identical) |
| `GET /deng-api/api/v1/avatar/<seed>.svg` | avatars table | fallback: neutral generated SVG circle, 200 |
| `GET /deng-api/api/v1/whoami` | – | 401 `{detail:"archive replica"}` |
| any other `/deng-api/*` GET | – | 404 JSON |
| any `/deng-api/*` POST/PUT/DELETE | – | 403 `{detail:"read-only archive"}` |
| `GET /__archive/timebar.js` | static file `src/public/timebar.js` | |
| `GET /history` `/history/events` `/history/cells` `/sources` | static HTML from `src/public/` | |
| `GET /archive-api/*` | see §9/§10 | |

### Page patching — `src/replay.js`

```js
export function resolveAt(query)           // "at" → ISO string | null (accepts ISO or epoch ms)
export function patchCodexHtml(html, {feedId, capturedAt, at})
export function patchDengHtml(html, {feedId, capturedAt, at})
export function patchIntroHtml(html, {feedId, capturedAt, at})
export function patchReportJs(js)          // rewrite radar-report.js apiRoot() → location.origin + "/deng-api"
```

All pages: inject right after `<head>` (first occurrence, case-insensitive):
`<script src="/__archive/timebar.js" data-feed="<feedId>" data-captured-at="<firstAt>"
data-at="<at or empty>" defer="false"></script>` — it must be the FIRST script so its fetch wrapper
is installed before any page script runs. (Inline `defer` is ignored for inline-injected src
scripts loaded synchronously — plain `<script src>` without defer/async is correct here.)

`patchCodexHtml` additionally rewrites `href="https://deng.codexradar.com"` (and with trailing
slash) → `href="/deng/"`.

`patchDengHtml` additionally:
1. `var API = "https://api." + apex;` → `var API = location.origin + "/deng-api";`
   (exact string; fallback regex `/var API = "https:\/\/api\." \+ \w+;/`).
2. Neutralize the local-dev override
   `if (host === "localhost" || host === "127.0.0.1") API = "http://127.0.0.1:8399";` →
   replace the whole statement with `;` (exact then regex
   `/if \(host === "localhost"[^\n]*API = "http:\/\/127\.0\.0\.1:8399";/`).
3. Rewrite `href="https://codexradar.com"` / `...com/"` → `href="/"`, AND neutralize the runtime
   re-derivation in `syncMainSiteLinks()` (which reassigns `#backlink`/`#backlink2`/`#iq-main-site-link`
   to the live apex on every load): repoint those `el.href = "https://" + apex + …` /
   `iqLink.href = "https://codexradar.com" + …` assignments to `"/"` so the backlinks stay inside the
   clone (and, under `?at=`, don't jump from the archived snapshot to today's live site).
4. If patch 1 finds no match, still serve, and add
   `<script>window.__DRADAR_PATCH_WARNING = "deng API base patch failed";</script>` after the
   timebar script (timebar shows a warning badge).

### `src/public/timebar.js` (self-contained IIFE, zh + en labels)

- Reads its own `<script>` dataset (`document.currentScript`).
- **Fetch wrapper**: wraps `window.fetch`; when an `at` value is active, same-origin requests whose
  pathname starts with `/api/`, `/data/`, `/deng-api/`, or equals `/current.json` get
  `at=<value>` appended. (Relative URLs resolved against `location`.) Handles all three fetch input
  forms — string, `URL` object (`.href`), and `Request` (`.url`).
- UI, styled scoped under `#dradar-timebar` (dark, monospace, cyan/green accent, fixed
  bottom-right, z-index 2147483000): collapsed pill `🗄 存档 ARCHIVE`; expanded panel shows:
  - snapshot time being viewed (Asia/Shanghai formatted) + `LIVE-latest` badge when no `at`;
  - controls: `⏮ 上一版` `下一版 ⏭` `最新 latest`, date input + version `<select>` (populated from
    `/archive-api/versions?feed=<feed>&day=YYYY-MM-DD`), Go → navigates to `?at=<firstAt>`;
  - nav links: `主站 /` · `分布式 /deng/` · `长期历史 /history` · `采集状态 /sources`;
  - attribution: `数据来自 Codex 雷达 codexradar.com` (link out) + `dradar2 archive replica`.
- Prev/next resolved via `/archive-api/versions?feed=X&before=<current>&limit=1` /
  `&after=<current>&limit=1`.
- No external requests besides `/archive-api/versions`. Must not break when `/archive-api` is
  empty. Keep it ≤ ~8 KB.

## 9. Archive meta API — `src/api-routes.js`

- `GET /archive-api/health` → `{ok: true, now, feeds: feedsSummary(), db: dbStats()}`
- `GET /archive-api/versions?feed=<id>&day=YYYY-MM-DD | &before=<iso> | &after=<iso> | &from&to, &limit`
  → `{feed, versions: [{firstAt, lastAt, bytes}]}` (limit ≤ 1000, default 200; `day` interpreted
  in Asia/Shanghai (UTC+8) day boundaries; `before`/`after` return the single adjacent version).
- `GET /archive-api/runs?feed=&limit=` → recent collection runs.

## 10. History API — `src/history-api.js` (mounted under `/archive-api/`)

All GET, JSON, validated params, bounded output:

- `GET /archive-api/iq-series` → `listIqSeries()`
- `GET /archive-api/iq?series=a,b,c&from=&to=&maxPoints=` → `queryIqSeries` (≤ 12 series/req)
- `GET /archive-api/events?model=&effort=&task=&nickname=&passed=&q=&from=&to=&limit=&offset=`
- `GET /archive-api/tasks` → `listDengTasks()`
- `GET /archive-api/cell-history?task=&model=&effort=`
- `GET /archive-api/ratings?from=YYYY-MM-DD&to=` (day strings)
- `GET /archive-api/subscribers?from=&to=`
- `GET /archive-api/deng-stats?from=&to=&maxPoints=`

## 11. Custom pages — `src/public/*.html` (Agent C)

Self-contained (inline CSS/JS, no external fonts/CDNs), dark radar/terminal aesthetic coherent
with the upstream deng page (near-black green/cyan panels, monospace stack), bilingual labels
(中文 primary, en subtitle), all data via `/archive-api/*`, times displayed Asia/Shanghai.
Hand-rolled inline SVG charts (no libraries): line charts with axes, gridlines, hover crosshair +
tooltip, series legend with toggle, and range presets `48h 7d 30d 90d 全部all`. The whole point:
these charts show MORE than upstream's 48 h / 7 d windows.

- `history.html` — long-range dashboard: (1) model IQ over time (series multiselect, default the
  3 family aggregates `gpt-5.6-sol|terra|luna`); (2) model ratings daily averages (from ratings);
  (3) subscriber count growth; (4) deng ops stats (online volunteers, error grades, $/h burn).
  Each panel notes upstream's own retention window vs ours.
- `history-events.html` — searchable table over `/archive-api/events` (filters: model, effort,
  task, nickname, passed, free text; pagination; pass/fail coloring; cost + points columns).
- `history-cells.html` — pick task (searchable select) + model + effort → timeline of that cell's
  archived states (state, pass rate, multiplier, last_graded_at) rendered as a vertical timeline.
- `sources.html` — per-feed health table from `/archive-api/health` + recent runs from
  `/archive-api/runs`: last capture age, versions, stored bytes, error streaks; total db size.

Every page header links: 主站 clone `/` · 分布式 clone `/deng/` · the other history pages ·
attribution to upstream.

## 12. Seeding — `scripts/seed-fixtures.js` (Agent A)

`node scripts/seed-fixtures.js [dataDir]` (default `./data`): loads every file in
`test/fixtures/` into the archive as captures with `capturedAt = now`, mapping:
`codexradar.html→codex:html`, `deng.html→deng:html`, `current.json→codex:current`,
`model-ratings.json→codex:model-ratings`, `radar-insights.json→codex:radar-insights`,
`intel-eff.json→codex:intel-efficiency`, `intel-published.json→codex:intel-published`,
`subscriber-count.json→codex:subscriber-count`, `feed.xml→codex:feed`,
`codex-logo.svg→codex:logo`, `deng-intro.html→deng:intro`, `i18n.js→deng:i18n`,
`radar-report.js→deng:report-js`, `deng-table.json→deng:table`,
`deng-iq-history.json→deng:iq-history`, `deng-events.json→deng:events`,
`deng-leaderboard.json→deng:leaderboard`; runs matching extractors too.
Prints a summary. Used for offline demo + Agent D's integration tests.

## 13. Tests (Agent D) — `node --test test/`

Use `node:test` + `node:assert/strict`. Temp dirs via `fs.mkdtempSync(os.tmpdir())`; ALWAYS use
temp data dirs, never `./data`. **No network access to upstream in any test** — fixtures only;
fetcher tests use a local `node:http` server on port 0.

- `db.test.js` — saveCapture dedup/state-periods; latestCapture at-semantics (before-first,
  between versions, after-last); storeRaw:false path; upsertCellState transitions.
- `extractors.test.js` — run each extractor on its fixture twice → second run changed = 0
  (except `dengstats` which always samples); spot-check known values from fixtures (e.g. iq series
  count = 46, first event nickname "JJ-Lin", ratings history days = 14 + today, rss items > 0).
- `fetchers.test.js` — allowlist rejection, size-cap abort, 304 handling, etag pass-through
  (local server).
- `replay.test.js` — patchDengHtml on the real `deng.html` fixture: API var patched, localhost
  override gone, timebar injected exactly once as first head script, backlink rewritten;
  patchCodexHtml on `codexradar.html`; resolveAt parsing (ISO, epoch-ms, garbage → null).
- `server.test.js` — seed temp db from fixtures (reuse seed script's function), boot server on
  port 0, real `fetch`: `/` 200 + timebar present; `/deng/` patched; `/deng-api/api/v1/table`
  bytes equal fixture; `?at=` in the past returns older version after inserting two versions;
  `POST /api/subscribe` stub; `/deng-api/api/v1/whoami` 401; POST claim 403; `/archive-api/health`;
  history API smoke (`/archive-api/iq-series` non-empty, `/archive-api/events?limit=5`).
- Target: meaningful coverage of every module, all green, < 60 s total.

## 14. Docker (Agent D)

- `Dockerfile`: `FROM node:24-alpine`, copy `package.json src/ scripts/ schema.sql test/fixtures/`
  (fixtures enable in-container seeding), non-root `node` user, `ENV DATA_DIR=/data`,
  default CMD server.
- `compose.yaml`: services `web` (ports `3210:3210`, healthcheck GET `/archive-api/health` via
  `wget -qO-`) and `collector` (`command: node src/collector.js`, `restart: unless-stopped`),
  both mounting volume `./data:/data`.
- `README.md`: what/why (48 h → forever), quickstart (seed + dev), production compose, config
  table, endpoint map (clone paths + archive APIs), storage-growth estimate (~20–60 MB/day worst
  case, mostly the two HTML feeds + table), attribution & upstream-courtesy note (public GET
  endpoints only, modest cadence, attribution shown, no auth-gated API use, how to lower cadence
  via `INTERVAL_SCALE`), LAN exposure warning (bind, no auth — keep on trusted LAN).

## 15. package.json (already written — do not edit)

Scripts: `start`, `collect`, `collect:once`, `seed:fixtures`, `test`. `"type": "module"`,
`engines.node >= 22.5`. Zero dependencies.
