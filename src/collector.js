// Sequential polling collector. Fetches each feed on its own cadence, dedups
// via content hashing, runs extractors, honors etag/backoff, and (after a
// successful deng:events poll) sweeps missing avatars. GET-only, allowlisted.
import { pathToFileURL } from "node:url";
import { loadConfig } from "./config.js";
import { openArchive } from "./db.js";
import {
  FEEDS,
  getFeed,
  ASSET_SWEEP_PAGES,
  EXPLICIT_ASSET_PATHS,
  assetFeedId,
} from "./feeds.js";
import { fetchUrl } from "./fetchers.js";
import { runExtractor } from "./extractors.js";

const UPSTREAM_TS_FIELDS = [
  "generated_at",
  "updated_at",
  "source_updated_at",
  "monitored_at",
  "baseline_generated_at",
];
const AVATAR_BASE = "https://api.codexradar.com/api/v1/avatar/";
const HEARTBEAT_MS = 3300 * 1000;
const REQUEST_GAP_MS = 250;
// Extractors whose per-poll "changed" count is churn, not a meaningful content
// change, so it must NOT anchor raw storage for a keepRaw:"sampled" feed (else
// the raw body would be re-stored every poll). See decideStoreRaw / SPEC §3.
const SAMPLER_EXTRACTORS = new Set(["dengstats", "cells"]);

class HttpError extends Error {
  constructor(status, retryAfter) {
    super(`HTTP ${status}`);
    this.status = status;
    this.retryAfter = retryAfter ?? null;
  }
}

// -------------------------------------------------------------- small helpers

function nowIso() {
  return new Date().toISOString();
}

function logLine(startedAt, feedId, status, changed, durationMs, bytes) {
  const stamp = startedAt.replace(/\.\d{3}Z$/, "Z");
  const kb = Math.round((bytes || 0) / 1024);
  console.log(`${stamp} ${feedId} ${status} changed=${changed} ${durationMs}ms ${kb}KB`);
}

function extractUpstreamTs(feed, body) {
  if (feed.kind !== "json") return null;
  let d;
  try {
    d = JSON.parse(body.toString("utf8"));
  } catch {
    return null;
  }
  if (!d || typeof d !== "object") return null;
  for (const k of UPSTREAM_TS_FIELDS) {
    if (typeof d[k] === "string") {
      const t = new Date(d[k]);
      if (!Number.isNaN(t.getTime())) return t.toISOString();
    }
  }
  return null;
}

/**
 * extractAssetRefs(html) → [{path, query}] unique by path.
 * Finds same-origin `assets/...` references in any of the forms the pages use:
 * src="assets/x", src='assets/x' (inside JS string literals), url("assets/x"),
 * url(assets/x). Paths are document-relative; query strings are cache-busters.
 */
