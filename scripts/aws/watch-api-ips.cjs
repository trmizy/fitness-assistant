#!/usr/bin/env node
/**
 * Watch the DEV API Gateway access log and raise an alert when a source IP outside the allow-list calls the API.
 *
 *   node scripts/aws/watch-api-ips.cjs --allow 14.187.110.63[,ip2,...] [--hours 10] [--interval 60] [--no-email] [--no-toast] [--dry-run]
 *
 * Log group: /aws/apigateway/fitness-assistant-dev-api-access (API Gateway stage access log, 7-day retention; has every request incl. the
 * ones the closed Lambdas reject). Each NEW unknown IP is reported ONCE (then remembered for the run) with its request count, first/last
 * time, user-agents, paths and status codes. Alert channels: (1) e-mail through the existing SNS topic fitness-assistant-dev-app-alerts (the
 * address that already receives the CloudWatch alarms), (2) a Windows balloon notification, (3) the console / a log file in .dev/aws/.
 * Read-only on the log; the only write is sns:Publish. Refuses any account other than the DEV account.
 *
 * Only the API (api.gymini.vn / execute-api) is covered: CloudFront (gymini.vn web + /ai/ask/stream) has no access log enabled.
 * A phone on mobile data has another public IP than the PC on Wi-Fi: add it to --allow or it will (rightly) be reported.
 */
"use strict";
const { execFileSync, spawn } = require("node:child_process");
const { appendFileSync, mkdirSync } = require("node:fs");
const { join } = require("node:path");

const REGION = "ap-southeast-1";
const ACCOUNT = "191798898985";
const LOG_GROUP = "/aws/apigateway/fitness-assistant-dev-api-access";
const TOPIC = `arn:aws:sns:${REGION}:${ACCOUNT}:fitness-assistant-dev-app-alerts`;

/** Pure: fold parsed access-log lines into per-IP summaries, skipping allowed and already-reported IPs. */
function newUnknownIps(lines, allow, reported) {
  const byIp = new Map();
  for (const d of lines) {
    const ip = d && d.ip;
    if (!ip || allow.has(ip) || reported.has(ip)) continue;
    const s = byIp.get(ip) || { ip, count: 0, first: d.time, last: d.time, agents: new Set(), paths: new Set(), statuses: new Set() };
    s.count += 1;
    s.last = d.time;
    if (d.ua) s.agents.add(String(d.ua).slice(0, 80));
    if (d.path) s.paths.add(`${d.method || ""} ${d.path}`.trim());
    if (d.status) s.statuses.add(String(d.status));
    byIp.set(ip, s);
  }
  return [...byIp.values()];
}

function describe(s) {
  return [
    `IP la truy cap API Gymini DEV: ${s.ip}`,
    `So request: ${s.count} (tu ${s.first} den ${s.last})`,
    `Trinh duyet/cong cu: ${[...s.agents].slice(0, 3).join(" | ") || "-"}`,
    `Duong dan: ${[...s.paths].slice(0, 6).join(", ") || "-"}`,
    `Ma tra ve: ${[...s.statuses].join(", ")}`,
    `Log: ${LOG_GROUP}`,
  ].join("\n");
}

