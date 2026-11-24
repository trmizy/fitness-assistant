#!/usr/bin/env node
/**
 * Cost report for the DEV account, printed at the end of dev-stop.ps1.
 *
 *   node scripts/aws/lib/cost-report.cjs [--top 6]
 *
 * ONE Cost Explorer call per run (AWS bills ~0.01 USD per ce:GetCostAndUsage request): month-to-date and the last 3 days, DAILY
 * granularity, grouped by SERVICE. It prints: month-to-date total (usage + tax), the last 3 full/partial days, and the top services.
 *
 * Honest limits, also printed: Cost Explorer lags about a day, so the newest day is partial and a DEV session that just ended is NOT in
 * the numbers yet; the per-session cost can only be estimated afterwards from the daily totals. Never blocks a shutdown: any failure is a
 * one-line message and exit 0 (use --strict to exit 1 instead). Refuses any account other than the DEV account.
 */
"use strict";
const { execFileSync } = require("node:child_process");

const ACCOUNT = "191798898985";

/** Pure: fold Cost Explorer ResultsByTime (DAILY, grouped by SERVICE) into totals. */
function summarize(resultsByTime) {
  const byDay = new Map();
  const byService = new Map();
  for (const r of resultsByTime || []) {
    const day = r.TimePeriod.Start;
    for (const g of r.Groups || []) {
      const amount = Number(g.Metrics.UnblendedCost.Amount) || 0;
      byDay.set(day, (byDay.get(day) || 0) + amount);
      const name = g.Keys[0];
      byService.set(name, (byService.get(name) || 0) + amount);
    }
  }
  const days = [...byDay.entries()].sort(([a], [b]) => a.localeCompare(b));
  const services = [...byService.entries()].sort(([, a], [, b]) => b - a);
  const total = days.reduce((s, [, v]) => s + v, 0);
  return { days, services, total };
}

const usd = (n) => n.toFixed(2).padStart(7);

function render(monthToDate, recent, top) {
  const out = [];
  out.push(`   Month-to-date (usage + tax): ${monthToDate.total.toFixed(2)} USD`);
  out.push("   Last days (USD):  " + recent.days.map(([d, v]) => `${d.slice(5)}=${v.toFixed(2)}`).join("  "));
  out.push(`   Top services this month:`);
  for (const [name, v] of monthToDate.services.slice(0, top)) out.push(`     ${name.slice(0, 44).padEnd(44)} ${usd(v)}`);
  out.push("   Note: Cost Explorer lags ~1 day; the newest day is partial and this DEV session is not included yet.");
  return out.join("\n");
}

function ce(start, end) {
  const out = execFileSync("aws", [
    "ce", "get-cost-and-usage", "--region", "us-east-1", "--time-period", `Start=${start},End=${end}`, "--granularity", "DAILY",
    "--metrics", "UnblendedCost", "--group-by", "Type=DIMENSION,Key=SERVICE", "--output", "json",
  ], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], maxBuffer: 16 * 1024 * 1024 });
  return JSON.parse(out).ResultsByTime;
}

const iso = (d) => d.toISOString().slice(0, 10);

function main(argv) {
  const strict = argv.includes("--strict");
  const topIdx = argv.indexOf("--top");
  const top = topIdx >= 0 ? Math.max(1, Number(argv[topIdx + 1]) || 6) : 6;
  try {
    const acct = JSON.parse(execFileSync("aws", ["sts", "get-caller-identity", "--query", "Account", "--output", "json"], { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }));
    if (acct !== ACCOUNT) {
      console.error(`   cost report skipped: account ${acct} is not the DEV account`);
      return strict ? 2 : 0;
    }
    const now = new Date();
    const monthStart = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    const tomorrow = new Date(now.getTime() + 24 * 3600 * 1000);
    // One call covering the month so far (or the last 3 days if the month just started and has fewer days).
    const from = new Date(Math.min(monthStart.getTime(), now.getTime() - 3 * 24 * 3600 * 1000));
    const results = ce(iso(from), iso(tomorrow));
    const monthResults = results.filter((r) => r.TimePeriod.Start >= iso(monthStart));
    const month = summarize(monthResults);
    const recent = { days: summarize(results).days.slice(-3) };
    console.log(render(month, recent, top));
    return 0;
  } catch (err) {
    console.error(`   cost report unavailable: ${err && err.message ? String(err.message).split("\n")[0] : err}`);
    return strict ? 1 : 0;
  }
}

if (require.main === module) process.exit(main(process.argv.slice(2)));

module.exports = { summarize, render };
