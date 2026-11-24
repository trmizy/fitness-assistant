#!/usr/bin/env node
/**
 * Close / open the "front door" of the DEV app Lambdas while DEV is switched off.
 *
 *   node scripts/aws/lib/lambda-gate.cjs close     # reserved concurrency = 0  -> every call is rejected at once
 *   node scripts/aws/lib/lambda-gate.cjs open      # remove the reserved concurrency (back to the account pool)
 *   node scripts/aws/lib/lambda-gate.cjs status    # print the current setting of each function
 *
 * Why: with Aurora stopped, every request that still reaches these Lambdas waits for a database that is not there and dies after the
 * 30 s timeout - billed, and it fires the error alarms (2026-11-22: ~170 requests in 10 minutes). A throttled invocation
 * (reserved concurrency 0) never runs the code and is not billed by Lambda. Used by dev-stop.ps1 (-Backend: close) and dev-start.ps1
 * (-Backend: open, right after Aurora is AVAILABLE).
 *
 * Only the fixed list below is ever touched (the HTTP-facing functions); queue/schedule workers, migrate/restore/query helpers are left
 * alone. Refuses any account other than the DEV account. Idempotent: already in the wanted state = nothing to do.
 * Exit 0 = every function is in the wanted state, 1 = at least one could not be changed, 2 = bad usage / wrong account.
 */
"use strict";
const { execFileSync } = require("node:child_process");

const REGION = "ap-southeast-1";
const ACCOUNT = "191798898985";
const GATED = ["auth", "user", "gym", "payment", "fitness", "ai", "ai-stream"].map((n) => `fitness-assistant-dev-${n}`);

/** Pure: what has to be done to reach `action` given the current reserved concurrency (number, or null/undefined when unset). */
function planFor(action, current) {
  if (action === "close") return current === 0 ? "keep" : "put0";
  if (action === "open") return current === null || current === undefined ? "keep" : "delete";
  throw new Error(`unknown action '${action}'`);
}

function aws(args, { json = true } = {}) {
  const out = execFileSync("aws", [...args, "--region", REGION, ...(json ? ["--output", "json"] : [])], {
    encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 8 * 1024 * 1024,
  });
  return json && out.trim() ? JSON.parse(out) : null;
}

function getReserved(fn) {
  const r = aws(["lambda", "get-function-concurrency", "--function-name", fn]);
  return r && Object.prototype.hasOwnProperty.call(r, "ReservedConcurrentExecutions") ? r.ReservedConcurrentExecutions : null;
}

function main(argv) {
  const action = argv[0];
  if (!["close", "open", "status"].includes(action)) {
    console.error("usage: lambda-gate.cjs close|open|status");
    return 2;
  }
  const acct = aws(["sts", "get-caller-identity", "--query", "Account"]);
  if (acct !== ACCOUNT) {
    console.error(`refusing: running against account ${acct}, expected the DEV account`);
    return 2;
  }
  let failed = 0;
  for (const fn of GATED) {
    try {
      const before = getReserved(fn);
      if (action === "status") {
        console.log(`${fn}: reserved concurrency ${before === null ? "unset (open)" : before}`);
        continue;
      }
      const step = planFor(action, before);
      if (step === "put0") aws(["lambda", "put-function-concurrency", "--function-name", fn, "--reserved-concurrent-executions", "0"]);
      if (step === "delete") aws(["lambda", "delete-function-concurrency", "--function-name", fn], { json: false });
      const after = getReserved(fn);
      const ok = action === "close" ? after === 0 : after === null;
      if (!ok) throw new Error(`still ${after === null ? "unset" : after} after ${step}`);
      console.log(`${fn}: ${step === "keep" ? "already " : ""}${action === "close" ? "closed" : "open"}`);
    } catch (err) {
      failed += 1;
      console.error(`${fn}: FAILED - ${err && err.message ? String(err.message).split("\n")[0] : err}`);
    }
  }
  return failed ? 1 : 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`lambda-gate failed: ${err && err.message ? String(err.message).split("\n")[0] : err}`);
    process.exit(1);
  }
}

module.exports = { planFor, GATED };
