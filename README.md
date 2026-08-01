# dradar2

**A personal, read-only, long-term archive and time-travel clone of
[codexradar.com](https://codexradar.com) (Codex 雷达) and
[deng.codexradar.com](https://deng.codexradar.com) (分布式雷达 Codex 站).**

> 数据来自 Codex 雷达 · codexradar.com — dradar2 is an independent archive replica, not affiliated
> with the upstream project.

The public Codex Radar sites only keep short rolling windows: the **last 20 graded events**,
**7 days** of hourly IQ points, the **latest** state per benchmark cell, **48 h** comparisons, a
**14-day** rating history. dradar2 quietly writes all of that down **forever** and lets you scroll
back through it.

Two small Node processes share one SQLite file:

- a **collector** that polls the same public GET endpoints the pages themselves use and stores
  every observation, and
- a **server** that replays **pixel-faithful clones of both sites at any archived instant**
  (`?at=…`), plus custom long-range history dashboards that reach far past the upstream windows.

The service uses the Node standard library plus **one runtime npm dependency** (`sharp` for comic
image tiling), with no build step.

---

## Why

Codex Radar is a live snapshot. It answers "what does the leaderboard look like *right now*". It
cannot answer "what did this model's IQ curve look like six weeks ago", "when did this benchmark
cell flip from `active` to `cooldown`", or "show me every graded event this contributor ever ran".
dradar2 keeps the raw payloads and the merged long-term tables so those questions become trivial —
while touching upstream far more gently than a single open browser tab (see
[Upstream courtesy](#attribution--upstream-courtesy)).

---

## Architecture

```
        public GET endpoints (codexradar.com / deng.codexradar.com / api.codexradar.com)
                                     │  (allowlisted, GET-only, modest cadence)
                                     ▼
  ┌─────────────┐   fetch    ┌──────────────┐   extract    ┌───────────────────────────┐
  │ collector.js│──────────▶ │ fetchers.js  │────────────▶ │ extractors.js             │
  │ (scheduler, │            │ (allowlist,  │              │ iq · events · cells ·      │
  │  backoff,   │            │  size cap,   │              │ ratings · subscribers ·    │
  │  avatars)   │            │  etag/304)   │              │ rss · dengstats            │
  └─────────────┘            └──────────────┘              └───────────────┬───────────┘
         │  raw bodies (content-addressed, gzip-9 → brotli packs)          │ merged rows
         ▼                                                                 ▼
  ┌──────────────────────────────────────────────────────────────────────────────────┐
  │ db.js  →  archive.sqlite (WAL)                                                     │
  │   blobs · captures (state-periods) · runs · feed_state                            │
  │   iq_points · deng_events · cell_history · deng_tasks · model_ratings_daily ·     │
  │   subscriber_counts · rss_items · deng_stats · avatars                            │
  └──────────────────────────────────────────────────────────────────────────────────┘
         ▲
         │ read-only
  ┌─────────────┐   replay    ┌──────────────┐   history   ┌───────────────────────────┐
  │ server.js   │───────────▶ │ replay.js    │             │ history-api.js            │
  │ (http router│             │ (page patch, │             │ /archive-api/* JSON       │
  │  + at=)     │             │  timebar)    │             │ + history/*.html charts   │
  └─────────────┘             └──────────────┘             └───────────────────────────┘
```

- **Content-addressed storage.** Each raw body is `sha256`-hashed; unchanged polls extend a
  capture's `last_at` instead of storing a duplicate. New blobs are gzip level 9; a daily packer
  then folds each feed's older text snapshots into one **brotli stream per feed** — consecutive
  versions share the whole page shell and differ by ~1 KB of data, so the packed history is ~8×
  smaller than per-snapshot gzip. Reads are transparent; every packed byte is sha256-verified.
- **Composite-image tiling.** Dated `radar-high-readout-comic-*.png` assets are decoded into
  content-addressed WebP tiles (quality 90 — visually faithful, ~4× smaller than lossless; comics
  never share pixels between frames, so lossless tiles bought nothing) plus a small manifest;
  if a tiled representation is larger than the original gzip-9 PNG, capture automatically falls
  back to the original bytes. Replay composes the manifest back to PNG at the same URL.
- **State periods.** `captures` records one row per *content-state period* of a feed, so
  `?at=<t>` resolves to the version that was live at instant `t` (newest capture with
  `first_at <= t`).
- **Merged long-term tables.** Extractors fold each payload into append-only history tables
  (hourly IQ points, graded events, per-cell state changes, daily rating averages, subscriber
  growth, deng ops stats) that outlive upstream's rolling windows.
- **Time-travel toolbar.** Every cloned page gets a small `timebar.js` injected as its first
  `<head>` script; it rewrites same-origin API calls to carry the active `at=` and lets you step
  between archived versions.
- **Discovered-asset sweep.** After each page poll the collector scans the HTML for same-origin
  `assets/...` references (QR codes, dated comics, orb/bike art — the set changes over time) and
  mirrors new or re-versioned ones automatically (≤ 30 per sweep, keyed by cache-buster). The
  replayed pages therefore render fully offline; the upstream Cloudflare analytics beacon and
  removed ladder assets are excluded, so the replica makes **no third-party requests**.

---

## Quickstart (local, no Docker)

Requires **Node ≥ 22.5** (developed and shipped on **Node 24**). Install the native image codec
dependency once with `npm install` (the `sharp` package powers comic tile encoding/decoding).

```sh
# 1. (optional) seed the archive with the bundled real fixtures for an instant offline demo
node scripts/seed-fixtures.js ./data

# 2. start the read-only replay + history server
npm start                 # → http://localhost:3210

# 3. in another shell, start collecting live observations
npm run collect           # long-running poller
#    or a single pass of every due feed, then exit:
npm run collect:once
```

Open:

- <http://localhost:3210/> — Codex Radar clone (with the archive time-travel toolbar)
- <http://localhost:3210/deng/> — 分布式雷达 clone
- <http://localhost:3210/history> — long-range IQ / ratings / subscribers / ops dashboards
- <http://localhost:3210/history/events> — searchable graded-event history
- <http://localhost:3210/history/cells> — per-cell state timeline
- <http://localhost:3210/sources> — collector health & storage

Add `?at=2026-07-20T12:00:00Z` (ISO-8601) or `?at=1785000000000` (epoch-ms) to **any** clone or
API route to view the archive as it stood at that moment.

### Tests

```sh
node --test 'test/*.test.js'    # DB, extractors, fetchers, replay, full server E2E
```

> On Node 24 pass the glob (`'test/*.test.js'`), not the bare directory: the test runner cannot
> take a directory argument, and its no-argument default glob would also try to execute the `.js`
> asset fixtures under `test/fixtures/`. The glob scopes discovery to the test suite files.

The suite uses only `node:test` + `node:assert/strict`, temp data dirs (never `./data`), and a
local self-signed HTTPS server for the fetch layer. **No test touches the upstream network** — it
runs entirely against the captured fixtures in `test/fixtures/`.

---

## Production (Docker Compose)

```sh
docker compose up -d
```

Compose pulls the published GHCR image and starts two services sharing the `./data` volume:

| service     | command                 | notes                                             |
|-------------|-------------------------|---------------------------------------------------|
| `web`       | `node src/server.js`    | port `3210`, healthcheck `GET /archive-api/health`|
| `collector` | `node src/collector.js` | `restart: unless-stopped`, polls upstream         |

Seed an empty deployment with the bundled fixtures (optional):

```sh
docker compose run --rm web node scripts/seed-fixtures.js
```

The SQLite database (`archive.sqlite` + WAL files) persists in `./data` on the host.

To pin a release or an immutable commit image, set `DRADAR2_IMAGE` in `.env` before deploying:

```sh
DRADAR2_IMAGE=ghcr.io/tsunheimat/codex-dradar-history:sha-40671a7
```

### Container image

GitHub Actions uses GitHub-hosted npm and BuildKit caches, then tests, builds, and smoke-tests the
container once per run. Pushes to `master` and `v*` tags publish the tested `linux/amd64` image to:

```text
ghcr.io/tsunheimat/codex-dradar-history:latest
```

Default-branch builds also receive `master` and `sha-<commit>` tags. Version tags are preserved
as image tags. The GitHub package must be made public once in the package settings if anonymous
pulls are required.

### Production without Docker (systemd)

On a host without Docker, use the user units in `deploy/`:

```sh
mkdir -p ~/.config/systemd/user
cp deploy/dradar2-*.service ~/.config/systemd/user/
# edit WorkingDirectory in both units to this repo's absolute path, then:
systemctl --user daemon-reload
systemctl --user enable --now dradar2-web dradar2-collector
loginctl enable-linger "$USER"   # keep them running after logout
```

---

## Configuration

All configuration is via environment variables (a `.env` file in the working directory is read if
present; real environment variables win). See `.env.example`.

| Variable          | Default                                                        | Purpose                                                         |
|-------------------|---------------------------------------------------------------|----------------------------------------------------------------|
| `PORT`            | `3210`                                                        | Web server port.                                               |
| `BIND`            | `0.0.0.0`                                                     | Web server bind address.                                       |
| `DATA_DIR`        | `./data`                                                      | Directory holding `archive.sqlite`.                            |
| `USER_AGENT`      | `dradar2/1.0 (+personal long-term archive of codexradar.com)`| Collector User-Agent (identifies the archiver to upstream).    |
| `MAX_RESPONSE_MB` | `8`                                                          | Per-response decompressed size cap.                            |
| `RUNS_KEEP_DAYS`  | `30`                                                         | Prune collector audit rows older than this many days.          |
| `INTERVAL_SCALE`  | `1.0`                                                        | Multiply **every** feed interval (`2.0` = poll half as often). |
| `FEED_INTERVALS`  | *(empty)*                                                    | JSON per-feed overrides, e.g. `{"deng:table":1200,"codex:html":900}`. |

---

## Endpoint map

**Upstream-compatible clone routes** (each accepts `?at=`):

| Path | Serves |
|---|---|
| `GET /`, `/en` | Codex Radar page (patched) |
| `GET /current.json` | live snapshot JSON |
| `GET /feed.xml` | RSS feed |
| `GET /api/model-ratings`, `/api/radar-insights`, `/api/intelligence-efficiency` | API payloads |
| `GET /data/intelligence-efficiency.json` | published efficiency data |
| `GET /api/subscriber-count` | subscriber count |
| `POST /api/subscribe` | stub → `{ok:false, …}` (no-op on a replica) |
| `GET /assets/codex-logo.svg`, `/favicon.ico` | logo |
| `GET /assets/*` | any page-referenced asset (QR codes, comics, …) mirrored by the discovered-asset sweep |
| `GET /deng`, `/deng/`, `/deng/en`, `/deng/intro` | 分布式雷达 pages (patched) |
| `GET /deng/assets/i18n.js` | deng assets |
| `GET /deng/assets/*` | swept deng assets (model art, community images, …) |
| `GET /deng-api/api/v1/{table,iq-history,events,summary,radar-insights}` | reduced deng API payloads |
| `GET /deng-api/api/v1/avatar/<seed>.svg` | archived avatar (neutral fallback if unknown) |

**Archive & history APIs** (JSON, all under `/archive-api/`):

| Path | Returns |
|---|---|
| `GET /archive-api/health` | collector/feed summary + DB stats |
| `GET /archive-api/versions?feed=&day=&before=&after=&from=&to=&limit=` | version list for a feed |
| `GET /archive-api/runs?feed=&limit=` | recent collection runs |
| `GET /archive-api/iq-series`, `/iq?series=&from=&to=&maxPoints=` | long-term IQ history |
| `GET /archive-api/events?model=&effort=&task=&nickname=&passed=&q=&from=&to=&limit=&offset=` | graded events |
| `GET /archive-api/tasks`, `/cell-history?task=&model=&effort=` | tasks + per-cell state history |
| `GET /archive-api/ratings?from=&to=`, `/subscribers?from=&to=`, `/deng-stats?from=&to=&maxPoints=` | daily/growth/ops series |

**Custom pages:** `/history`, `/history/events`, `/history/cells`, `/sources`,
and the injected `/__archive/timebar.js`.

---

## Storage growth estimate

Storage is dominated by the dated comics (~12 frames/day at ~350 KB each as q90 tiles); the text
feeds all but vanish once packed, and the merged history tables grow slowly by comparison. With
content-hash dedup (identical polls cost nothing), per-feed brotli packing of text history
(consecutive versions differ by ~1 KB, measured ~8× smaller than per-snapshot gzip-9) and
quality-90 comic tiles, expect roughly **~5 MB/day (~150 MB/month)**. On an archive that predates
packing, run `npm run compact` once to re-encode lossless tiles, pack the backlog and VACUUM —
measured on live data this shrank the database from 43.5 MB to 11.7 MB.

| Feed(s) | Raw size | Poll cadence | Dominant cost |
|---|---|---|---|
| `codex:html`, `deng:html` | ~350–400 KB each | 10 min | biggest contributor when content churns |
| `deng:table` | ~2.25 MB upstream / ~108 KB archived | 10 min, **sampled** (heartbeat; reduced IQ/efficiency fields only) | upper model-IQ and efficiency widgets |
| `codex:current`, `deng:iq-history`, ratings, leaderboard summary | 30 KB–430 KB | 5–15 min | modest, mostly deduped |
| merged tables (iq_points, deng_events, …) | small rows | per change | matrix history and contributor rows are no longer populated |

Lower the footprint (and the request rate) by raising `INTERVAL_SCALE` or setting per-feed
`FEED_INTERVALS`. Old collector audit rows are pruned automatically after `RUNS_KEEP_DAYS` (at
startup and every 24 h while running, so the retention window holds even across months of
uninterrupted uptime); raw captures and history are kept indefinitely — that is the point.

---

## Attribution & upstream courtesy

dradar2 is a **personal archive replica** and displays the attribution
**"数据来自 Codex 雷达 · codexradar.com"** in the injected archive toolbar and on every custom page,
linking back to the upstream sites.

It is deliberately a good citizen of the public endpoints:

- **Public GET endpoints only**, against a fixed host allowlist
  (`codexradar.com`, `deng.codexradar.com`, `api.codexradar.com`). No other host is ever contacted.
- **No authentication and no auth-gated API.** No login/OAuth, no task claiming, no rating
  submission, no subscribe, and **no use of the key-gated `api/v1/current` full API**.
- **Modest cadence.** ~600 requests/day total across all feeds — far below what a single open
  browser tab of the live deng page generates (it polls every 15–60 s on its own). Content-hash
  dedup, ETag/`If-None-Match`, and exponential backoff keep the load light and well-behaved.
- **Easy to dial down.** Set `INTERVAL_SCALE=2` (or higher) to halve the request rate globally, or
  override individual feeds with `FEED_INTERVALS`.

If you run your own instance, please keep the attribution intact and the cadence polite.

---

## Security & exposure

⚠️ **dradar2 has no authentication of any kind.** The server is a read-only replica, but it will
serve your entire archive to anyone who can reach `PORT`. Keep it on a **trusted LAN** (or behind
your own auth proxy / VPN). By default it binds `0.0.0.0`; set `BIND=127.0.0.1` to restrict it to
the local host. Do not expose it directly to the public internet.

---

## License / use

Personal, non-commercial archival tool. All archived content belongs to the upstream Codex Radar
project; dradar2 only stores and re-displays it with attribution. Respect upstream's terms.
