// server.js — node:http replay server for the dradar2 archive.
//
// Serves pixel-faithful clones of codexradar.com and deng.codexradar.com at any
// archived point in time (?at=), plus the archive meta + long-range history APIs.
// Zero runtime dependencies. A tiny method+path/prefix router; every response
// carries `X-Archive: dradar2`; the request loop never throws to the client.

import http from "node:http";
import { readFileSync, realpathSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

import { openArchive } from "./db.js";
import { FEEDS, getFeed } from "./feeds.js";
import {
  resolveAt,
  patchCodexHtml,
  patchDengHtml,
  patchIntroHtml,
  patchReportJs,
} from "./replay.js";
import { registerArchiveApi } from "./api-routes.js";
import { registerHistoryApi } from "./history-api.js";

const PUBLIC_DIR = fileURLToPath(new URL("./public/", import.meta.url));

const CT = {
  HTML: "text/html; charset=utf-8",
  JSON: "application/json; charset=utf-8",
  RSS: "application/rss+xml; charset=utf-8",
  SVG: "image/svg+xml; charset=utf-8",
  JS: "text/javascript; charset=utf-8",
};

// ---------------------------------------------------------------------------
// Router: exact method+path first, then longest matching prefix.
// ---------------------------------------------------------------------------

class Router {
  constructor() {
    this.exact = new Map(); // "METHOD path" → handler
    this.prefix = []; // {method, prefix, handler} sorted by prefix length desc
  }

  add(method, pathOrPrefix, handler, { prefix = false } = {}) {
    const m = method.toUpperCase();
    if (prefix) {
      this.prefix.push({ method: m, prefix: pathOrPrefix, handler });
      this.prefix.sort((a, b) => b.prefix.length - a.prefix.length);
    } else {
      this.exact.set(`${m} ${pathOrPrefix}`, handler);
    }
  }

  match(method, pathname) {
    let m = method.toUpperCase();
    // HEAD falls back to the GET handler (send() omits the body for HEAD).
    if (m === "HEAD" && !this.hasAny("HEAD", pathname)) m = "GET";
    const exact = this.exact.get(`${m} ${pathname}`);
    if (exact) return exact;
    for (const r of this.prefix) {
      if (r.method === m && pathname.startsWith(r.prefix)) return r.handler;
    }
    return null;
  }

  hasAny(method, pathname) {
    if (this.exact.has(`${method} ${pathname}`)) return true;
    return this.prefix.some(
      (r) => r.method === method && pathname.startsWith(r.prefix)
    );
  }
}

// ---------------------------------------------------------------------------
// Per-request context: query object + send/sendJson helpers.
// ---------------------------------------------------------------------------

function hasHeader(headers, name) {
  const lower = name.toLowerCase();
  return Object.keys(headers).some((k) => k.toLowerCase() === lower);
}

function makeCtx(req, res, url) {
  const query = {};
  for (const [k, v] of url.searchParams) if (!(k in query)) query[k] = v;

  const send = (status, body, headers = {}) => {
    if (res.headersSent) return;
    const buf = Buffer.isBuffer(body)
      ? body
      : Buffer.from(body == null ? "" : String(body), "utf8");
    const h = { "X-Archive": "dradar2", ...headers };
    if (!hasHeader(h, "content-type")) h["Content-Type"] = "application/octet-stream";
    h["Content-Length"] = String(buf.length);
    res.writeHead(status, h);
    if (req.method === "HEAD") res.end();
    else res.end(buf);
  };

  const sendJson = (status, obj, headers = {}) => {
    send(status, JSON.stringify(obj), {
      "Content-Type": CT.JSON,
      "Access-Control-Allow-Origin": "*",
      ...headers,
    });
  };

  return { query, path: url.pathname, send, sendJson };
}

// ---------------------------------------------------------------------------
// Friendly / fallback pages.
// ---------------------------------------------------------------------------

function shell(title, body) {
  return `<!doctype html><html lang="zh"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1"><title>${title}</title>
<style>html{background:#04140b;color:#b8f5d0;font:15px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace}
body{margin:0;display:flex;min-height:100vh;align-items:center;justify-content:center;padding:24px}
main{max-width:640px}h1{color:#39ff14;font-size:20px;margin:0 0 12px}
a{color:#00e5ff}code{background:#0a2016;padding:2px 6px;border-radius:4px;color:#7dffb0}
.dim{color:#5f8f76}</style></head><body><main>${body}</main></body></html>`;
}

function emptyPage(feedId) {
  return shell(
    "dradar2 — 存档为空 archive empty",
    `<h1>🗄 存档为空 / archive empty</h1>
<p>此存档副本还没有 <code>${feedId}</code> 的任何快照。</p>
<p class="dim">No snapshots for feed <code>${feedId}</code> yet. Run the collector to populate the archive:</p>
<p><code>node src/collector.js --once</code></p>
<p class="dim">— dradar2 archive replica · 数据来自 Codex 雷达 <a href="https://codexradar.com" target="_blank" rel="noreferrer">codexradar.com</a></p>`
  );
}

function placeholderPage(name) {
  return shell(
    "dradar2",
    `<h1>页面尚未构建 / page not built</h1>
<p class="dim">Static page <code>${name}</code> is not present in this build.</p>
<p><a href="/">← 主站 clone</a> · <a href="/deng/">分布式 deng clone</a></p>`
  );
}

function notFoundPage(pathname) {
  return shell(
    "404 — dradar2",
    `<h1>404</h1><p>未存档 / not archived: <code>${pathname.replace(/</g, "&lt;")}</code></p>
<p><a href="/">主站 /</a> · <a href="/deng/">分布式 /deng/</a> · <a href="/history">长期历史 /history</a> · <a href="/sources">采集状态 /sources</a></p>`
  );
}

// ---------------------------------------------------------------------------
// Feed replay: resolve ?at=, load the capture body, patch pages.
// ---------------------------------------------------------------------------

function serveCapture(archive, feedId, ctx, { contentType, patch = null }) {
  const at = resolveAt(ctx.query);
  const cap = archive.latestCapture(feedId, at);
  if (!cap) {
    if (patch) ctx.send(200, emptyPage(feedId), { "Content-Type": CT.HTML });
    else ctx.sendJson(404, { error: "not archived" });
    return;
  }
  let body = archive.captureBody(cap.hash);
  if (body == null) {
    if (patch) ctx.send(200, emptyPage(feedId), { "Content-Type": CT.HTML });
    else ctx.sendJson(404, { error: "not archived" });
    return;
  }
  const headers = {
    "Content-Type": contentType,
    "X-Archive-Captured-At": cap.firstAt,
    "Access-Control-Allow-Origin": "*",
  };
  if (patch) {
    const html = patch(body.toString("utf8"), {
      feedId,
      capturedAt: cap.firstAt,
      at,
    });
    body = Buffer.from(html, "utf8");
  }
  ctx.send(200, body, headers);
}

// Deterministic neutral avatar (pseudo-identicon) when none is archived.
function neutralAvatar(seed) {
  let h = 5381;
  for (let i = 0; i < seed.length; i++) h = ((h * 33) ^ seed.charCodeAt(i)) >>> 0;
  const hue = h % 360;
  return (
    `<svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 64 64">` +
    `<rect width="64" height="64" fill="#04140b"/>` +
    `<circle cx="32" cy="32" r="22" fill="hsl(${hue} 45% 32%)" stroke="#00e5ff" stroke-opacity="0.5" stroke-width="2"/>` +
    `<circle cx="32" cy="26" r="9" fill="#0a1f16"/>` +
    `<path d="M14 54c2-12 34-12 36 0z" fill="#0a1f16"/></svg>`
  );
}

function serveAvatar(archive, ctx) {
  const prefix = "/deng-api/api/v1/avatar/";
  let seed = ctx.path.slice(prefix.length);
  try {
    seed = decodeURIComponent(seed);
  } catch {
    /* keep raw seed on malformed encoding */
  }
  if (seed.endsWith(".svg")) seed = seed.slice(0, -4);
  const headers = {
    "Content-Type": CT.SVG,
    "Access-Control-Allow-Origin": "*",
  };
  let svg = null;
  try {
    svg = archive.getAvatar(seed);
  } catch {
    svg = null;
  }
  // A 1-byte tombstone means upstream had no avatar → serve the neutral fallback.
  if (svg && svg.length > 1) ctx.send(200, svg, headers);
  else ctx.send(200, Buffer.from(neutralAvatar(seed), "utf8"), headers);
}

function serveStatic(ctx, name, contentType) {
  try {
    const buf = readFileSync(join(PUBLIC_DIR, name));
    ctx.send(200, buf, { "Content-Type": contentType });
  } catch (err) {
    if (err && err.code === "ENOENT") {
      ctx.send(200, placeholderPage(name), { "Content-Type": CT.HTML });
    } else {
      throw err;
    }
  }
}

// ---------------------------------------------------------------------------
// Replay route table (upstream-compatible paths).
// ---------------------------------------------------------------------------

function registerReplayRoutes(router, archive) {
  const cap = (feedId, opts) => (req, res, ctx) =>
    serveCapture(archive, feedId, ctx, opts);

  // --- codexradar.com clone ---
  router.add("GET", "/", cap("codex:html", { contentType: CT.HTML, patch: patchCodexHtml }));
  router.add("GET", "/en", cap("codex:html-en", { contentType: CT.HTML, patch: patchCodexHtml }));
  router.add("GET", "/current.json", cap("codex:current", { contentType: CT.JSON }));
  router.add("GET", "/feed.xml", cap("codex:feed", { contentType: CT.RSS }));
  router.add("GET", "/api/model-ratings", cap("codex:model-ratings", { contentType: CT.JSON }));
  router.add("GET", "/api/radar-insights", cap("codex:radar-insights", { contentType: CT.JSON }));
  router.add("GET", "/api/intelligence-efficiency", cap("codex:intel-efficiency", { contentType: CT.JSON }));
  router.add("GET", "/data/intelligence-efficiency.json", cap("codex:intel-published", { contentType: CT.JSON }));
  router.add("GET", "/api/subscriber-count", cap("codex:subscriber-count", { contentType: CT.JSON }));
  router.add("GET", "/assets/codex-logo.svg", cap("codex:logo", { contentType: CT.SVG }));
  router.add("GET", "/favicon.ico", cap("codex:logo", { contentType: CT.SVG }));

  router.add("POST", "/api/subscribe", (req, res, ctx) =>
    ctx.sendJson(200, { ok: false, error: "archive replica — 订阅在存档副本中不可用" })
  );

  // --- deng.codexradar.com clone pages ---
  const dengPage = cap("deng:html", { contentType: CT.HTML, patch: patchDengHtml });
  // /deng (no trailing slash): redirect to /deng/ so the page's document-relative
  // asset URLs (assets/i18n.js, assets/radar-report.js, …) resolve under the
  // /deng/ mount instead of 404ing at the site root. Preserve any query (?at=).
  router.add("GET", "/deng", (req, res, ctx) => {
    const qi = req.url.indexOf("?");
    const qs = qi >= 0 ? req.url.slice(qi) : "";
    ctx.send(301, "", { Location: "/deng/" + qs, "Content-Type": CT.HTML });
  });
  router.add("GET", "/deng/", dengPage);
  router.add("GET", "/deng/en", dengPage); // upstream serves identical bytes for /en
  router.add("GET", "/deng/intro", cap("deng:intro", { contentType: CT.HTML, patch: patchIntroHtml }));
  router.add("GET", "/deng/assets/i18n.js", cap("deng:i18n", { contentType: CT.JS }));
  router.add("GET", "/deng/assets/radar-report.js", cap("deng:report-js", { contentType: CT.JS, patch: (js) => patchReportJs(js) }));

  // --- deng API replay (mounted at /deng-api) ---
  router.add("GET", "/deng-api/api/v1/table", cap("deng:table", { contentType: CT.JSON }));
  router.add("GET", "/deng-api/api/v1/iq-history", cap("deng:iq-history", { contentType: CT.JSON }));
  router.add("GET", "/deng-api/api/v1/events", cap("deng:events", { contentType: CT.JSON }));
  router.add("GET", "/deng-api/api/v1/leaderboard", cap("deng:leaderboard", { contentType: CT.JSON }));
  // radar-insights is byte-identical to codex's — alias it.
  router.add("GET", "/deng-api/api/v1/radar-insights", cap("codex:radar-insights", { contentType: CT.JSON }));
  router.add("GET", "/deng-api/api/v1/whoami", (req, res, ctx) =>
    ctx.sendJson(401, { detail: "archive replica" })
  );
  router.add("GET", "/deng-api/api/v1/avatar/", (req, res, ctx) => serveAvatar(archive, ctx), { prefix: true });

  // catch-alls under /deng-api (specific routes above win via exact/longest-prefix)
  router.add("GET", "/deng-api/", (req, res, ctx) => ctx.sendJson(404, { error: "not archived" }), { prefix: true });
  for (const m of ["POST", "PUT", "DELETE", "PATCH"]) {
    router.add(m, "/deng-api/", (req, res, ctx) => ctx.sendJson(403, { detail: "read-only archive" }), { prefix: true });
  }

  // --- archive toolbar + custom history pages (static files from src/public) ---
  router.add("GET", "/__archive/timebar.js", (req, res, ctx) => serveStatic(ctx, "timebar.js", CT.JS));
  router.add("GET", "/history", (req, res, ctx) => serveStatic(ctx, "history.html", CT.HTML));
  router.add("GET", "/history/events", (req, res, ctx) => serveStatic(ctx, "history-events.html", CT.HTML));
  router.add("GET", "/history/cells", (req, res, ctx) => serveStatic(ctx, "history-cells.html", CT.HTML));
  router.add("GET", "/sources", (req, res, ctx) => serveStatic(ctx, "sources.html", CT.HTML));
}

// ---------------------------------------------------------------------------
// 404 dispatch (JSON for API-ish paths, HTML page otherwise).
// ---------------------------------------------------------------------------

function looksLikeApi(p) {
  return (
    p.startsWith("/api/") ||
    p.startsWith("/data/") ||
    p.startsWith("/deng-api/") ||
    p.startsWith("/archive-api/") ||
    p === "/current.json" ||
    p === "/feed.xml" ||
    p.endsWith(".json")
  );
}

function notFound(ctx) {
  if (looksLikeApi(ctx.path)) ctx.sendJson(404, { error: "not archived" });
  else ctx.send(404, notFoundPage(ctx.path), { "Content-Type": CT.HTML });
}

// ---------------------------------------------------------------------------
// Request loop — top-level try/catch guarantees a response.
// ---------------------------------------------------------------------------

function handleRequest(router, req, res) {
  let url;
  try {
    url = new URL(req.url, "http://localhost");
  } catch {
    res.writeHead(400, { "X-Archive": "dradar2", "Content-Type": CT.JSON });
    res.end(JSON.stringify({ error: "bad request" }));
    return;
  }
  const ctx = makeCtx(req, res, url);

  const fail = (err) => {
    try {
      // eslint-disable-next-line no-console
      console.error(`[server] ${req.method} ${url.pathname}:`, err && err.stack ? err.stack : err);
    } catch {
      /* ignore logging failure */
    }
    if (!res.headersSent) ctx.sendJson(500, { error: "internal error" });
    else try { res.end(); } catch { /* already closing */ }
  };

  try {
    if (req.method === "OPTIONS") {
      ctx.send(204, "", {
        "Access-Control-Allow-Origin": "*",
        "Access-Control-Allow-Methods": "GET, POST, OPTIONS, HEAD",
        "Access-Control-Allow-Headers": "*",
      });
      return;
    }
    const handler = router.match(req.method, url.pathname);
    if (handler) {
      const r = handler(req, res, ctx);
      if (r && typeof r.then === "function") r.catch(fail);
    } else {
      notFound(ctx);
    }
  } catch (err) {
    fail(err);
  }
}

// ---------------------------------------------------------------------------
// Public entrypoint.
// ---------------------------------------------------------------------------

// Every codex/deng feed the replay routes read from — asserted against feeds.js
// at boot so a feed-id drift between modules surfaces as a log warning, not a
// silently empty clone. (The alias `codex:radar-insights` covers deng insights.)
const SERVED_FEEDS = [
  "codex:html", "codex:html-en", "codex:current", "codex:feed",
  "codex:model-ratings", "codex:radar-insights", "codex:intel-efficiency",
  "codex:intel-published", "codex:subscriber-count", "codex:logo",
  "deng:html", "deng:intro", "deng:i18n", "deng:report-js",
  "deng:table", "deng:iq-history", "deng:events", "deng:leaderboard",
];

function validateFeeds() {
  try {
    const known = new Set((FEEDS || []).map((f) => f.id));
    for (const id of SERVED_FEEDS) {
      let f = null;
      try {
        f = getFeed(id);
      } catch {
        f = null;
      }
      if (!f && !known.has(id)) {
        // eslint-disable-next-line no-console
        console.warn(`[server] replay route references unknown feed: ${id}`);
      }
    }
  } catch {
    /* feeds module unavailable — non-fatal, routes still work */
  }
}

export function buildRouter(archive) {
  const router = new Router();
  validateFeeds();
  registerReplayRoutes(router, archive);
  registerArchiveApi(router, archive);
  registerHistoryApi(router, archive);
  return router;
}

/**
 * startServer({port, bind, dataDir}) → Promise<{server, archive, port, close}>
 * Opens the archive once and serves. Safe against an empty archive.
 */
export async function startServer(opts = {}) {
  const port = opts.port ?? 3210;
  const bind = opts.bind ?? "0.0.0.0";
  const dataDir = opts.dataDir ?? "./data";
  const archive = openArchive(dataDir);
  const router = buildRouter(archive);
  const server = http.createServer((req, res) => handleRequest(router, req, res));
  server.on("clientError", (err, socket) => {
    if (socket.writable) socket.end("HTTP/1.1 400 Bad Request\r\n\r\n");
  });
  await new Promise((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, bind, () => {
      server.removeListener("error", reject);
      resolve();
    });
  });
  const addr = server.address();
  const actualPort = addr && typeof addr === "object" ? addr.port : port;
  const close = () =>
    new Promise((resolve) => {
      server.close(() => {
        try {
          archive.close();
        } catch {
          /* ignore */
        }
        resolve();
      });
    });
  return { server, archive, port: actualPort, bind, close };
}

// ---------------------------------------------------------------------------
// main-module guard: start from config when run directly.
// ---------------------------------------------------------------------------

function isMainModule() {
  try {
    if (!process.argv[1]) return false;
    return realpathSync(process.argv[1]) === fileURLToPath(import.meta.url);
  } catch {
    return false;
  }
}

if (isMainModule()) {
  const { loadConfig } = await import("./config.js");
  const cfg = loadConfig();
  const port = cfg.port ?? cfg.PORT ?? 3210;
  const bind = cfg.bind ?? cfg.BIND ?? "0.0.0.0";
  const dataDir = cfg.dataDir ?? cfg.DATA_DIR ?? "./data";
  const { server, close } = await startServer({ port, bind, dataDir });
  const addr = server.address();
  const shownPort = addr && typeof addr === "object" ? addr.port : port;
  // eslint-disable-next-line no-console
  console.log(`dradar2 server listening on http://${bind}:${shownPort}  (data: ${dataDir})`);
  let closing = false;
  const shutdown = async (sig) => {
    if (closing) return;
    closing = true;
    // eslint-disable-next-line no-console
    console.log(`\n${sig} received — shutting down`);
    await close();
    process.exit(0);
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}
