#!/usr/bin/env node
// Gymini DEV - point a service's DB secret at the RDS Proxy (or back at the Aurora cluster endpoint).
//
//   node scripts/aws/dev-rds-proxy-switch.mjs status
//   node scripts/aws/dev-rds-proxy-switch.mjs apply    --service gym [--execute]
//   node scripts/aws/dev-rds-proxy-switch.mjs rollback --service gym|--all [--execute]
//
// Dry run by default. The services build DATABASE_URL from the secret's host/port/user/password/database
// (config/lambda-runtime.ts), so the switch is ONE field of ONE secret per service - no code change.
// The original host is saved to .dev/aws/rds-proxy-original-hosts.json BEFORE the first change and is never
// overwritten, so `rollback` always restores the true cluster endpoint. Secret values are never printed.
//
// Lambdas cache the DATABASE_URL per execution environment, so after a change each function's configuration
// is touched (description only) to retire warm environments; verify with the "database configuration loaded"
// log line, which prints the host.
import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const REGION = "ap-southeast-1";
const ACCOUNT = "191798898985";
const STACK = "fitness-assistant-dev-rds-proxy";
const BACKUP = ".dev/aws/rds-proxy-original-hosts.json";
const SERVICES = {
  auth: { secret: "fitness-assistant/dev/database", lambdas: ["fitness-assistant-dev-auth"] },
  user: { secret: "fitness-assistant/dev/user-database", lambdas: ["fitness-assistant-dev-user", "fitness-assistant-dev-user-jobs"] },
  fitness: { secret: "fitness-assistant/dev/fitness-database", lambdas: ["fitness-assistant-dev-fitness", "fitness-assistant-dev-fitness-jobs"] },
  gym: { secret: "fitness-assistant/dev/gym-database", lambdas: ["fitness-assistant-dev-gym", "fitness-assistant-dev-gym-jobs"] },
  payment: { secret: "fitness-assistant/dev/payment-database", lambdas: ["fitness-assistant-dev-payment", "fitness-assistant-dev-payment-jobs"] },
  ai: { secret: "fitness-assistant/dev/ai-database", lambdas: ["fitness-assistant-dev-ai", "fitness-assistant-dev-ai-jobs", "fitness-assistant-dev-ai-worker"] },
};

const [cmd = "status", ...rest] = process.argv.slice(2);
const flag = (n) => rest.includes(n);
const opt = (n) => { const i = rest.indexOf(n); return i >= 0 ? rest[i + 1] : undefined; };
const EXECUTE = flag("--execute");

const aws = (args, input) =>
  execFileSync(process.platform === "win32" ? "aws.exe" : "aws", [...args, "--region", REGION, "--output", "json"], {
    encoding: "utf8", env: { ...process.env, AWS_PAGER: "" }, maxBuffer: 20 * 1024 * 1024, input,
  });
const awsJson = (args) => JSON.parse(aws(args) || "null");
const die = (m) => { console.error("HARD STOP: " + m); process.exit(2); };

const who = awsJson(["sts", "get-caller-identity"]);
if (who.Account !== ACCOUNT) die(`wrong AWS account ${who.Account}`);

function proxyEndpoint() {
  let st;
  try { st = awsJson(["cloudformation", "describe-stacks", "--stack-name", STACK]).Stacks[0]; }
  catch { return null; }
  if (st.StackStatus !== "CREATE_COMPLETE" && st.StackStatus !== "UPDATE_COMPLETE") die(`proxy stack is ${st.StackStatus}`);
  const out = Object.fromEntries((st.Outputs || []).map((o) => [o.OutputKey, o.OutputValue]));
  const p = awsJson(["rds", "describe-db-proxies", "--db-proxy-name", "fitness-assistant-dev-proxy"]).DBProxies[0];
  if (p.Status !== "available") die(`proxy status is ${p.Status}`);
  return out.ProxyEndpoint;
}

const clusterEndpoint = () =>
  awsJson(["rds", "describe-db-clusters", "--db-cluster-identifier", "fitness-assistant-dev-aurora"]).DBClusters[0].Endpoint;
