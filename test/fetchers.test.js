// Tests for src/fetchers.js. Contract: SPEC §4.
// The fetcher rejects non-HTTPS and non-allowlisted hosts, so behaviour cases run against a
// LOCAL https server with an embedded self-signed cert (no upstream network is ever touched).
// node --test isolates each test file in its own process, so the TLS/allowlist mutations below
// do not leak into the other suites.
process.env.NODE_TLS_REJECT_UNAUTHORIZED = '0';

import { test, before, after } from 'node:test';
import assert from 'node:assert/strict';
import https from 'node:https';

import { fetchUrl, ALLOWED_HOSTS } from '../src/fetchers.js';

// Self-signed cert/key (CN=localhost, SAN 127.0.0.1). Only used for a loopback test server;
// certificate validity is irrelevant because NODE_TLS_REJECT_UNAUTHORIZED=0 is set above.
const CERT = `-----BEGIN CERTIFICATE-----
MIIDJzCCAg+gAwIBAgIUZlxsWb17x+y1eQMbC/aEPgOVRIgwDQYJKoZIhvcNAQEL
BQAwFDESMBAGA1UEAwwJbG9jYWxob3N0MCAXDTI2MDczMDE2NTIxNFoYDzIxMjYw
NzA2MTY1MjE0WjAUMRIwEAYDVQQDDAlsb2NhbGhvc3QwggEiMA0GCSqGSIb3DQEB
AQUAA4IBDwAwggEKAoIBAQCc6+N0Novn5H3vEpYfma2D8W2vkPoNQc7oRQIQCdN4
HQeftZq3r7bMXJE7UFQsaD+5SVGHf4Cxs4SWbCnC1K0WdKlQDCuR7SJxKQCmaiq3
+iUrb7bZBwApNs+4jkGeUHKqGaPzzfT1Uv/rbXnWXFhScM9vDluxW0yUKnIazbRC
dCTcjA35pMcnW+PBjCveS9hMJXSA9Tbjf6W7ftKKUuG/JMNyTv52yirEC62jT9+F
HMv+/ybnxg4y5Wt7NC2F7qToc7ZcOogl2ZVMMBqh8UrD3RdIIpgYYs1ja5tNPEBE
Lv+ki0kZuzJvJ/Q/dfhqzvbFdu+8eWZHT4WVbZJsDC7rAgMBAAGjbzBtMB0GA1Ud
DgQWBBR6K82Cv+J9+Tf+z0FawcWNk+VJzzAfBgNVHSMEGDAWgBR6K82Cv+J9+Tf+
z0FawcWNk+VJzzAPBgNVHRMBAf8EBTADAQH/MBoGA1UdEQQTMBGHBH8AAAGCCWxv
Y2FsaG9zdDANBgkqhkiG9w0BAQsFAAOCAQEAaqwAud5Qlf2yrVUx2OM8Ah+9VGpW
mfuyfBORxfwEM9TIDRIicsyU1heuow1dnA5nVwobJomarUmTwuDSiuMG7f35CE2m
v2PGNyRXN7+fwI3XlRlB0F1gRowd1u2OXiyNcQmLEMbsWkSwLaiQWZxWIfYYNqQh
fAux8+JSn26a6GuBsiTprBfGSrEHmpHdbn3KUp6hFqZVKVA1HfrbEkZx4u2u/XMG
yTK/foH3LP6pMutKz2Zg75OuTgxWP1oruyKMy00ExR6kn9pMb0CKyS9BDgYCxssQ
9Udg0Qvaguo65bom38Hjb6zyXOqH/OPZPgFg3oKfwne1XBvRx8Vag3X3/Q==
-----END CERTIFICATE-----
`;
const KEY = `-----BEGIN PRIVATE KEY-----
MIIEvQIBADANBgkqhkiG9w0BAQEFAASCBKcwggSjAgEAAoIBAQCc6+N0Novn5H3v
EpYfma2D8W2vkPoNQc7oRQIQCdN4HQeftZq3r7bMXJE7UFQsaD+5SVGHf4Cxs4SW
bCnC1K0WdKlQDCuR7SJxKQCmaiq3+iUrb7bZBwApNs+4jkGeUHKqGaPzzfT1Uv/r
bXnWXFhScM9vDluxW0yUKnIazbRCdCTcjA35pMcnW+PBjCveS9hMJXSA9Tbjf6W7
ftKKUuG/JMNyTv52yirEC62jT9+FHMv+/ybnxg4y5Wt7NC2F7qToc7ZcOogl2ZVM
MBqh8UrD3RdIIpgYYs1ja5tNPEBELv+ki0kZuzJvJ/Q/dfhqzvbFdu+8eWZHT4WV
bZJsDC7rAgMBAAECggEANrVUzODxgOzb7PxFY4oAARasX3/DddjCKp9Yez/5vpAc
ZtV5Nd4odHI3Xf8BAaRsxwvlRUCyHQIR0SGvo5HjMIeGufYsQIl0rxAU/m/YKeEn
kU+25042A6hs3hKWlPvGJkCfNPJSmy8PM0StLAtw7XkQEM9oL1q9xZBQzMB3vozU
ieciBZBK8fvw+rJTqExVc/s9cJybfilD/fD0F32IAFFxPwILCIPSCiGPGQ9/j5FG
UeurrX6SRxqbQc9cQLik2v4Ekyi8Cj7/NTuDOvi3iQVptEB8yAvOwc4VqbOJ7eCA
3Pyoo4AP/sjRvqtPKc5PlmNXFfbvo9WKO7GiU1cF0QKBgQDUXB20aup2VBz5S7uj
GqK2cmt9SxDx1WFZhXQ2uN+ziIWehU8ocu7NHdSWphoTLlCHJoSx2hKwl3fy0PCs
P9yygIdEGAZjcyJbDKlXYfRnChQLVWKju39h7QXXgHFlD0hnVqMUN1AcgLYg/iMN
paVFB4FGKC8kw2xVia2MAjbfOwKBgQC9K0EojEmP0WGr+90/QHy3P/aCNkFadqPI
g6Giw/KLdlobzluuqNdGkbAcG6xjWVlGh5hWfIwGR4PJQKPZePjcGMc/XoNsG8h1
zTwxfRXL5yEkn6yCW/8iuprmu0iVSZzP9iNvtePyIUfDoYi4wM9wlOFN+zCEw/2P
y3BzzPhUEQKBgQCbY4gs42sLCMNmu77iO3RCknkK5mnQu3WPfvKptB+kjEpR03Q3
wdnxZ1mOnp5H2MT+D/Za+Zphc4RGvhLNx7EjQJ85+WZ7UN0byKkFEt02pI5EOMeD
zYgJTNnQdeEDtOojC6cq/Mp3AMvEWpGlw8aqOzKh9neArCrScHr4Dwq9zwKBgEQg
Ob0SmMN0kopPkGRhIwkTvgEy7OJZa66gyStHCihznQv6i0YhhDXj7dqRlMnKub4O
wywSepMgWjO2VcvSJz2MpuUJcqcScmUKXq0r8ReXy3XXE1d3LjEhpvuFYyRweErk
x+pJRShEGAY6PHTc61gOJf3hgp2tv7lzeLIblSshAoGALzsETXa8yMt4uNp68TGH
VNMSpR/pzXu4lCwrf3CX7G6s5YBDALjO3iYWbdwsoyklUpse6iNNYkCGT2M2IpOs
NiFbgcZNhMCKCxfsZ0OJYOZvngEo1e+e+puVpbIlyQbFmR1XgiXfLdFeXNW632XP
ToPgjcY2D4sIm6Hbt7lQwhw=
-----END PRIVATE KEY-----
`;

