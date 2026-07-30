// src/history-api.js — long-term history JSON API (Agent C), mounted under /archive-api/.
//
// Exports registerHistoryApi(router, archive). The router + handler contract is
// defined by Agent B (server.js):
//   router.add(method, path, handler)
//   handler(req, res, { query, path, send, sendJson })
//
// INTEGRATION ASSUMPTION (single point of truth below): sendJson is called as
//   sendJson(statusCode, dataObject)
// — status first, data second, matching a `send(status, body)` primitive. If the
// server implements a different argument order, change ONLY the `reply()` helper.
//
// Every handler: validates + bounds its params, calls a read-only Archive query
// method named in SPEC §2, and returns bounded JSON. Nothing here throws to the
// client — each handler is wrapped so a malformed request or an unexpected archive
// error yields a clean JSON error rather than a crash.

const MAX_STR = 200; // cap free-text params so a hostile query can't blow up SQL params

// ---- response helper (the one place the sendJson signature is assumed) ----
function reply(ctx, status, data) {
  if (ctx && typeof ctx.sendJson === "function") return ctx.sendJson(status, data);
  // Defensive fallback if a bare `res` is available (should not normally happen).
  if (ctx && ctx.res && typeof ctx.res.writeHead === "function") {
    const body = JSON.stringify(data);
    ctx.res.writeHead(status, {
      "content-type": "application/json; charset=utf-8",
      "x-archive": "dradar2",
      "access-control-allow-origin": "*",
    });
    ctx.res.end(body);
    return undefined;
  }
  return undefined;
}

// ---- param readers (tolerant of URLSearchParams OR plain object) ----
function qget(query, name) {
  if (!query) return undefined;
  if (typeof query.get === "function") {
    const v = query.get(name);
    return v == null ? undefined : v;
  }
  const v = query[name];
  if (v == null) return undefined;
  return Array.isArray(v) ? v[0] : v;
}

function str(query, name) {
  const v = qget(query, name);
  if (v == null) return undefined;
  const s = String(v).trim();
  if (!s) return undefined;
  return s.length > MAX_STR ? s.slice(0, MAX_STR) : s;
}

function intParam(query, name, def, min, max) {
  const raw = qget(query, name);
  if (raw == null || raw === "") return def;
  const n = parseInt(String(raw), 10);
  if (!Number.isFinite(n)) return def;
  return Math.min(max, Math.max(min, n));
}

