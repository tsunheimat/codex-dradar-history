// HTTPS GET fetch layer with a strict host allowlist, size cap and etag support.
// No retry policy here — the collector's backoff owns retries.

export const ALLOWED_HOSTS = new Set([
  "codexradar.com",
  "www.codexradar.com",
  "deng.codexradar.com",
  "api.codexradar.com",
]);

export class FetchPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = "FetchPolicyError";
  }
}

export class FetchSizeError extends Error {
  constructor(message) {
    super(message);
    this.name = "FetchSizeError";
  }
}

const DEFAULT_MAX_BYTES = 8 * 1024 * 1024;
const DEFAULT_USER_AGENT =
  "dradar2/1.0 (+personal long-term archive of codexradar.com)";

function assertAllowed(rawUrl) {
  let u;
  try {
    u = new URL(rawUrl);
  } catch {
    throw new FetchPolicyError(`invalid url: ${rawUrl}`);
  }
  if (u.protocol !== "https:") {
    throw new FetchPolicyError(`non-https url rejected: ${rawUrl}`);
  }
  if (!ALLOWED_HOSTS.has(u.hostname)) {
    throw new FetchPolicyError(`host not allowlisted: ${u.hostname}`);
  }
  return u;
}

function parseRetryAfter(headerVal) {
  if (!headerVal) return null;
  const secs = Number(headerVal);
  if (Number.isFinite(secs) && secs >= 0) return Math.trunc(secs);
  const when = Date.parse(headerVal); // HTTP-date form
  if (!Number.isNaN(when)) {
    return Math.max(0, Math.round((when - Date.now()) / 1000));
  }
  return null;
}

export async function fetchUrl(
  url,
  { etag = null, timeoutMs = 20000, maxBytes = DEFAULT_MAX_BYTES, userAgent = DEFAULT_USER_AGENT } = {}
) {
  assertAllowed(url);

  const headers = { "User-Agent": userAgent, Accept: "*/*" };
  if (etag) headers["If-None-Match"] = etag;

  const response = await fetch(url, {
    method: "GET",
    headers,
    redirect: "follow",
    signal: AbortSignal.timeout(timeoutMs),
  });

  // redirects may leave the allowlist — re-validate the final URL host.
  assertAllowed(response.url);

  const retryAfter = parseRetryAfter(response.headers.get("retry-after"));

  if (response.status === 304) {
    // undici won't expose a body for 304; keep the caller's etag if none returned.
    return {
      status: 304,
      body: null,
      etag: response.headers.get("etag") || etag || null,
      contentType: null,
      notModified: true,
      finalUrl: response.url,
      retryAfter,
    };
  }

  let body = null;
  if (response.body) {
    const reader = response.body.getReader();
    const chunks = [];
    let total = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        total += value.byteLength;
        if (total > maxBytes) {
          await reader.cancel();
          throw new FetchSizeError(`response exceeded ${maxBytes} bytes for ${url}`);
        }
        chunks.push(Buffer.from(value));
      }
    } finally {
      // reader is released when the stream is fully read or cancelled.
    }
    body = Buffer.concat(chunks);
  } else {
    body = Buffer.alloc(0);
  }

  return {
    status: response.status,
    body,
    etag: response.headers.get("etag") || null,
    contentType: response.headers.get("content-type") || null,
    notModified: false,
    finalUrl: response.url,
    retryAfter,
  };
}
