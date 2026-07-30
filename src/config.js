// Config loader for dradar2. Reads an optional .env in cwd (real env wins),
// applies documented defaults, returns a frozen config object.
import fs from "node:fs";
import path from "node:path";

const DEFAULT_USER_AGENT =
  "dradar2/1.0 (+personal long-term archive of codexradar.com)";

function parseEnvFile(text) {
  const out = {};
  for (let line of text.split(/\r?\n/)) {
    line = line.trim();
    if (!line || line.startsWith("#")) continue;
    const eq = line.indexOf("=");
    if (eq < 0) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if (
      (val.startsWith('"') && val.endsWith('"')) ||
      (val.startsWith("'") && val.endsWith("'"))
    ) {
      val = val.slice(1, -1);
    }
    if (key) out[key] = val;
  }
  return out;
}

function readEnvFile() {
  try {
    return parseEnvFile(fs.readFileSync(path.join(process.cwd(), ".env"), "utf8"));
  } catch {
    return {};
  }
}

export function loadConfig(env = process.env) {
  const fileVars = readEnvFile();
  // real env wins over .env file; empty string counts as unset.
  const pick = (name) => {
    const fromEnv = env[name];
    if (fromEnv != null && fromEnv !== "") return fromEnv;
    const fromFile = fileVars[name];
    if (fromFile != null && fromFile !== "") return fromFile;
    return undefined;
  };
  const num = (name, dflt) => {
    const raw = pick(name);
    if (raw === undefined) return dflt;
    const v = Number(raw);
    return Number.isFinite(v) ? v : dflt;
  };
  const int = (name, dflt) => {
    const v = num(name, dflt);
    return Math.trunc(v);
  };
  const str = (name, dflt) => {
    const raw = pick(name);
    return raw === undefined ? dflt : raw;
  };

  let feedIntervals = {};
  const fiRaw = pick("FEED_INTERVALS");
  if (fiRaw) {
    try {
      const parsed = JSON.parse(fiRaw);
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
        feedIntervals = parsed;
      }
    } catch {
      // ignore malformed override JSON — fall back to no overrides
    }
  }

  const maxResponseMb = num("MAX_RESPONSE_MB", 8);
  const config = {
    port: int("PORT", 3210),
    bind: str("BIND", "0.0.0.0"),
    dataDir: str("DATA_DIR", "./data"),
    userAgent: str("USER_AGENT", DEFAULT_USER_AGENT),
    maxResponseMb,
    maxBytes: Math.trunc(maxResponseMb * 1024 * 1024),
    runsKeepDays: int("RUNS_KEEP_DAYS", 30),
    intervalScale: num("INTERVAL_SCALE", 1.0),
    feedIntervals,
  };

  Object.freeze(config.feedIntervals);
  return Object.freeze(config);
}
