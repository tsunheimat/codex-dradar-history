// Feed catalog. Authoritative table lives in SPEC §3 — keep in exact sync.
// Fields: {id, url, kind, intervalSec, extractor, keepRaw, contentType}
//   kind: page | json | xml | asset
//   extractor: null or a key into EXTRACTORS
//   keepRaw: "always" (store every changed poll) | "sampled" (store on change or heartbeat)

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
  { id: "deng:report-js",        url: "https://deng.codexradar.com/assets/radar-report.js",        kind: "asset", intervalSec: 21600, extractor: null,          keepRaw: "always",  contentType: "text/javascript" },
  { id: "deng:table",            url: "https://api.codexradar.com/api/v1/table?ui=1",              kind: "json",  intervalSec: 600,   extractor: "cells",       keepRaw: "sampled", contentType: "application/json" },
  { id: "deng:iq-history",       url: "https://api.codexradar.com/api/v1/iq-history",              kind: "json",  intervalSec: 900,   extractor: "iq",          keepRaw: "always",  contentType: "application/json" },
  { id: "deng:events",           url: "https://api.codexradar.com/api/v1/events?n=20",             kind: "json",  intervalSec: 300,   extractor: "events",      keepRaw: "always",  contentType: "application/json" },
  { id: "deng:leaderboard",      url: "https://api.codexradar.com/api/v1/leaderboard",             kind: "json",  intervalSec: 900,   extractor: "dengstats",   keepRaw: "sampled", contentType: "application/json" },
];

const BY_ID = new Map(FEEDS.map((f) => [f.id, f]));

export function getFeed(id) {
  return BY_ID.get(id) || null;
}
