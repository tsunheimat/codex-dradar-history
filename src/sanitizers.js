// Reduce large upstream payloads to the fields consumed by the retained
// summary widgets. Matrix state and contributor identity data are intentionally
// excluded from archive snapshots.

const RUN_FIELDS = [
  "passed", "graded_at", "duration_sec", "actual_cost_usd", "cost_complete",
  "cost_source", "n_agent_steps", "n_input_tokens", "n_output_tokens", "n_cache_tokens",
];

function parseBody(body) {
  const value = JSON.parse(Buffer.from(body).toString("utf8"));
  if (!value || typeof value !== "object") throw new Error("expected JSON object");
  return value;
}

function pickRun(run) {
  if (!run || typeof run !== "object") return null;
  const out = {};
  for (const field of RUN_FIELDS) {
    if (Object.prototype.hasOwnProperty.call(run, field)) out[field] = run[field];
  }
  return out;
}

/** Keep the IQ/efficiency input while dropping matrix-only state and identities. */
export function sanitizeDengTableBody(body) {
  const d = parseBody(body);
  const cells = {};
  for (const [key, cell] of Object.entries(d.cells || {})) {
    if (!cell || typeof cell !== "object") continue;
    const next = {};
    if (Object.prototype.hasOwnProperty.call(cell, "p")) next.p = cell.p;
    if (Object.prototype.hasOwnProperty.call(cell, "n")) next.n = cell.n;
    if (Array.isArray(cell.ran_by)) {
      next.ran_by = cell.ran_by.map(pickRun).filter(Boolean);
    }
    cells[key] = next;
  }
  return Buffer.from(JSON.stringify({
    schema: d.schema,
    combos: Array.isArray(d.combos)
      ? d.combos.map((c) => ({ model: c.model, effort: c.effort })) : [],
    tasks: Array.isArray(d.tasks)
      ? d.tasks.map((t) => ({ id: t.id, language: t.language })) : [],
    cells,
  }));
}

/**
 * Remove the subscription matrix, contributor ladder, and report launcher
 * from the archived page shell. The upper IQ/efficiency cards remain intact.
 */
export function sanitizeDengHtmlBody(body) {
  let out = Buffer.isBuffer(body) ? body.toString("utf8") : String(body ?? "");
  const matrixStart = out.indexOf('<div class="matrix-tools" id="matrix-tools">');
  const joinStart = matrixStart >= 0 ? out.indexOf('<section id="join">', matrixStart) : -1;
  if (matrixStart >= 0 && joinStart > matrixStart) {
    out = out.slice(0, matrixStart) + out.slice(joinStart);
  }
  out = out.replace(/\s*<section id="contributors">[\s\S]*?<\/section>\s*/i, "\n");
  out = out.replace(/\s*<section id="join">[\s\S]*?<\/section>\s*/i, "\n");
  for (const title of ["会烧我多少额度？", "积分怎么算？", "天梯排名怎样影响并发和领题数？", "自行车和蹬踏时间怎么算？"]) {
    const escaped = title.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    out = out.replace(new RegExp("\\s*<details><summary>" + escaped + "<\\/summary>[\\s\\S]*?<\\/details>", "i"), "");
  }
  out = out.replace(/\s*<a class="hero-link ladder-link"[^>]*>[\s\S]*?<\/a>/i, "");
  out = out.replace(/\s*<button class="report-launch"[^>]*>[\s\S]*?<\/button>/i, "");
  out = out.replace(/\s*<script src="assets\/radar-report\.js[^>]*><\/script>/i, "");
  return Buffer.from(out, "utf8");
}