function aws(args) {
  const out = execFileSync("aws", [...args, "--region", REGION, "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 32 * 1024 * 1024 });
  return out.trim() ? JSON.parse(out) : null;
}

function readLines(startMs) {
  const lines = [];
  let token;
  do {
    const args = ["logs", "filter-log-events", "--log-group-name", LOG_GROUP, "--start-time", String(startMs)];
    if (token) args.push("--next-token", token);
    const r = aws(args) || {};
    for (const e of r.events || []) {
      try { lines.push({ ...JSON.parse(e.message), _ts: e.timestamp }); } catch { /* not a JSON access line */ }
    }
    token = r.nextToken;
  } while (token);
  return lines;
}

function toast(title, text) {
  const ps = `Add-Type -AssemblyName System.Windows.Forms; $n = New-Object System.Windows.Forms.NotifyIcon; $n.Icon = [System.Drawing.SystemIcons]::Warning; $n.Visible = $true; $n.ShowBalloonTip(15000, '${title.replace(/'/g, "")}', '${text.replace(/'/g, "").replace(/\r?\n/g, " ").slice(0, 250)}', 'Warning'); Start-Sleep -Seconds 16; $n.Dispose()`;
  spawn("powershell.exe", ["-NoProfile", "-WindowStyle", "Hidden", "-Command", ps], { detached: true, stdio: "ignore" }).unref();
}

function parseArgs(argv) {
  const o = { allow: [], hours: 10, interval: 60, email: true, toast: true, dry: false };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--allow") o.allow = String(argv[++i] || "").split(",").map((x) => x.trim()).filter(Boolean);
    else if (a === "--hours") o.hours = Number(argv[++i]);
    else if (a === "--interval") o.interval = Number(argv[++i]);
    else if (a === "--no-email") o.email = false;
    else if (a === "--no-toast") o.toast = false;
    else if (a === "--dry-run") o.dry = true;
    else throw new Error(`unknown argument ${a}`);
  }
  if (!o.allow.length) throw new Error("--allow <ip[,ip...]> is required (your own public IP(s)); nothing is reported for them");
  if (!(o.hours > 0 && o.hours <= 48) || !(o.interval >= 15)) throw new Error("--hours must be 0-48 and --interval at least 15 seconds");
  return o;
}

async function main() {
  const o = parseArgs(process.argv.slice(2));
  const acct = aws(["sts", "get-caller-identity", "--query", "Account"]);
  if (acct !== ACCOUNT) throw new Error(`refusing: account ${acct} is not the DEV account`);
  const dir = join(__dirname, "../../.dev/aws");
  mkdirSync(dir, { recursive: true });
  const logFile = join(dir, `ip-watch-${new Date().toISOString().replace(/[:.]/g, "-")}.log`);
  const say = (m) => { const l = `[${new Date().toISOString()}] ${m}`; console.log(l); appendFileSync(logFile, l + "\n"); };

  const allow = new Set(o.allow);
  const reported = new Set();
  const until = Date.now() + o.hours * 3600 * 1000;
  // Start 24 h back so an unknown IP that already called today is reported at the first pass, not missed.
  let since = Date.now() - 24 * 3600 * 1000;
  say(`watching ${LOG_GROUP} for ${o.hours} h, every ${o.interval}s; allowed: ${[...allow].join(", ")}; email=${o.email} toast=${o.toast}${o.dry ? " DRY-RUN" : ""}; log ${logFile}`);

  while (Date.now() < until) {
    try {
      const lines = readLines(since);
      for (const l of lines) since = Math.max(since, l._ts + 1);
      const found = newUnknownIps(lines, allow, reported);
      for (const s of found) {
        reported.add(s.ip);
        const text = describe(s);
        say(`ALERT unknown IP ${s.ip}\n${text}`);
        if (o.dry) continue;
        if (o.email) {
          try { aws(["sns", "publish", "--topic-arn", TOPIC, "--subject", `[Gymini DEV] IP la ${s.ip} truy cap API`, "--message", text]); say("  e-mail sent via SNS"); }
          catch (e) { say(`  e-mail FAILED: ${String(e.message).split("\n")[0]}`); }
        }
        if (o.toast) toast("Gymini DEV: IP la truy cap API", `${s.ip} - ${s.count} request`);
      }
    } catch (e) {
      say(`check failed (will retry): ${String(e.message).split("\n")[0]}`);
    }
    await new Promise((r) => setTimeout(r, o.interval * 1000));
  }
  say(`finished: ${reported.size} unknown IP(s) reported`);
}

if (require.main === module) {
  main().catch((e) => { console.error(`watch-api-ips: ${e.message}`); process.exit(1); });
}

module.exports = { newUnknownIps, describe };
