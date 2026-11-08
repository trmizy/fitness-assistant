// Restarts ONE service of the isolated verification stack (test/ai-chat-full-verification/stack.mjs, LOCAL_BEDROCK=1) so a
// measurement runs on the current source; the others keep running. Default: ai. Usage: node <this> [ai|fitness|user|auth|gateway]
import fs from "node:fs";
import path from "node:path";
import { spawnSync } from "node:child_process";

const name = process.argv[2] || "ai";
const port = { gateway: 13000, auth: 13001, fitness: 13002, ai: 13003, user: 13004 }[name];
if (!port) throw new Error(`unknown service ${name}`);
const pidFile = path.join(process.cwd(), ".tmp-stack", "pids.json");
const pids = JSON.parse(fs.readFileSync(pidFile, "utf8"));
if (pids[name]) { spawnSync("taskkill", ["/PID", String(pids[name]), "/T", "/F"], { stdio: "ignore" }); console.log(`${name}: stopped ${pids[name]}`); }
for (let i = 0; i < 30; i++) { try { await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(1000) }); await new Promise((r) => setTimeout(r, 1000)); } catch { break; } }
const up = spawnSync(process.execPath, ["test/ai-chat-full-verification/stack.mjs", "up"], { env: { ...process.env, LOCAL_BEDROCK: "1" }, encoding: "utf8" });
console.log(up.stdout.split("\n").filter((l) => l.startsWith(`${name}:`)).join("\n"));
process.exit(new RegExp(`${name}: HEALTHY`).test(up.stdout) ? 0 : 1);
