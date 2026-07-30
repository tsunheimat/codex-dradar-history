// api-routes.js — archive meta API mounted under /archive-api/.
// registerArchiveApi(router, archive) wires the health / versions / runs endpoints.
// The long-range history endpoints live in history-api.js (Agent C) and are
// registered separately by server.js.

const DAY_MS = 24 * 60 * 60 * 1000;

function clampInt(raw, def, min, max) {
  const n = Number.parseInt(raw, 10);
  if (!Number.isFinite(n)) return def;
  return Math.max(min, Math.min(max, n));
}

function isoOrNull(s) {
  if (s == null || s === "") return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d;
}

/**
 * versions() query modes (mutually exclusive, checked in priority order):
 *   before=<iso>  → the single version immediately before that instant
 *   after=<iso>   → the single version immediately after
 *   day=YYYY-MM-DD → all versions within that Asia/Shanghai (UTC+8) calendar day
 *   from=&to=     → all versions with first_at in [from, to]
 *   (none)        → most recent `limit` versions, newest first
 */
function versions(archive, ctx) {
  const q = ctx.query;
  const feed = q.feed;
  if (!feed) return ctx.sendJson(400, { error: "feed required" });
  const limit = clampInt(q.limit, 200, 1, 1000);
  let rows;

  if (q.before != null && q.before !== "") {
    const d = isoOrNull(q.before);
    if (!d) return ctx.sendJson(400, { error: "invalid before" });
    // Strictly before → shift the inclusive upper bound back 1 ms.
    const toIso = new Date(d.getTime() - 1).toISOString();
    rows = archive.listVersions(feed, { toIso, limit: 1, order: "desc" });
  } else if (q.after != null && q.after !== "") {
    const d = isoOrNull(q.after);
    if (!d) return ctx.sendJson(400, { error: "invalid after" });
    const fromIso = new Date(d.getTime() + 1).toISOString();
    rows = archive.listVersions(feed, { fromIso, limit: 1, order: "asc" });
  } else if (q.day != null && q.day !== "") {
    // Asia/Shanghai has a fixed +08:00 offset (no DST) for all modern dates.
    const start = new Date(`${q.day}T00:00:00+08:00`);
    if (Number.isNaN(start.getTime())) {
      return ctx.sendJson(400, { error: "invalid day" });
    }
    const fromIso = start.toISOString();
    const toIso = new Date(start.getTime() + DAY_MS - 1).toISOString();
    rows = archive.listVersions(feed, { fromIso, toIso, limit, order: "asc" });
  } else {
    const fromIso = isoOrNull(q.from);
    const toIso = isoOrNull(q.to);
    rows = archive.listVersions(feed, {
      fromIso: fromIso ? fromIso.toISOString() : null,
      toIso: toIso ? toIso.toISOString() : null,
      limit,
      order: "desc",
    });
  }

  const out = (rows || []).map((r) => ({
    firstAt: r.firstAt,
    lastAt: r.lastAt,
    bytes: r.bytes,
  }));
  ctx.sendJson(200, { feed, versions: out });
}

export function registerArchiveApi(router, archive) {
  router.add("GET", "/archive-api/health", (req, res, ctx) => {
    ctx.sendJson(200, {
      ok: true,
      now: new Date().toISOString(),
      feeds: archive.feedsSummary(),
      db: archive.dbStats(),
    });
  });

  router.add("GET", "/archive-api/versions", (req, res, ctx) => {
    versions(archive, ctx);
  });

  router.add("GET", "/archive-api/runs", (req, res, ctx) => {
    const q = ctx.query;
    const feed = q.feed && q.feed !== "" ? q.feed : null;
    const limit = clampInt(q.limit, 100, 1, 500);
    const runs = archive.recentRuns({ feed, limit });
    ctx.sendJson(200, { feed, runs });
  });
}
