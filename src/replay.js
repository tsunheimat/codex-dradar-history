// replay.js — time-travel resolution + page patching for the clone routes.
//
// These functions are pure (no I/O) so they can be unit-tested offline against
// the captured HTML fixtures. server.js calls them with the archived body plus
// the resolved capture metadata.

const TIMEBAR_SRC = "/__archive/timebar.js";

const REMOVED_ASSET_PATHS = [
  "assets/codex-radar-group-qrcode-20260729.jpg",
  "assets/codex-radar-group-qrcode-20260731.jpg",
  "assets/wechat-qrcode.jpg",
  "assets/community/official-account.png",
  "assets/community/wechat-group.jpg",
];

// The upstream page's inline script assumes these matrix controls exist and
// attaches listeners without null checks. Keep inert, hidden controls so the
// rest of /deng/ continues to initialize after the visible matrix is removed.
const DENG_MATRIX_COMPAT = `<div id="matrix-tools" hidden aria-hidden="true">
  <div id="tiers"><button data-t="plus"></button><button data-t="pro-5x"></button><button data-t="pro-20x"></button></div>
  <button id="suggest-btn" type="button"></button><button id="mine-btn" type="button"></button>
  <select id="matrix-status"><option value="all"></option></select>
  <select id="matrix-model"><option value="all"></option></select>
  <select id="matrix-effort"><option value="all"></option></select>
  <button id="matrix-more" type="button"></button><button id="matrix-deepseek-cue" type="button"></button>
  <button id="model-config-toggle" type="button"></button>
  <div id="matrix-advanced" hidden></div>
  <input id="matrix-claimer"><select id="matrix-result"><option value="all"></option></select>
  <input id="matrix-pct-min"><input id="matrix-pct-max"><input id="matrix-mult-min"><input id="matrix-mult-max">
  <button id="matrix-reset" type="button"></button><div id="matrix-filter-foot"></div>
</div><div id="tablebox" hidden aria-hidden="true"></div>
<div id="efficiency-charts" hidden aria-hidden="true"></div>
<div id="contrib-body" hidden></div><button id="lt-month" hidden></button>
<button id="lt-all" hidden></button><button id="lt-history" hidden></button>
<span id="settle-info" hidden></span>
<button id="copy-setup-prompt" hidden></button>\n`;

/**
 * resolveAt(query) → ISO-8601 string | null
 * Accepts either the parsed query object ({at: "..."}) or a bare string.
 * `at` may be an ISO-8601 datetime or an epoch-milliseconds integer.
 * Garbage / missing → null (caller then serves the newest capture).
 */
export function resolveAt(query) {
  let raw;
  if (query == null) return null;
  if (typeof query === "string") raw = query;
  else raw = query.at;
  if (raw == null) return null;
  const s = String(raw).trim();
  if (s === "") return null;
  // Pure integer → epoch milliseconds.
  if (/^-?\d+$/.test(s)) {
    const n = Number(s);
    if (!Number.isFinite(n)) return null;
    const d = new Date(n);
    if (Number.isNaN(d.getTime())) return null;
    return d.toISOString();
  }
  const d = new Date(s);
  if (Number.isNaN(d.getTime())) return null;
  return d.toISOString();
}

