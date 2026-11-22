#!/usr/bin/env node
/**
 * Close / open the PUBLIC entrances of the DEV app while DEV is switched off.
 *
 *   node scripts/aws/lib/web-gate.cjs close [--only api|cdn]
 *   node scripts/aws/lib/web-gate.cjs open  [--only api|cdn]
 *   node scripts/aws/lib/web-gate.cjs status
 *
 *   api : API Gateway stage `$default` of id1iz7upbl (api.gymini.vn). close = throttle 0 -> every request gets 429 within ~0.2 s, the Lambdas
 *         are never invoked and, being a 4xx, it does NOT fire the apigw-5xx-high alarm. open = the AWS default limits (10000 req/s, burst 5000)
 *         written EXPLICITLY, because merely omitting the throttle fields leaves 0 in place (verified 2026-11-22).
 *   cdn : CloudFront distribution E2MHD79JFC1700 (gymini.vn, www.gymini.vn, /ai/ask/stream). close = Enabled=false -> CloudFront refuses every
 *         request. CloudFront needs ~5-15 minutes to roll a change out in either direction, so dev-start opens it FIRST (the wait overlaps with
 *         Aurora starting). The distribution is edited the same way dev-start already edits its chat origin (read config, change, put with
 *         If-Match), so nothing else in the config (3 origins, behaviours, error pages, aliases, certificate) is touched.
 *
 * Used by dev-stop.ps1 -Backend (close, after Aurora is stopped) and dev-start.ps1 -Backend (cdn open at the start, api open once the
 * Lambdas are open). Refuses any account other than the DEV account. Idempotent. Exit 0 = wanted state reached (or already there),
 * 1 = something could not be changed, 2 = bad usage / wrong account.
 */
"use strict";
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const REGION = "ap-southeast-1";
const ACCOUNT = "191798898985";
const API_ID = "id1iz7upbl";
const DIST_ID = "E2MHD79JFC1700";
const OPEN_RATE = 10000; // AWS default account-level HTTP API limits
const OPEN_BURST = 5000;

/** Pure: do the stage's default route settings already match the wanted state? */
function apiIsAt(action, settings) {
  const s = settings || {};
  const rate = Number(s.ThrottlingRateLimit);
  const burst = Number(s.ThrottlingBurstLimit);
  if (action === "close") return s.ThrottlingRateLimit !== undefined && rate === 0 && burst === 0;
  return rate === OPEN_RATE && burst === OPEN_BURST;
}

/** Pure: the default route settings to write for `action`, keeping every other setting (e.g. DetailedMetricsEnabled). */
function apiTarget(action, settings) {
  const keep = { DetailedMetricsEnabled: Boolean(settings && settings.DetailedMetricsEnabled) };
  return action === "close"
    ? { ...keep, ThrottlingRateLimit: 0, ThrottlingBurstLimit: 0 }
    : { ...keep, ThrottlingRateLimit: OPEN_RATE, ThrottlingBurstLimit: OPEN_BURST };
}

/** Pure: should the distribution's Enabled flag change for `action`? */
function cdnNeedsChange(action, enabled) {
  return action === "close" ? enabled !== false : enabled !== true;
}

function aws(args, { region = REGION, json = true } = {}) {
  const out = execFileSync("aws", [...args, "--region", region, ...(json ? ["--output", "json"] : [])], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024,
  });
  return json && out.trim() ? JSON.parse(out) : null;
}

function getStageSettings() {
  return aws(["apigatewayv2", "get-stage", "--api-id", API_ID, "--stage-name", "$default", "--query", "DefaultRouteSettings"]) || {};
}

function doApi(action) {
  const before = getStageSettings();
  if (apiIsAt(action, before)) { console.log(`api: already ${action === "close" ? "closed (429)" : "open"}`); return true; }
  const t = apiTarget(action, before);
  aws(["apigatewayv2", "update-stage", "--api-id", API_ID, "--stage-name", "$default",
    "--default-route-settings", `ThrottlingBurstLimit=${t.ThrottlingBurstLimit},ThrottlingRateLimit=${t.ThrottlingRateLimit},DetailedMetricsEnabled=${t.DetailedMetricsEnabled}`]);
  const after = getStageSettings();
  if (!apiIsAt(action, after)) throw new Error(`api stage not at the wanted state after update: ${JSON.stringify(after)}`);
  console.log(`api: ${action === "close" ? "closed (every request answered 429 at once)" : "open (default limits)"}`);
  return true;
}

function doCdn(action) {
  const cur = aws(["cloudfront", "get-distribution-config", "--id", DIST_ID], { region: "us-east-1" });
  const cfg = cur.DistributionConfig;
  if (!cdnNeedsChange(action, cfg.Enabled)) { console.log(`cdn: already ${action === "close" ? "disabled" : "enabled"}`); return true; }
  cfg.Enabled = action === "open";
  const dir = mkdtempSync(join(tmpdir(), "cf-gate-"));
  try {
    const f = join(dir, "cfg.json");
    writeFileSync(f, JSON.stringify(cfg));
    aws(["cloudfront", "update-distribution", "--id", DIST_ID, "--if-match", cur.ETag, "--distribution-config", `file://${f.split("\\").join("/")}`], { region: "us-east-1" });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  const after = aws(["cloudfront", "get-distribution", "--id", DIST_ID, "--query", "{enabled:Distribution.DistributionConfig.Enabled,status:Distribution.Status}"], { region: "us-east-1" });
  if (after.enabled !== (action === "open")) throw new Error(`distribution Enabled=${after.enabled} after update`);
  console.log(`cdn: ${action === "close" ? "disabled" : "enabled"} (CloudFront status ${after.status}; takes ~5-15 min to roll out)`);
  return true;
}

function status() {
  const s = getStageSettings();
  console.log(`api: throttle rate=${s.ThrottlingRateLimit ?? "unset"} burst=${s.ThrottlingBurstLimit ?? "unset"} -> ${apiIsAt("close", s) ? "CLOSED" : "open"}`);
  const d = aws(["cloudfront", "get-distribution", "--id", DIST_ID, "--query", "{enabled:Distribution.DistributionConfig.Enabled,status:Distribution.Status}"], { region: "us-east-1" });
  console.log(`cdn: enabled=${d.enabled} status=${d.status} -> ${d.enabled ? "open" : "CLOSED"}`);
}

function main(argv) {
  const action = argv[0];
  const onlyIdx = argv.indexOf("--only");
  const only = onlyIdx >= 0 ? argv[onlyIdx + 1] : null;
  if (!["close", "open", "status"].includes(action) || (only !== null && !["api", "cdn"].includes(only))) {
    console.error("usage: web-gate.cjs close|open|status [--only api|cdn]");
    return 2;
  }
  const acct = aws(["sts", "get-caller-identity", "--query", "Account"]);
  if (acct !== ACCOUNT) { console.error(`refusing: running against account ${acct}, expected the DEV account`); return 2; }
  if (action === "status") { status(); return 0; }
  let failed = 0;
  for (const [name, fn] of [["api", doApi], ["cdn", doCdn]]) {
    if (only && only !== name) continue;
    try { fn(action); } catch (err) { failed += 1; console.error(`${name}: FAILED - ${err && err.message ? String(err.message).split("\n")[0] : err}`); }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  try { process.exit(main(process.argv.slice(2))); } catch (err) { console.error(`web-gate failed: ${err && err.message ? String(err.message).split("\n")[0] : err}`); process.exit(1); }
}

module.exports = { apiIsAt, apiTarget, cdnNeedsChange, OPEN_RATE, OPEN_BURST };
