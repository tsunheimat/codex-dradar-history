// Payload extractors. Each parses a captured body and upserts merged rows via
// the Archive API. All are idempotent: re-running on the same payload inserts 0
// new rows (except `dengstats`, a pure time-series sampler). Parse errors throw
// so the collector records the run as failed.
import crypto from "node:crypto";

const num = (x) => (typeof x === "number" && Number.isFinite(x) ? x : null);
const intOrNull = (x) => {
  const n = num(x);
  return n === null ? null : Math.trunc(n);
};
const str = (x) => (x == null ? null : String(x));

function toIso(s) {
  if (typeof s !== "string" || !s) return null;
  const d = new Date(s);
  return Number.isNaN(d.getTime()) ? null : d.toISOString();
}

// Recursively key-sorted JSON — the canonical form used for cell hashing.
function canonicalize(v) {
  if (v === null || typeof v !== "object") return v;
  if (Array.isArray(v)) return v.map(canonicalize);
  const out = {};
  for (const k of Object.keys(v).sort()) out[k] = canonicalize(v[k]);
  return out;
}
export function canonicalJson(v) {
  return JSON.stringify(canonicalize(v));
}
function sha256hex(s) {
  return crypto.createHash("sha256").update(s).digest("hex");
}

function parseJson(body) {
  return JSON.parse(Buffer.isBuffer(body) ? body.toString("utf8") : String(body));
}

// -------------------------------------------------------------------- ratings

function ratings(archive, body) {
  const d = parseJson(body);
  // Dedupe by (day, modelId): the top-level "current day" is a rolling-window
  // snapshot labelled with today's date, which can collide with history's
  // calendar-day entry for the same date. Process current first then history
  // so the per-calendar-day history value wins — and, crucially, a single
  // deduped row per (day, model) keeps the extractor idempotent.
  const byKey = new Map();
  const addDay = (dayObj) => {
    if (!dayObj || typeof dayObj !== "object") return;
    const day = dayObj.day;
    if (!day) return;
    const updatedAt = dayObj.updated_at ?? null;
    for (const m of Array.isArray(dayObj.models) ? dayObj.models : []) {
      if (!m || m.id == null) continue;
      const modelId = String(m.id);
      byKey.set(`${day}\0${modelId}`, {
        day,
        modelId,
        label: str(m.label),
        grp: str(m.group),
        average: num(m.average),
        count: intOrNull(m.count),
        updatedAt,
      });
    }
  };
  addDay({ day: d.day, updated_at: d.updated_at, models: d.models });
  for (const h of Array.isArray(d.history) ? d.history : []) addDay(h);
  return archive.upsertRatingDays([...byKey.values()]);
}

// ---------------------------------------------------------------- subscribers

function subscribers(archive, body, capturedAt) {
  const d = parseJson(body);
  const count = intOrNull(d.count);
  if (count === null) return 0;
  const latest = archive.latestSubscriberCount();
  if (latest === count) return 0;
  archive.insertSubscriberCount({ ts: capturedAt, count });
  return 1;
}

// ----------------------------------------------------------------------- rss

function rssTag(block, name) {
  const re = new RegExp(`<${name}\\b[^>]*>([\\s\\S]*?)</${name}>`, "i");
  const m = block.match(re);
  if (!m) return null;
  let v = m[1];
  const cd = v.match(/<!\[CDATA\[([\s\S]*?)\]\]>/);
  if (cd) v = cd[1];
  return v.trim();
}

function rss(archive, body, capturedAt) {
  const xml = Buffer.isBuffer(body) ? body.toString("utf8") : String(body);
  const rows = [];
  for (const m of xml.matchAll(/<item\b[^>]*>([\s\S]*?)<\/item>/gi)) {
    const block = m[1];
    const guid = rssTag(block, "guid");
    const link = rssTag(block, "link");
    const key = (guid || link || "").trim();
    if (!key) continue;
    rows.push({
      guid: key,
      pubDate: rssTag(block, "pubDate"),
      title: rssTag(block, "title"),
      link,
      description: rssTag(block, "description"),
      firstSeen: capturedAt,
    });
  }
  return archive.upsertRssItems(rows);
}

