// replay.js — time-travel resolution + page patching for the clone routes.
//
// These functions are pure (no I/O) so they can be unit-tested offline against
// the captured HTML fixtures. server.js calls them with the archived body plus
// the resolved capture metadata.

const TIMEBAR_SRC = "/__archive/timebar.js";

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
  let out = injectTimebar(html, ctx);
  out = out.replace(/href="https:\/\/deng\.codexradar\.com\/?"/gi, 'href="/deng/"');
  return out;
}

/**
 * patchDengHtml — deng.codexradar.com page. Repoints the runtime API base at the
 * local /deng-api mount, neutralizes the localhost dev override, rewrites the main
 * site backlink, and injects the timebar (first script). Emits a patch-failure
 * warning flag if the API base rewrite did not match (upstream markup drifted).
 */
export function patchDengHtml(html, ctx) {
  let out = html;
  let apiPatched = false;

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

/** patchIntroHtml — deng intro page: timebar injection only. */
export function patchIntroHtml(html, ctx) {
  return injectTimebar(html, ctx);
}