export function extractAssetRefs(html) {
  const seen = new Map();
  const re = /["'(]((?:\.\/)?assets\/[A-Za-z0-9_\-./]+?)(\?[A-Za-z0-9_\-=&.%]*)?["')]/g;
  const s = String(html);
  let m;
  while ((m = re.exec(s)) !== null) {
    let path = m[1].replace(/^\.\//, "");
    if (path.includes("..")) continue;
    if (!seen.has(path)) seen.set(path, { path, query: m[2] || "" });
  }
  return [...seen.values()];
}

const ASSET_SWEEP_CAP = 30;

export function createCollector(config, archive) {
  function intervalMs(feed) {
    const base = config.feedIntervals[feed.id] ?? feed.intervalSec;
    return Math.max(1, base * config.intervalScale) * 1000;
  }

  function decideStoreRaw(feed, extractorChanged) {
    if (feed.keepRaw === "always") return true;
    // sampled: keep raw only on a meaningful content change, or as a heartbeat.
    // Extractors that report churn on essentially every poll (SAMPLER_EXTRACTORS)
    // do NOT count as a meaningful content change (or the sampling would store
    // the raw body every poll, defeating its purpose): `dengstats` always reports
    // 1, and `cells` reports ≥1 changed cell on nearly every poll under
    // continuous grading — which would re-store the ~1.9 MB deng:table body every
    // 10 min. Both are anchored by the heartbeat instead; the per-cell deltas
    // that make `cells` churn are already archived compactly in cell_history.
    const meaningful = extractorChanged > 0 && !SAMPLER_EXTRACTORS.has(feed.extractor);
    if (meaningful) return true;
    const last = archive.latestCapture(feed.id);
    if (!last) return true;
    return Date.now() - Date.parse(last.lastAt) >= HEARTBEAT_MS;
  }

  function handleFailure(feed, startedAt, durationMs, err) {
    const st = archive.getFeedState(feed.id) || { failCount: 0 };
    const failCount = (st.failCount || 0) + 1;
    const httpStatus = err instanceof HttpError ? err.status : null;
    let backoffSec;
    if (httpStatus === 429 && err.retryAfter != null) {
      backoffSec = Math.min(err.retryAfter, 3600);
    } else {
      const baseSec = intervalMs(feed) / 1000;
      backoffSec = Math.min(baseSec * Math.pow(2, failCount), 3600);
    }
    const backoffUntil = new Date(Date.now() + backoffSec * 1000).toISOString();
    archive.setFeedState(feed.id, { failCount, backoffUntil });
    archive.recordRun({
      feed: feed.id,
      startedAt,
      ok: false,
      httpStatus,
      error: String(err && err.message ? err.message : err),
      durationMs,
      changed: false,
      bytes: 0,
    });
    logLine(startedAt, feed.id, httpStatus ?? "ERR", 0, durationMs, 0);
  }

  async function avatarSweep(sleep) {
    const seeds = archive.missingAvatarSeeds(40);
    if (!seeds.length) return;
    const startedAt = nowIso();
    const t0 = Date.now();
    let stored = 0;
    let anyOk = false;
    for (const seed of seeds) {
      try {
        const url = `${AVATAR_BASE}${encodeURIComponent(seed)}.svg`;
        const res = await fetchUrl(url, {
          timeoutMs: 20000,
          maxBytes: config.maxBytes,
          userAgent: config.userAgent,
        });
        if (res.status === 200 && res.body) {
          anyOk = true;
          const head = res.body.toString("utf8", 0, Math.min(res.body.length, 200));
          const ct = (res.contentType || "").toLowerCase();
          if (ct.includes("svg") || head.includes("<svg")) {
            archive.upsertAvatar({ seed, svg: res.body, fetchedAt: nowIso() });
          } else {
            // JSON "avatar not found" (still 200) or anything non-svg → tombstone
            archive.upsertAvatar({ seed, svg: Buffer.from([0x20]), fetchedAt: nowIso() });
          }
          stored++;
        } else if (res.status === 404) {
          anyOk = true;
          archive.upsertAvatar({ seed, svg: Buffer.from([0x20]), fetchedAt: nowIso() });
          stored++;
        }
      } catch {
        // individual avatar failures are non-fatal
      }
      await sleep(REQUEST_GAP_MS);
    }
    archive.recordRun({
      feed: "deng:avatars",
      startedAt,
      ok: anyOk,
      httpStatus: 200,
      error: null,
      durationMs: Date.now() - t0,
      changed: stored > 0,
      bytes: 0,
    });
  }

  /**
   * assetSweep — mirror same-origin assets referenced by a just-captured page.
   * An asset is (re)fetched when it has no archived capture yet, or when the
   * page's cache-buster query for it changed (tracked in feed_state.etag).
   * Content-hash dedup in saveCapture makes a same-bytes refetch free.
   */
  async function assetSweep(pageFeedId, htmlBody, sleep) {
    const site = ASSET_SWEEP_PAGES.get(pageFeedId);
    if (!site) return;
    const refs = extractAssetRefs(htmlBody.toString("utf8"));
    const todo = [];
    for (const ref of refs) {
      if (EXPLICIT_ASSET_PATHS.has(`${site.site}:${ref.path}`)) continue;
      const feedId = assetFeedId(site.site, ref.path);
      const st = archive.getFeedState(feedId);
      const have = archive.latestCapture(feedId);
      if (have && st && (st.etag || "") === ref.query) continue;
      todo.push({ feedId, ref });
      if (todo.length >= ASSET_SWEEP_CAP) break;
    }
    if (!todo.length) return;

    const startedAt = nowIso();
    const t0 = Date.now();
    let stored = 0;
    let anyOk = false;
    let lastErr = null;
    for (const { feedId, ref } of todo) {
      try {
        const url = site.origin + ref.path + ref.query;
        const res = await fetchUrl(url, {
          timeoutMs: 20000,
          maxBytes: config.maxBytes,
          userAgent: config.userAgent,
        });
        if (res.status >= 200 && res.status < 300 && res.body) {
          anyOk = true;
          const cap = archive.saveCapture({
            feed: feedId,
            capturedAt: nowIso(),
            body: res.body,
            httpStatus: res.status,
            contentType: res.contentType,
          });
          if (cap.changed) stored++;
          // Remember the cache-buster we mirrored, even when bytes were unchanged.
          archive.setFeedState(feedId, {
            failCount: 0,
            backoffUntil: null,
            lastOkAt: nowIso(),
            etag: ref.query,
          });
        } else if (res.status === 404) {
          // Referenced but gone upstream — remember so we don't refetch each poll.
          anyOk = true;
          archive.setFeedState(feedId, { etag: ref.query, lastOkAt: nowIso() });
        }
      } catch (err) {
        lastErr = err;
      }
      await sleep(REQUEST_GAP_MS);
    }
    archive.recordRun({
      feed: `${site.site}:assets`,
      startedAt,
      ok: anyOk || todo.length === 0,
      httpStatus: anyOk ? 200 : null,
      error: anyOk || !lastErr ? null : String(lastErr.message || lastErr),
      durationMs: Date.now() - t0,
      changed: stored > 0,
      bytes: 0,
    });
    logLine(startedAt, `${site.site}:assets`, anyOk ? 200 : "ERR", stored, Date.now() - t0, 0);
  }

  async function pollFeed(feed, sleep) {
    const startedAt = nowIso();
    const t0 = Date.now();
    const st = archive.getFeedState(feed.id) || {};
    try {
      const res = await fetchUrl(feed.url, {
        etag: st.etag || null,
        timeoutMs: 20000,
        maxBytes: config.maxBytes,
        userAgent: config.userAgent,
      });
      const durationMs = Date.now() - t0;

      if (res.status === 304) {
        archive.recordRun({
          feed: feed.id,
          startedAt,
          ok: true,
          httpStatus: 304,
          durationMs,
          changed: false,
          bytes: 0,
        });
        archive.setFeedState(feed.id, {
          failCount: 0,
          backoffUntil: null,
          lastOkAt: nowIso(),
          etag: res.etag || st.etag || null,
        });
        logLine(startedAt, feed.id, 304, 0, durationMs, 0);
        return true;
      }

      if (res.status >= 200 && res.status < 300 && res.body) {
        const capturedAt = nowIso();
        let changed = 0;
        let extractorError = null;
        if (feed.extractor) {
          // The extractor and the raw archive are DECOUPLED: a malformed/garbage
          // body or an unforeseen upstream shape must never cost us the raw
          // snapshot. Extraction runs in its own guard; on failure we still
          // archive the raw body below, then record the run as failed (SPEC §5).
          try {
            changed = runExtractor(feed.extractor, archive, res.body, capturedAt).changed;
          } catch (err) {
            extractorError = err;
          }
        }
        const upstreamTs = extractUpstreamTs(feed, res.body);
        const storeRaw = decideStoreRaw(feed, changed);
        const cap = archive.saveCapture({
          feed: feed.id,
          capturedAt,
          body: res.body,
          httpStatus: res.status,
          upstreamTs,
          contentType: res.contentType,
          storeRaw,
        });
        if (extractorError) {
          // Raw observation is preserved above; extraction failed, so the run is
          // a failure and enters backoff — but the feed degrades to raw-only
          // instead of losing the snapshot entirely on upstream schema drift.
          handleFailure(feed, startedAt, Date.now() - t0, extractorError);
          return false;
        }
        // cap.changed is true even when a sampled body was NOT stored, so a
        // meaningful "captured new info" flag also requires we actually stored.
        const storedNew = storeRaw && cap.changed && !cap.deduped;
        const runChanged = changed > 0 || storedNew;
        archive.recordRun({
          feed: feed.id,
          startedAt,
          ok: true,
          httpStatus: res.status,
          durationMs,
          changed: runChanged,
          bytes: res.body.length,
        });
        archive.setFeedState(feed.id, {
          failCount: 0,
          backoffUntil: null,
          lastOkAt: nowIso(),
          etag: res.etag || st.etag || null,
        });
        // extractor feeds log their row count; raw-only feeds log stored-or-not.
        const changedDisp = feed.extractor ? changed : storedNew ? 1 : 0;
        logLine(startedAt, feed.id, res.status, changedDisp, durationMs, res.body.length);

        if (feed.id === "deng:events") await avatarSweep(sleep);
        if (ASSET_SWEEP_PAGES.has(feed.id)) await assetSweep(feed.id, res.body, sleep);
        return true;
      }

      throw new HttpError(res.status, res.retryAfter);
    } catch (err) {
      handleFailure(feed, startedAt, Date.now() - t0, err);
      return false;
    }
  }

  return { intervalMs, pollFeed, avatarSweep, assetSweep };
}

// ----------------------------------------------------------------- CLI runner

function parseArgs(argv) {
  const opts = { once: false, feed: null };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--once") opts.once = true;
    else if (argv[i] === "--feed") opts.feed = argv[++i];
  }
  return opts;
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  const config = loadConfig();
  const archive = openArchive(config.dataDir);
  archive.pruneRuns(config.runsKeepDays);

  let feeds = FEEDS;
  if (opts.feed) {
    const f = getFeed(opts.feed);
    if (!f) {
      console.error(`unknown feed: ${opts.feed}`);
      archive.close();
      process.exit(2);
    }
    feeds = [f];
  }

  const collector = createCollector(config, archive);

  let running = true;
  let wake = null;
  const sleep = (ms) =>
    new Promise((resolve) => {
      const t = setTimeout(resolve, ms);
      wake = () => {
        clearTimeout(t);
        wake = null;
        resolve();
      };
    });

  const shutdown = () => {
    running = false;
    if (wake) wake();
  };
  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);

  if (opts.once) {
    let okCount = 0;
    for (const f of feeds) {
      if (!running) break;
      const ok = await collector.pollFeed(f, sleep);
      if (ok) okCount++;
      await sleep(REQUEST_GAP_MS);
    }
    archive.close();
    process.exit(okCount === 0 ? 1 : 0);
    return;
  }

  // Continuous scheduler: seed next-due from persisted feed_state.
  const nextDue = new Map();
  const now0 = Date.now();
  for (const f of feeds) {
    const st = archive.getFeedState(f.id);
    let due = st && st.lastOkAt ? Date.parse(st.lastOkAt) + collector.intervalMs(f) : now0;
    if (st && st.backoffUntil) due = Math.max(due, Date.parse(st.backoffUntil));
    nextDue.set(f.id, due);
  }

  // Prune the runs audit log at startup and then periodically, so a long-running
  // (restart: unless-stopped) collector actually honours RUNS_KEEP_DAYS as a
  // rolling window instead of only trimming on process restart.
  const PRUNE_INTERVAL_MS = 24 * 3600 * 1000;
  let lastPruneAt = Date.now();

  while (running) {
    if (Date.now() - lastPruneAt >= PRUNE_INTERVAL_MS) {
      archive.pruneRuns(config.runsKeepDays);
      lastPruneAt = Date.now();
    }
    const now = Date.now();
    const due = feeds.filter((f) => nextDue.get(f.id) <= now);
    if (due.length === 0) {
      const earliest = Math.min(...feeds.map((f) => nextDue.get(f.id)));
      await sleep(Math.min(Math.max(earliest - now, 250), 60000));
      continue;
    }
    due.sort((a, x) => nextDue.get(a.id) - nextDue.get(x.id));
    for (const f of due) {
      if (!running) break;
      await collector.pollFeed(f, sleep);
      const jitter = 0.9 + Math.random() * 0.2;
      let next = Date.now() + collector.intervalMs(f) * jitter;
      const st = archive.getFeedState(f.id);
      if (st && st.backoffUntil) next = Math.max(next, Date.parse(st.backoffUntil));
      nextDue.set(f.id, next);
      await sleep(REQUEST_GAP_MS);
    }
  }

  archive.close();
  process.exit(0);
}

if (import.meta.url === pathToFileURL(process.argv[1] || "").href) {
  main().catch((err) => {
    console.error(err);
    process.exit(1);
  });
}
