// Feed catalog. Authoritative table lives in SPEC §3 — keep in exact sync.
// Fields: {id, url, kind, intervalSec, extractor, keepRaw, contentType}
//   kind: page | json | xml | asset
//   extractor: null or a key into EXTRACTORS
//   keepRaw: "always" | "sampled" | "none"

export const FEEDS = [
  { id: "codex:html",            url: "https://codexradar.com/",                                   kind: "page",  intervalSec: 600,   extractor: null,          keepRaw: "always",  contentType: "text/html; charset=utf-8" },
  { id: "codex:html-en",         url: "https://codexradar.com/en",                                 kind: "page",  intervalSec: 1800,  extractor: null,          keepRaw: "always",  contentType: "text/html; charset=utf-8" },
  { id: "codex:current",         url: "https://codexradar.com/current.json",                       kind: "json",  intervalSec: 300,   extractor: null,          keepRaw: "always",  contentType: "application/json" },
  { id: "codex:model-ratings",   url: "https://codexradar.com/api/model-ratings?history=14",       kind: "json",  intervalSec: 900,   extractor: "ratings",     keepRaw: "always",  contentType: "application/json" },
  { id: "codex:radar-insights",  url: "https://codexradar.com/api/radar-insights",                 kind: "json",  intervalSec: 900,   extractor: null,          keepRaw: "always",  contentType: "application/json" },
  { id: "codex:intel-efficiency",url: "https://codexradar.com/api/intelligence-efficiency",        kind: "json",  intervalSec: 1800,  extractor: null,          keepRaw: "sampled", contentType: "application/json" },
  { id: "codex:intel-published", url: "https://codexradar.com/data/intelligence-efficiency.json",  kind: "json",  intervalSec: 21600, extractor: null,          keepRaw: "always",  contentType: "application/json" },
  { id: "codex:subscriber-count",url: "https://codexradar.com/api/subscriber-count",               kind: "json",  intervalSec: 1800,  extractor: "subscribers", keepRaw: "always",  contentType: "application/json" },
  { id: "codex:feed",            url: "https://codexradar.com/feed.xml",                            kind: "xml",   intervalSec: 1800,  extractor: "rss",         keepRaw: "always",  contentType: "application/rss+xml" },
  { id: "codex:logo",            url: "https://codexradar.com/assets/codex-logo.svg",              kind: "asset", intervalSec: 86400, extractor: null,          keepRaw: "always",  contentType: "image/svg+xml" },
  { id: "deng:html",             url: "https://deng.codexradar.com/",                              kind: "page",  intervalSec: 600,   extractor: null,          keepRaw: "always",  contentType: "text/html; charset=utf-8" },
  { id: "deng:intro",            url: "https://deng.codexradar.com/intro",                         kind: "page",  intervalSec: 21600, extractor: null,          keepRaw: "always",  contentType: "text/html; charset=utf-8" },
  { id: "deng:i18n",             url: "https://deng.codexradar.com/assets/i18n.js",                kind: "asset", intervalSec: 21600, extractor: null,          keepRaw: "always",  contentType: "text/javascript" },
  // Keep the latest table snapshot for /deng/ replay, but do not archive the
  // subscription-tier matrix as per-cell history.
  { id: "deng:table",            url: "https://api.codexradar.com/api/v1/table?ui=1",              kind: "json",  intervalSec: 600,   extractor: null,          keepRaw: "sampled", contentType: "application/json" },
  { id: "deng:iq-history",       url: "https://api.codexradar.com/api/v1/iq-history",              kind: "json",  intervalSec: 900,   extractor: "iq",          keepRaw: "always",  contentType: "application/json" },
  { id: "deng:events",           url: "https://api.codexradar.com/api/v1/events?n=20",             kind: "json",  intervalSec: 300,   extractor: "events",      keepRaw: "always",  contentType: "application/json" },
  { id: "deng:leaderboard",      url: "https://api.codexradar.com/api/v1/leaderboard",             kind: "json",  intervalSec: 900,   extractor: "dengstats",   keepRaw: "none",    contentType: "application/json" },
];

const BY_ID = new Map(FEEDS.map((f) => [f.id, f]));

export function getFeed(id) {
  return BY_ID.get(id) || null;
}

// ---------------------------------------------------------------------------
// Discovered-asset mirroring. The pages reference a changing set of same-origin
// images (QR codes, dated comics, orb/bike art …) that cannot be enumerated as
// fixed feeds. After each successful page poll the collector sweeps the HTML
// for `assets/...` references and mirrors new/changed ones under synthetic
// feeds `<site>:asset:<path>`; the server replays them at /assets/* and
// /deng/assets/*.
// ---------------------------------------------------------------------------

export const ASSET_SWEEP_PAGES = new Map([
  ["codex:html",    { site: "codex", origin: "https://codexradar.com/" }],
  ["codex:html-en", { site: "codex", origin: "https://codexradar.com/" }],
  ["deng:html",     { site: "deng",  origin: "https://deng.codexradar.com/" }],
  ["deng:intro",    { site: "deng",  origin: "https://deng.codexradar.com/" }],
]);

// Assets already collected as explicit first-class feeds — the sweep skips them.
export const EXPLICIT_ASSET_PATHS = new Set([
  "codex:assets/codex-logo.svg",
  "deng:assets/i18n.js",
]);

// Assets used only by the removed contributor ladder. Do not mirror them from
// the upstream HTML sweep after the component is removed from replay.
export const EXCLUDED_ASSET_PATHS = new Set([
  "assets/radar-report.js",
  "assets/codex-radar-group-qrcode-20260729.jpg",
  "assets/codex-radar-group-qrcode-20260731.jpg",
  "assets/wechat-qrcode.jpg",
  "assets/community/official-account.png",
  "assets/community/wechat-group.jpg",
  "assets/bikes/ladder-city.png",
  "assets/bikes/ladder-city-v2.png",
  "assets/bikes/ladder-road.png",
  "assets/bikes/ladder-road-v2.png",
  "assets/bikes/ladder-mountain.png",
  "assets/bikes/ladder-mountain-v2.png",
]);

export function assetFeedId(site, path) {
  return `${site}:asset:${path}`;
}

const ASSET_CT = {
  png: "image/png",
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  gif: "image/gif",
  webp: "image/webp",
  svg: "image/svg+xml",
  ico: "image/x-icon",
  css: "text/css; charset=utf-8",
  js: "text/javascript; charset=utf-8",
  mjs: "text/javascript; charset=utf-8",
  json: "application/json",
  woff: "font/woff",
  woff2: "font/woff2",
  ttf: "font/ttf",
  otf: "font/otf",
  mp3: "audio/mpeg",
  mp4: "video/mp4",
  webm: "video/webm",
};

export function assetContentType(path) {
  const ext = String(path).toLowerCase().match(/\.([a-z0-9]+)$/)?.[1];
  return (ext && ASSET_CT[ext]) || "application/octet-stream";
}