const readSecret = (id) => JSON.parse(awsJson(["secretsmanager", "get-secret-value", "--secret-id", id]).SecretString);
function writeSecret(id, obj) {
  const f = path.join(os.tmpdir(), `gymini-secret-${process.pid}.json`);
  fs.writeFileSync(f, JSON.stringify(obj), { mode: 0o600 });
  try { aws(["secretsmanager", "put-secret-value", "--secret-id", id, "--secret-string", "file://" + f.replace(/\\/g, "/")]); }
  finally { fs.rmSync(f, { force: true }); }
}
const loadBackup = () => (fs.existsSync(BACKUP) ? JSON.parse(fs.readFileSync(BACKUP, "utf8")) : {});
function saveBackup(b) { fs.mkdirSync(path.dirname(BACKUP), { recursive: true }); fs.writeFileSync(BACKUP, JSON.stringify(b, null, 2)); }

function coldStart(lambdas) {
  const stamp = new Date().toISOString();
  for (const fn of lambdas) {
    aws(["lambda", "update-function-configuration", "--function-name", fn, "--description", `db host switched ${stamp}`]);
    aws(["lambda", "wait", "function-updated-v2", "--function-name", fn]);
    console.log(`   recycled ${fn}`);
  }
}
const hostKind = (h, proxy, back) => (h === proxy ? "PROXY" : back && h === back ? "cluster(original)" : h.includes(".proxy-") ? "proxy(other)" : "cluster");

function selected() {
  if (flag("--all")) return Object.keys(SERVICES);
  const s = opt("--service");
  if (!s || !SERVICES[s]) die(`--service must be one of ${Object.keys(SERVICES).join(", ")} (or --all for rollback)`);
  return [s];
}

if (cmd === "status") {
  const proxy = proxyEndpoint();
  const back = loadBackup();
  console.log(`proxy stack: ${proxy ? "present, endpoint " + proxy : "ABSENT"}`);
  for (const [name, s] of Object.entries(SERVICES)) console.log(`${name.padEnd(8)} host -> ${hostKind(readSecret(s.secret).host, proxy, back[s.secret])}`);
} else if (cmd === "apply") {
  if (flag("--all")) die("apply is deliberately one service at a time (use --service)");
  const proxy = proxyEndpoint() || die("proxy stack is absent");
  const back = loadBackup();
  for (const name of selected()) {
    const s = SERVICES[name];
    const sec = readSecret(s.secret);
    if (sec.host === proxy) { console.log(`${name}: already on the proxy`); continue; }
    if (sec.host.includes(".proxy-")) die(`${name}: secret points at another proxy, not touching it`);
    console.log(`${name}: ${EXECUTE ? "SWITCH" : "would switch"} secret ${s.secret} host -> proxy (original saved to ${BACKUP}); recycle ${s.lambdas.join(", ")}`);
    if (!EXECUTE) continue;
    back[s.secret] ??= sec.host; saveBackup(back);
    writeSecret(s.secret, { ...sec, host: proxy });
    coldStart(s.lambdas);
  }
} else if (cmd === "rollback") {
  // Rollback must work whatever state the proxy stack is in (even absent or deleting) - never gate it on the proxy.
  const back = loadBackup();
  for (const name of selected()) {
    const s = SERVICES[name];
    const sec = readSecret(s.secret);
    // Not on a proxy host = nothing to restore. Otherwise restore the saved original, falling back to the LIVE cluster
    // endpoint (every service secret originally pointed at it), so rollback never depends on which checkout holds the
    // backup file (dev-auto-stop runs from whichever worktree armed it).
    if (!sec.host.includes(".proxy-")) { console.log(`${name}: not on a proxy host - nothing to restore`); continue; }
    const original = back[s.secret] || clusterEndpoint();
    console.log(`${name}: ${EXECUTE ? "RESTORE" : "would restore"} original cluster host; recycle ${s.lambdas.join(", ")}`);
    if (!EXECUTE) continue;
    writeSecret(s.secret, { ...sec, host: original });
    coldStart(s.lambdas);
  }
} else die(`unknown command '${cmd}'`);
if (!EXECUTE && cmd !== "status") console.log("\nDRY RUN - nothing changed. Add --execute to apply.");
