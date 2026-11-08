// Test/seed scripts write test accounts and synthetic rows. They must only ever talk to a LOCAL stack — never to the
// deployed AWS server (2026-11-08: "không đẩy dữ liệu test lên server"). Call assertLocalTarget(url) / assertLocalDbHost(host)
// at startup; it throws before any request is made. ALLOW_REMOTE_TEST_TARGET=1 is the explicit, per-run escape hatch
// (the server itself also refuses test-domain sign-ups, see @gym-coach/shared test-accounts).

const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1", "[::1]", "0.0.0.0", "host.docker.internal"]);

/** Local = loopback, or a bare docker-compose service name (no dot), e.g. "gateway", "gymcoach-postgres". */
export function isLocalHost(host) {
  const h = String(host ?? "").trim().toLowerCase();
  if (!h) return false;
  return LOCAL_HOSTS.has(h) || /^127\./.test(h) || !h.includes(".");
}

function refuse(what, value) {
  if (process.env.ALLOW_REMOTE_TEST_TARGET === "1") {
    console.warn(`[assert-local-target] WARNING: ${what} ${value} is not local — continuing because ALLOW_REMOTE_TEST_TARGET=1`);
    return;
  }
  throw new Error(`[assert-local-target] refusing to run: ${what} ${value} is not a local stack. Test/seed data must never reach the deployed server. Set ALLOW_REMOTE_TEST_TARGET=1 only for a deliberate one-off.`);
}

export function assertLocalTarget(url) {
  let host;
  try { host = new URL(url).hostname; } catch { return refuse("target URL", url); }
  if (!isLocalHost(host)) refuse("target URL", url);
  return url;
}

export function assertLocalDbHost(host) {
  if (!isLocalHost(host)) refuse("database host", host);
  return host;
}