// ------------------------------------------------------------------------ iq

function iq(archive, body) {
  const d = parseJson(body);
  const rows = [];
  for (const [series, arr] of Object.entries(d)) {
    if (!Array.isArray(arr)) continue;
    for (const p of arr) {
      if (!p || typeof p !== "object") continue;
      const score = num(p.score);
      if (score === null) continue;
      const ts = toIso(p.ts);
      if (!ts) continue;
      rows.push({ series, ts, score, n: intOrNull(p.n) });
    }
  }
  return archive.upsertIqPoints(rows);
}

// -------------------------------------------------------------------- events

function events(archive, body) {
  const d = parseJson(body);
  const rows = [];
  for (const e of Array.isArray(d.events) ? d.events : []) {
    if (!e || typeof e !== "object") continue;
    const gradedAt = toIso(e.graded_at);
    const taskId = str(e.task_id);
    const model = str(e.model);
    const effort = str(e.effort);
    if (!gradedAt || taskId == null || model == null || effort == null) continue;
    rows.push({
      gradedAt,
      taskId,
      model,
      effort,
      nickname: e.nickname ?? "",
      passed: e.passed == null ? null : e.passed ? 1 : 0,
      costUsd: num(e.cost_usd),
      costSource: str(e.cost_source),
      costIsEstimate: e.cost_is_estimate == null ? null : e.cost_is_estimate ? 1 : 0,
      points: num(e.points),
      avatarSeed: str(e.avatar_seed),
    });
  }
  return archive.insertEvents(rows);
}

// ------------------------------------------------------------------- cells

function cells(archive, body, capturedAt) {
  const d = parseJson(body);
  for (const t of Array.isArray(d.tasks) ? d.tasks : []) {
    if (!t || typeof t !== "object" || t.id == null) continue;
    archive.upsertDengTask({
      id: String(t.id),
      title: str(t.title),
      language: str(t.language),
      repo: str(t.repo),
      category: str(t.category),
      json: JSON.stringify(t),
      seenAt: capturedAt,
    });
  }
  let changed = 0;
  const table = d.cells && typeof d.cells === "object" ? d.cells : {};
  for (const key of Object.keys(table)) {
    const canon = canonicalJson(table[key]);
    const hash = sha256hex(canon);
    if (archive.latestCellHash(key) === hash) continue; // fast path — unchanged
    archive.upsertCellState({ cellKey: key, payloadJson: canon, hash, seenAt: capturedAt });
    changed++;
  }
  return changed;
}

// --------------------------------------------------------------- dengstats

function dengstats(archive, body, capturedAt) {
  const d = parseJson(body);
  const pedal = d.pedal_speed && typeof d.pedal_speed === "object" ? d.pedal_speed : null;
  const burn = d.latest_burn && typeof d.latest_burn === "object" ? d.latest_burn : null;
  const month = d.month && typeof d.month === "object" ? d.month : null;
  archive.insertDengStats({
    ts: capturedAt,
    onlineVolunteers: intOrNull(d.online_volunteers),
    pendingGrades: intOrNull(d.pending_grades),
    errorGrades: intOrNull(d.error_grades),
    contributorsCount: Array.isArray(d.contributors) ? d.contributors.length : null,
    pedalUsdPerHour: pedal ? num(pedal.usd_per_hour) : null,
    pedalRuns: pedal ? intOrNull(pedal.actual_runs) : null,
    burnTokens: burn ? intOrNull(burn.tokens) : null,
    burnUsd: burn ? num(burn.usd) : null,
    monthLabel: month ? str(month.label) : null,
  });
  return 1; // always samples — a time-series point per poll
}

export const EXTRACTORS = { ratings, subscribers, rss, iq, events, cells, dengstats };

export function runExtractor(name, archive, body, capturedAtIso) {
  const fn = EXTRACTORS[name];
  if (!fn) throw new Error(`unknown extractor: ${name}`);
  const changed = fn(archive, body, capturedAtIso);
  return { changed: Number(changed) || 0 };
}
