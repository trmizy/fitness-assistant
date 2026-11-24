#!/usr/bin/env node
/**
 * Set (or blank) ONE environment variable on ONE DEV Lambda without touching the others.
 *
 *   node scripts/aws/lib/set-lambda-env.cjs <function-name> <KEY> <value>     # set / overwrite
 *   node scripts/aws/lib/set-lambda-env.cjs <function-name> <KEY> --empty     # set to "" (key stays, value blank)
 *
 * Why: `aws lambda update-function-configuration --environment` REPLACES the whole map, so changing one key by hand risks dropping the
 * secrets next to it. This reads the current map, changes the one key, writes the whole map back, and waits for the update. Only the key
 * name, whether it changed, and the (non-secret) new value are printed - never the other variables.
 * Used by dev-start.ps1 (-Chat: user Lambda CHAT_SERVICE_URL -> the NEW chat ALB, whose DNS name changes on every start) and dev-stop.ps1
 * (-Chat: blank it again). Refuses any account other than the DEV account. Exit 0 = already right or updated, 1 = failed.
 */
"use strict";
const { execFileSync } = require("node:child_process");
const { mkdtempSync, rmSync, writeFileSync } = require("node:fs");
const { tmpdir } = require("node:os");
const { join } = require("node:path");

const REGION = "ap-southeast-1";
const ACCOUNT = "191798898985";

/** Pure: the map to write back and whether anything changes. */
function mergeEnv(current, key, value) {
  const cur = current && typeof current === "object" ? current : {};
  if (Object.prototype.hasOwnProperty.call(cur, key) && cur[key] === value) return { changed: false, next: cur };
  return { changed: true, next: { ...cur, [key]: value } };
}

function aws(args) {
  const out = execFileSync("aws", [...args, "--region", REGION, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : null;
}

function main(argv) {
  const [fnName, key, rawValue] = argv;
  if (!fnName || !key || rawValue === undefined) {
    console.error("usage: set-lambda-env.cjs <function-name> <KEY> <value|--empty>");
    return 2;
  }
  if (!/^fitness-assistant-dev-[a-z0-9-]+$/.test(fnName)) {
    console.error(`refusing: '${fnName}' is not a fitness-assistant-dev-* function`);
    return 2;
  }
  const value = rawValue === "--empty" ? "" : rawValue;
  const acct = aws(["sts", "get-caller-identity", "--query", "Account"]);
  if (acct !== ACCOUNT) {
    console.error(`refusing: running against account ${acct}, expected the DEV account`);
    return 2;
  }
  const current = aws(["lambda", "get-function-configuration", "--function-name", fnName, "--query", "Environment.Variables"]) || {};
  const { changed, next } = mergeEnv(current, key, value);
  if (!changed) {
    console.log(`${fnName} ${key}: already ${value === "" ? "empty" : "set to the wanted value"} - nothing to do`);
    return 0;
  }
  const dir = mkdtempSync(join(tmpdir(), "lambda-env-"));
  try {
    const f = join(dir, "env.json");
    writeFileSync(f, JSON.stringify({ Variables: next }));
    aws(["lambda", "update-function-configuration", "--function-name", fnName, "--environment", `file://${f.replace(/\\/g, "/")}`]);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
  execFileSync("aws", ["lambda", "wait", "function-updated", "--function-name", fnName, "--region", REGION], { stdio: "ignore" });
  console.log(`${fnName} ${key}: ${value === "" ? "blanked" : `set to ${value}`}`);
  return 0;
}

if (require.main === module) {
  try {
    process.exit(main(process.argv.slice(2)));
  } catch (err) {
    console.error(`set-lambda-env failed: ${err && err.message ? String(err.message).split("\n")[0] : err}`);
    process.exit(1);
  }
}

module.exports = { mergeEnv };
