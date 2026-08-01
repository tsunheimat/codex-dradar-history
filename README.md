# dradar2

## A long-term history collector for Codex Radar

**Live archive:** [dradar.webhei.top](https://dradar.webhei.top)

dradar2 continuously collects the public, read-only data behind [Codex Radar](https://codexradar.com)
and [Distributed Radar](https://deng.codexradar.com), then turns short-lived dashboards into a
searchable archive. It preserves snapshots, events, model ratings, IQ data, subscriber counts,
benchmark state changes, RSS items, and operational statistics so they can be explored long after
the upstream rolling windows have moved on.

> 数据来自 Codex 雷达 · codexradar.com. dradar2 is an independent archive and is not affiliated
> with the upstream project.

## Why it exists

Live dashboards answer: **what is happening now?**

The collector adds the missing historical view:

- What did the radar show on a particular day?
- When did a model, task, or benchmark cell change state?
- How did IQ, ratings, subscribers, or operations change over time?
- Which events and observations have disappeared from the upstream site?

The result is both a mirror and a time machine. Open the newest captured state, or request an
archived instant with `?at=<timestamp>`.

## What it collects

The collector uses a fixed allowlist of public HTTPS hosts and polls at a modest, configurable
cadence. It stores raw response versions with SHA-256 content deduplication and extracts append-only
history into SQLite tables for:

- IQ points and intelligence-efficiency data
- Graded events and searchable task history
- Benchmark-cell state timelines
- Model ratings and subscriber growth
- RSS items and Distributed Radar operating statistics
- Same-origin page assets needed for offline replay

The server is read-only. It does not log in, claim tasks, submit ratings, subscribe users, or call
the key-gated full API. Replayed pages use local API and asset paths, so they do not need to contact
the upstream sites or third-party analytics.

## How it works

```text
public Codex Radar endpoints
             |
             v
collector -> raw captures + extracted history -> archive.sqlite
                                                   |
                                                   v
                       read-only mirror + history server
```

Two Node processes share one SQLite database:

- `src/collector.js` polls feeds, deduplicates content, discovers page assets, and updates history.
- `src/server.js` serves mirror pages, archive APIs, charts, and timestamp-based replays.

Older text captures are packed with Brotli. Large image assets can be tiled and recomposed with
`sharp`, keeping long-running archives practical.

## Explore the live archive

Open **[dradar.webhei.top](https://dradar.webhei.top)** to browse the deployed instance.

Useful views include:

| Path | Description |
| --- | --- |
| `/` | Codex Radar mirror |
| `/deng/` | Distributed Radar mirror |
| `/history` | Long-range IQ, ratings, subscribers, and operations |
| `/history/events` | Searchable graded-event history |
| `/history/cells` | Benchmark-cell state timelines |
| `/sources` | Collector health, feed versions, and storage information |

Mirror pages and archive API routes accept `?at=` with an ISO-8601 timestamp or epoch milliseconds:

```text
https://dradar.webhei.top/?at=2026-07-20T12:00:00Z
https://dradar.webhei.top/deng/?at=1785000000000
```

## Run locally

Requirements: Node.js 22.5 or newer (developed and deployed on Node 24) and npm.

```sh
npm install
npm run seed:fixtures   # optional: create an offline demo archive
npm start
```

Then open <http://localhost:3210/>. To collect live observations, run the collector in a second
shell:

```sh
npm run collect          # continuous polling
npm run collect:once     # collect feeds that are due, then exit
```

The fixture seed is local and does not contact upstream. Run the test suite with:

```sh
npm test
```

Tests use temporary data, captured fixtures, and local test servers; they do not request the public
Codex Radar sites.

## Docker Compose

Start the web server and collector together:

```sh
docker compose up -d
```

Both services share `./data`. The `web` service listens on port `3210`; the `collector` service
writes to the same SQLite archive. Seed an empty deployment with the bundled fixtures if needed:

```sh
docker compose run --rm web node scripts/seed-fixtures.js
```

The default image is:

```text
ghcr.io/tsunheimat/codex-dradar-history:latest
```

Set `DRADAR2_IMAGE` in `.env` to pin a release or immutable image tag. Hosts without Docker can use
the user units in `deploy/dradar2-web.service` and `deploy/dradar2-collector.service`.

## Configuration

Configuration is read from environment variables; a local `.env` file is supported. See
[`.env.example`](.env.example) for the complete list.

| Variable | Default | Description |
| --- | --- | --- |
| `PORT` | `3210` | Mirror and history server port |
| `BIND` | `0.0.0.0` | Bind address; use `127.0.0.1` for local-only access |
| `DATA_DIR` | `./data` | Directory containing `archive.sqlite` |
| `USER_AGENT` | `dradar2/1.0 (+personal long-term archive of codexradar.com)` | Collector identification sent upstream |
| `MAX_RESPONSE_MB` | `8` | Maximum decompressed response size |
| `RUNS_KEEP_DAYS` | `30` | Retention for collector audit rows; raw captures remain archived |
| `INTERVAL_SCALE` | `1.0` | Scale polling intervals; `2.0` polls half as often |
| `FEED_INTERVALS` | empty | JSON per-feed interval overrides |

## Courtesy, security, and content

dradar2 uses public GET endpoints only, identifies itself with `USER_AGENT`, keeps the request rate
configurable, and preserves upstream attribution. If you run an instance, keep the cadence polite
and leave the attribution in place.

The server has no authentication. Anyone who can reach `PORT` can read the complete local archive;
keep it on a trusted network or behind your own authentication proxy/VPN. Set `BIND=127.0.0.1` for
local-only access.

This is a personal, non-commercial archival tool. Archived pages, images, and data belong to their
upstream owners. dradar2 stores and re-displays those observations with attribution and does not
claim ownership of upstream content.