let server;
let base;
let lastReq = {}; // captures headers of the last request to /etag

before(async () => {
  ALLOWED_HOSTS.add('127.0.0.1'); // permit the loopback test server through the policy gate
  server = https.createServer({ cert: CERT, key: KEY }, (req, res) => {
    const url = new URL(req.url, 'https://127.0.0.1');
    if (url.pathname === '/etag') {
      lastReq = { ...req.headers };
      res.setHeader('ETag', '"v1"');
      res.setHeader('Content-Type', 'application/json');
      if (req.headers['if-none-match'] === '"v1"') { res.statusCode = 304; return res.end(); }
      return res.end('{"ok":true}');
    }
    if (url.pathname === '/big') {
      res.setHeader('Content-Type', 'application/octet-stream');
      return res.end(Buffer.alloc(200 * 1024, 0x61)); // 200 KB
    }
    res.statusCode = 404;
    res.end('nope');
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `https://127.0.0.1:${server.address().port}`;
});

after(async () => {
  ALLOWED_HOSTS.delete('127.0.0.1');
  await new Promise((r) => server.close(r));
});

test('rejects non-https URLs with FetchPolicyError (no network)', async () => {
  await assert.rejects(() => fetchUrl('http://127.0.0.1:1/'), { name: 'FetchPolicyError' });
});

test('rejects hosts outside the allowlist with FetchPolicyError (no network)', async () => {
  // .invalid never resolves; and the policy check should reject before any connection anyway.
  await assert.rejects(() => fetchUrl('https://blocked.invalid/'), { name: 'FetchPolicyError' });
});

test('200 returns body + etag, forwards User-Agent and Accept', async () => {
  const r = await fetchUrl(`${base}/etag`, { userAgent: 'dradar2-test-agent' });
  assert.equal(r.status, 200);
  assert.equal(r.notModified, false);
  assert.ok(Buffer.isBuffer(r.body));
  assert.equal(r.body.toString('utf8'), '{"ok":true}');
  assert.equal(r.etag, '"v1"');
  assert.match(r.contentType || '', /application\/json/);
  assert.equal(lastReq['user-agent'], 'dradar2-test-agent', 'User-Agent forwarded from options');
  assert.ok((lastReq['accept'] || '').includes('*/*'), 'Accept: */* forwarded');
});

test('304 handling: matching If-None-Match yields notModified + null body', async () => {
  const r = await fetchUrl(`${base}/etag`, { etag: '"v1"' });
  assert.equal(r.status, 304);
  assert.equal(r.notModified, true);
  assert.equal(r.body, null);
  assert.equal(lastReq['if-none-match'], '"v1"', 'etag was sent as If-None-Match');
});

test('size cap: body beyond maxBytes aborts with FetchSizeError', async () => {
  await assert.rejects(() => fetchUrl(`${base}/big`, { maxBytes: 1024 }), { name: 'FetchSizeError' });
});