function attr(v) {
  // Minimal attribute-value escaping for the injected <script> dataset.
  return String(v == null ? "" : v)
    .replace(/&/g, "&amp;")
    .replace(/"/g, "&quot;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;");
}

/** The archive toolbar loader — MUST be the first script in <head>. */
function timebarScript({ feedId, capturedAt, at }) {
  // Plain `<script src>` (no defer/async): it loads and runs synchronously in
  // document order, so its fetch wrapper is installed before any page script.
  return (
    `<script src="${TIMEBAR_SRC}" data-feed="${attr(feedId)}" ` +
    `data-captured-at="${attr(capturedAt)}" data-at="${attr(at)}" defer="false"></script>`
  );
}

/**
 * Remove third-party analytics scripts (Cloudflare RUM beacon) so the replayed
 * page is fully self-contained: no external requests, no tracking, and no CORS
 * console noise when served from a non-upstream origin.
 */
function stripExternalBeacons(html) {
  return html.replace(
    /<script[^>]*\bsrc=['"]https:\/\/static\.cloudflareinsights\.com\/[^'"]*['"][^>]*>\s*<\/script>/gi,
    ""
  );
}

function stripRemovedAssetImages(html) {
  return html.replace(/<img\b[^>]*>/gi, (tag) =>
    REMOVED_ASSET_PATHS.some((path) => tag.includes(path)) ? "" : tag
  );
}

/** Insert the timebar loader right after the first <head> tag (case-insensitive). */
function injectTimebar(html, ctx) {
  const script = timebarScript(ctx);
  const m = /<head[^>]*>/i.exec(html);
  if (m) {
    const idx = m.index + m[0].length;
    return html.slice(0, idx) + script + html.slice(idx);
  }
  // No <head> at all — put it first so the fetch wrapper still installs early.
  return script + html;
}

/**
 * patchCodexHtml — codexradar.com main/en page.
 * Injects the timebar and rewrites the "前往分布式雷达" backlink to the local clone.
 */
export function patchCodexHtml(html, ctx) {
  let out = injectTimebar(stripRemovedAssetImages(stripExternalBeacons(html)), ctx);
  out = out.replace(/href="https:\/\/deng\.codexradar\.com\/?"/gi, 'href="/deng/"');
  // Keep archive navigation beside the upstream distributed-radar shortcut.
  out = out.replace(
    /(<a class="site-announcement-distributed"[^>]*>[^<]*<\/a>)/i,
    '$1<a class="site-announcement-history" href="/history">长期历史</a>'
  );
  return out;
}

/**
 * patchDengHtml — deng.codexradar.com page. Repoints the runtime API base at the
 * local /deng-api mount, neutralizes the localhost dev override, rewrites the main
 * site backlink, and injects the timebar (first script). Emits a patch-failure
 * warning flag if the API base rewrite did not match (upstream markup drifted).
 */
export function patchDengHtml(html, ctx) {
  let out = stripRemovedAssetImages(stripExternalBeacons(html));
  let apiPatched = false;

  // Remove the subscription-tier controls and the benchmark-cell matrix from
  // the replay. The latest table response is still consumed by the summary
  // cards above this block, but no matrix content is exposed or constructed.
  const matrixStart = out.indexOf('<div class="matrix-tools" id="matrix-tools">');
  const joinStart = matrixStart >= 0 ? out.indexOf('<section id="join">', matrixStart) : -1;
  if (matrixStart >= 0 && joinStart > matrixStart) {
    out = out.slice(0, matrixStart) + DENG_MATRIX_COMPAT + out.slice(joinStart);
  }
  if (!out.includes('id="matrix-tools"')) {
    out = out.replace(/(<body[^>]*>)/i, "$1" + DENG_MATRIX_COMPAT);
  }

  // The upstream "智力效率" / 全站看板 is a separate live dashboard whose
  // data source is not replayed by this archive. Leaving it in the page shell
  // produces a permanent "正在读取价格、耗时与 IQ……" placeholder.
  out = out.replace(/\s*<section\s+class="efficiency"(?=[\s>])[\s\S]*?<\/section>\s*/i, "\n");

  // Newer upstream shells render "全站看板" as the first card inside
  // #iq-body. Drop only that card from the assembled markup; the per-model IQ
  // cards still render normally.
  out = out.replace(
    /(document\.getElementById\("iq-body"\)\.innerHTML\s*=\s*)dashboardCard\s*\+\s*/,
    "$1"
  );

  // Remove the complete contributor ladder and its hero jump link. Aggregate
  // leaderboard totals remain available to the upper IQ footer via /summary.
  out = out.replace(/\s*<section id="contributors">[\s\S]*?<\/section>\s*/i, "\n");
  out = out.replace(/\s*<section id="join">[\s\S]*?<\/section>\s*/i, "\n");
  for (const title of ["会烧我多少额度？", "积分怎么算？", "天梯排名怎样影响并发和领题数？", "自行车和蹬踏时间怎么算？"]) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp("\\s*<details><summary>" + escaped + "<\\/summary>[\\s\\S]*?<\\/details>", "i"), "");
  }
  out = out.replace(/\s*<a class="hero-link ladder-link"[^>]*>[\s\S]*?<\/a>/i, "");
  out = out.replace(/\s*<button class="report-launch"[^>]*>[\s\S]*?<\/button>/i, "");
  out = out.replace(/\s*<script src="assets\/radar-report\.js[^>]*><\/script>/i, "");

  out = out.replace(
    "    updateTicker();\n    document.getElementById(\"tablebox\").classList.toggle(\"selection-filter\", showSelectedOnly);",
    "    updateTicker();\n    if (document.getElementById(\"matrix-tools\").hidden) return;\n    document.getElementById(\"tablebox\").classList.toggle(\"selection-filter\", showSelectedOnly);"
  );

  out = out.replace('fetch(API + "/api/v1/leaderboard", opts)', 'fetch(API + "/api/v1/summary", opts)');
  out = out.replace(
    'totalUsd = (d.contributors || []).reduce(function (s, c) { return s + (c.usd || 0); }, 0);',
    'totalUsd = d.total_usd == null ? (d.contributors || []).reduce(function (s, c) { return s + (c.usd || 0); }, 0) : Number(d.total_usd);'
  );
  out = out.replace(
    'totalTokens = (d.contributors || []).reduce(function (s, c) { return s + (c.tokens || 0); }, 0);',
    'totalTokens = d.total_tokens == null ? (d.contributors || []).reduce(function (s, c) { return s + (c.tokens || 0); }, 0) : Number(d.total_tokens);'
  );

  // 1. API base: `var API = "https://api." + apex;` → local mount.
  const API_EXACT = 'var API = "https://api." + apex;';
  const API_REPL = 'var API = location.origin + "/deng-api";';
  if (out.includes(API_EXACT)) {
    out = out.replace(API_EXACT, API_REPL);
    apiPatched = true;
  } else {
    const re = /var API = "https:\/\/api\." \+ \w+;/;
    if (re.test(out)) {
      out = out.replace(re, API_REPL);
      apiPatched = true;
    }
  }

  // 2. Neutralize the localhost:8399 dev override → empty statement.
  const LOCAL_EXACT =
    'if (host === "localhost" || host === "127.0.0.1") API = "http://127.0.0.1:8399";';
  if (out.includes(LOCAL_EXACT)) {
    out = out.replace(LOCAL_EXACT, ";");
  } else {
    out = out.replace(
      /if \(host === "localhost"[^\n]*API = "http:\/\/127\.0\.0\.1:8399";/,
      ";"
    );
  }

  // 3. Rewrite the codexradar.com backlink to the local main-site clone.
  out = out.replace(/href="https:\/\/codexradar\.com\/?"/gi, 'href="/"');

  // 3b. Neutralize the runtime backlink re-derivation. The inline
  // syncMainSiteLinks() runs on every load and reassigns #backlink / #backlink2
  // / #iq-main-site-link to the LIVE apex, overwriting the static rewrite in
  // patch #3. Repoint those runtime assignments at the local clone root so the
  // "back to main site" links stay inside the archive (and, under ?at=, don't
  // jump from the archived snapshot to today's live site).
  out = out.replace(
    'el.href = "https://" + apex + (english ? "/en/" : "");',
    'el.href = "/";'
  );
  out = out.replace(
    /el\.href = "https:\/\/" \+ apex \+ \([^;]*\);/,
    'el.href = "/";'
  );
  out = out.replace(
    'if (iqLink) iqLink.href = "https://codexradar.com" + (english ? "/en/" : "");',
    'if (iqLink) iqLink.href = "/";'
  );
  out = out.replace(
    /if \(iqLink\) iqLink\.href = "https:\/\/codexradar\.com"[^;]*;/,
    'if (iqLink) iqLink.href = "/";'
  );

  // Add an archive shortcut beside the upstream DRadar source tab.
  out = out.replace(
    /(<a class="hero-link source-link"[^>]*>[\s\S]*?<\/a>)/i,
    '$1<a class="hero-link history-link" href="/history">长期历史</a>'
  );

  // 4. Timebar first (after all text patches so their indices are unaffected).
  out = injectTimebar(out, ctx);

  // 5. If the API rewrite failed, warn — timebar shows a badge.
  if (!apiPatched) {
    const tb = timebarScript(ctx);
    const warn =
      '<script>window.__DRADAR_PATCH_WARNING = "deng API base patch failed";</script>';
    out = out.replace(tb, tb + warn);
  }
  return out;
}

/** patchIntroHtml — deng intro page: timebar injection + beacon strip only. */
export function patchIntroHtml(html, ctx) {
  return injectTimebar(stripRemovedAssetImages(stripExternalBeacons(html)), ctx);
}
