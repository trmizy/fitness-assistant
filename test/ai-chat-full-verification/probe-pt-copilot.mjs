// REAL HTTP/API verification of the PT Copilot roster adherence overview (Phase 4, step 1), through the real gateway -> ai-service ->
// fitness-service -> user-service chain on the ISOLATED test DBs. Real accounts (registered through the API) and the real chat entry.
// TEST FIXTURE (labelled): the ACTIVE contracts and the workout-schedule rows are inserted by two small seed scripts; the contract purchase
// flow itself is not under test. Everything after that (token, roster lookup, aggregation, authorization, answer) is the real path.
// Usage (repo root): GATEWAY_URL=http://localhost:13000 node test/ai-chat-full-verification/probe-pt-copilot.mjs
import fs from "node:fs";
import { execFileSync } from "node:child_process";
import path from "node:path";
import { registerUser, putProfile, say } from "./lib.mjs";

const PG = "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433";
const root = process.cwd();
const tsx = path.join(root, "backend/services/ai-service/node_modules/tsx/dist/cli.mjs");
const run = (service, dbName, script, args) => execFileSync(process.execPath, [tsx, path.join(root, "test/ai-chat-full-verification/fixtures-pt-roster", script), ...args], {
  cwd: path.join(root, "backend/services", service), env: { ...process.env, NODE_ENV: "test", DATABASE_URL: `${PG}/${dbName}`, LOG_LEVEL: "silent" }, encoding: "utf8" }).trim();

const stamp = process.env.PROBE_STAMP || Date.now().toString(36);
const profile = { age: 30, gender: "MALE", heightCm: 175, goal: "MAINTENANCE", activityLevel: "MODERATELY_ACTIVE", experienceLevel: "BEGINNER", currentWeight: 78, targetWeight: 76, hasCompletedOnboarding: true };
// tokens (3h) are cached per stamp so a re-run costs no auth requests (the gateway's /auth limiter is 20 / 15 min and must not be weakened)
const cacheFile = path.join(root, ".tmp-stack", `pt-probe-${stamp}.json`);
const cache = fs.existsSync(cacheFile) ? JSON.parse(fs.readFileSync(cacheFile, "utf8")) : {};
const mk = async (tag, name) => {
  if (cache[tag]) return cache[tag];
  const u = await registerUser(`probe.pt.${tag}.${stamp}@gymini-test.local`, name); await putProfile(u, profile);
  cache[tag] = u; fs.writeFileSync(cacheFile, JSON.stringify(cache)); return u;
};
const pt = await mk("pt", "Probe PT");
const otherPt = await mk("pt2", "Probe PT Two");
const risk = await mk("risk", "Client Chậm Tiến Độ");
const good = await mk("good", "Client Tập Đều");
const empty = await mk("empty", "Client Chưa Có Lịch");
const outsider = await mk("out", "Người Ngoài Roster");

if (!process.env.PROBE_SKIP_SEED) console.log("FIXTURE:", run("user-service", "gymcoach_user_test", "seed-user-contracts.ts", [pt.userId, risk.userId, good.userId, empty.userId]));
if (!process.env.PROBE_SKIP_SEED) console.log("FIXTURE:", run("fitness-service", "gymcoach_fitness_test", "seed-fitness-schedules.ts", [
  `${risk.userId}:COMPLETED,SKIPPED,SKIPPED,SKIPPED,NOT_STARTED`,
  `${good.userId}:COMPLETED,COMPLETED,COMPLETED,COMPLETED,COMPLETED`,
  `${outsider.userId}:SKIPPED,SKIPPED,SKIPPED,SKIPPED`, // not on any roster: must never show up
]));

const answerOf = async (u, q) => { const r = await say(u, q); return { status: r.status, ms: r.ms, answer: String(r.answer), blocks: r.raw?.data?.structuredBlocks ?? r.raw?.structuredBlocks ?? [] }; };
const results = [];
const check = (name, cond, detail = "") => { results.push({ name, pass: !!cond, detail }); console.log(`${cond ? "PASS" : "FAIL"}  ${name}${detail ? "  — " + String(detail).slice(0, 220) : ""}`); };

const q = "Client nào đang chậm tiến độ?";
const a = await answerOf(pt, q);
console.log("\n--- PT answer ---\n" + a.answer + "\n-----------------");
check("1. the PT's own roster is summarised (3 clients)", /Tổng hợp 3 client/.test(a.answer), a.answer.split("\n")[0]);
check("2. the slipping client is named and flagged with its evidence (1/5 sessions)", a.answer.includes(risk.email) && /1\/5 buổi/.test(a.answer));
check("3. the client with no scheduled sessions is 'not judged', never given a verdict", /Chưa đủ dữ liệu để nhận định/.test(a.answer) && a.answer.includes(empty.email));
check("4. the client who trains consistently is only counted as fine (not listed as a concern)", /1 client còn lại đang ổn/.test(a.answer) && !/Client Tập Đều\*\* \(/.test(a.answer));
check("5. someone outside the roster never appears (name, id)", !a.answer.includes(outsider.email) && !a.answer.includes(outsider.userId));
check("6. read-only: no action card/blocks, and the reply says nothing was sent or changed", (a.blocks ?? []).length === 0 && /chưa nhắn tin hay thay đổi gì/.test(a.answer));

const b = await answerOf(otherPt, q);
check("7. another PT with no active clients gets an honest empty answer — and none of the first PT's data", /không thấy client nào đang có hợp đồng còn hiệu lực/.test(b.answer) && !b.answer.includes(risk.email) && !b.answer.includes(good.email), b.answer.slice(0, 100));

const c = await answerOf(risk, q);
check("8. a CLIENT asking the same question gets no roster and no other client's data", !c.answer.includes(good.email) && !c.answer.includes(empty.email), c.answer.slice(0, 100));

const d = await answerOf(pt, "Protein giúp gì cho cơ bắp?");
check("9. an ordinary question from the same PT is NOT taken over by the roster handler", !/Tổng hợp \d+ client/.test(d.answer));

fs.writeFileSync("test/ai-chat-full-verification/results/probe-pt-copilot.json", JSON.stringify({ at: new Date().toISOString(), ptAnswer: a.answer, results }, null, 2));
const failed = results.filter((r) => !r.pass);
console.log(`\n${results.length - failed.length}/${results.length} passed`);
process.exit(failed.length ? 1 : 0);