// Accept ISO-8601 or epoch-ms; normalize to ISO UTC. Invalid → null.
function isoParam(query, name) {
  const raw = qget(query, name);
  if (raw == null || raw === "") return null;
  const s = String(raw).trim();
  if (/^\d{10,15}$/.test(s)) {
    const d = new Date(Number(s));
    return Number.isNaN(d.getTime()) ? null : d.toISOString();
  }
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// YYYY-MM-DD day string, else null.
function dayParam(query, name) {
  const raw = qget(query, name);
  if (raw == null) return null;
  const s = String(raw).trim();
  return /^\d{4}-\d{2}-\d{2}$/.test(s) ? s : null;
}

function passedParam(query, name) {
  const raw = qget(query, name);
  if (raw == null || raw === "") return undefined;
  const s = String(raw).toLowerCase();
  if (s === "1" || s === "true" || s === "pass" || s === "passed" || s === "yes") return 1;
  if (s === "0" || s === "false" || s === "fail" || s === "failed" || s === "no") return 0;
  return undefined;
}

function safeParseJson(s) {
  if (typeof s !== "string") return s;
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

// Wrap a handler so it can never throw to the router.
function guard(fn) {
  return (req, res, ctx) => {
    try {
      return fn(req, res, ctx);
    } catch (err) {
      return reply(ctx, 500, { error: "internal error", detail: String(err && err.message || err) });
    }
  };
}

export function registerHistoryApi(router, archive) {
  if (!router || typeof router.add !== "function") {
    throw new TypeError("registerHistoryApi: router.add(method, path, handler) required");
  }
  const add = (path, fn) => router.add("GET", path, guard(fn));

  // GET /archive-api/iq-series → [{series, points, firstTs, lastTs}]
  add("/archive-api/iq-series", (req, res, ctx) => {
    const list = archive.listIqSeries ? archive.listIqSeries() : [];
    return reply(ctx, 200, Array.isArray(list) ? list : []);
  });

  // GET /archive-api/iq?series=a,b,c&from=&to=&maxPoints=
  add("/archive-api/iq", (req, res, ctx) => {
    const q = ctx.query;
    // Read the raw list WITHOUT the single-value MAX_STR cap: 12 series names can
    // exceed 200 chars combined, and truncating would silently drop a series.
    const rawSeries = qget(q, "series");
    const series = (rawSeries == null ? "" : String(rawSeries))
      .split(",")
      .map((s) => s.trim().slice(0, 80)) // bound each name; count bounded below
      .filter(Boolean)
      .slice(0, 12); // ≤ 12 series per request (SPEC §10)
    if (series.length === 0) return reply(ctx, 200, { series: {} });
    const out = archive.queryIqSeries({
      series,
      fromIso: isoParam(q, "from"),
      toIso: isoParam(q, "to"),
      maxPoints: intParam(q, "maxPoints", 2000, 10, 5000),
    });
    return reply(ctx, 200, out || { series: {} });
  });

  // GET /archive-api/events?model=&effort=&task=&nickname=&passed=&q=&from=&to=&limit=&offset=
  add("/archive-api/events", (req, res, ctx) => {
    const q = ctx.query;
    const out = archive.queryEvents({
      model: str(q, "model"),
      effort: str(q, "effort"),
      taskId: str(q, "task"),
      nickname: str(q, "nickname"),
      passed: passedParam(q, "passed"),
      q: str(q, "q"),
      fromIso: isoParam(q, "from"),
      toIso: isoParam(q, "to"),
      limit: intParam(q, "limit", 100, 1, 500),
      offset: intParam(q, "offset", 0, 0, 1000000),
    });
    return reply(ctx, 200, out || { total: 0, rows: [] });
  });

  // GET /archive-api/tasks → [{id, title, language, repo, category}]
  add("/archive-api/tasks", (req, res, ctx) => {
    const list = archive.listDengTasks ? archive.listDengTasks() : [];
    return reply(ctx, 200, Array.isArray(list) ? list : []);
  });

  // GET /archive-api/cell-history?task=&model=&effort=
  add("/archive-api/cell-history", (req, res, ctx) => {
    const q = ctx.query;
    const taskId = str(q, "task");
    const model = str(q, "model");
    const effort = str(q, "effort");
    if (!taskId || !model || !effort) {
      return reply(ctx, 200, { cellKey: null, rows: [] });
    }
    const raw = archive.queryCellHistory({ taskId, model, effort }) || [];
    // Normalize to a stable shape our page consumes, tolerant of snake/camel
    // field names and of `payload` arriving as a JSON string or parsed object.
    const rows = (Array.isArray(raw) ? raw : []).map((r) => ({
      firstSeen: r.firstSeen ?? r.first_seen ?? null,
      lastSeen: r.lastSeen ?? r.last_seen ?? null,
      hash: r.hash ?? null,
      payload: safeParseJson(r.payload),
    }));
    return reply(ctx, 200, { cellKey: `${taskId}|${model}|${effort}`, rows });
  });

  // GET /archive-api/ratings?from=YYYY-MM-DD&to=YYYY-MM-DD
  add("/archive-api/ratings", (req, res, ctx) => {
    const q = ctx.query;
    const list = archive.queryRatings({
      fromDay: dayParam(q, "from"),
      toDay: dayParam(q, "to"),
    });
    return reply(ctx, 200, Array.isArray(list) ? list : []);
  });

  // GET /archive-api/subscribers?from=&to=
  add("/archive-api/subscribers", (req, res, ctx) => {
    const q = ctx.query;
    const list = archive.querySubscribers({
      fromIso: isoParam(q, "from"),
      toIso: isoParam(q, "to"),
    });
    return reply(ctx, 200, Array.isArray(list) ? list : []);
  });

  // GET /archive-api/deng-stats?from=&to=&maxPoints=
  add("/archive-api/deng-stats", (req, res, ctx) => {
    const q = ctx.query;
    const list = archive.queryDengStats({
      fromIso: isoParam(q, "from"),
      toIso: isoParam(q, "to"),
      maxPoints: intParam(q, "maxPoints", 2000, 10, 5000),
    });
    return reply(ctx, 200, Array.isArray(list) ? list : []);
  });
}

export default registerHistoryApi;
