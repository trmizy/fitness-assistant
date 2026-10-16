// Level C: concurrency, multi-process, failure and retry through the REAL HTTP stack.
// Usage: node test/ai-chat-full-verification/concurrency.mjs <suite...>   suites: race multiproc failure
import fs from "node:fs";
import { spawn, spawnSync } from "node:child_process";
import path from "node:path";
import { U, ok, info, setJourney, turn, fq, aiq, fqOne, actionRow, fillSlots, finish } from "./harness.mjs";
import { http, sleep, SECRET } from "./lib.mjs";

const cnt = (sql) => Number(fqOne(sql));
async function pendingWorkout(user) {
  let t = await turn("setup", user, "Tạo lịch tập cho tôi."); let s = t.sessionId;
  ({ t, s } = await fillSlots(user, s, t, ["3 buổi mỗi tuần", "60 phút mỗi buổi"], "WORKOUT_PLAN_PREVIEW"));
  return { sessionId: s, actionId: t.block("WORKOUT_PLAN_PREVIEW")?.actionId };
}
const confirmRaw = (u, id, base = "") => http("POST", `${base}/ai/agent/actions/${id}/confirm`, { token: u.token, body: { confirmed: true } });
const dismissRaw = (u, id, base = "") => http("POST", `${base}/ai/agent/actions/${id}/dismiss`, { token: u.token, body: {} });
const text = (r) => JSON.stringify(r.json?.data?.block ?? r.json?.data ?? r.json?.error ?? r.json).slice(0, 220);
const claimsSaved = (r) => /Đã lưu|đã lưu lịch/i.test(text(r)) && r.status === 200;
const claimsCancelled = (r) => /Đã bỏ qua|đã hủy|bỏ qua bản nháp|Không lưu gì/i.test(text(r)) && r.status === 200;

export async function race() {
  setJourney("confirm-vs-dismiss-race");
  const user = U.C; // any user with a complete profile
  const results = { confirmWins: 0, dismissWins: 0, contradictions: 0 };
  for (let round = 0; round < 8; round += 1) {
    const { actionId } = await pendingWorkout(user);
    if (!actionId) { ok(`round ${round}: pending action created`, false); continue; }
    const before = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`);
    const order = round % 2 === 0 ? [confirmRaw, dismissRaw] : [dismissRaw, confirmRaw];
    const [r1, r2] = await Promise.all([order[0](user, actionId), order[1](user, actionId)]);
    const conf = order[0] === confirmRaw ? r1 : r2, dis = order[0] === confirmRaw ? r2 : r1;
    const status = actionRow(actionId).split("|")[1];
    const programs = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) - before;
    const terminal = status === "COMPLETED" ? "confirm" : status === "CANCELLED" ? "dismiss" : status;
    results[terminal === "confirm" ? "confirmWins" : "dismissWins"] += 1;
    const contradiction = (terminal === "confirm" && (programs !== 1 || claimsCancelled(dis))) || (terminal === "dismiss" && (programs !== 0 || claimsSaved(conf)));
    if (contradiction) results.contradictions += 1;
    info(`round ${round} (${order[0] === confirmRaw ? "confirm first" : "dismiss first"}): status=${status} programs+${programs} confirm=[${conf.status}] ${text(conf).slice(0, 70)} | dismiss=[${dis.status}] ${text(dis).slice(0, 70)}`);
    ok(`round ${round}: exactly ONE terminal state, truthful loser, business write matches`, ["COMPLETED", "CANCELLED"].includes(status) && !contradiction, `${status} programs=${programs}`);
  }
  info("race summary: " + JSON.stringify(results));
  ok("no contradictory success across all rounds", results.contradictions === 0, JSON.stringify(results));
  // double confirm
  const { actionId } = await pendingWorkout(user);
  const before = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`);
  const rs = await Promise.all([confirmRaw(user, actionId), confirmRaw(user, actionId), confirmRaw(user, actionId)]);
  ok("3 concurrent confirms of one action create exactly one program", cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1, rs.map((r) => r.status).join(","));
  // late actions
  const d2 = await dismissRaw(user, actionId);
  info("dismiss after completed: " + d2.status + " " + text(d2));
  ok("dismiss after COMPLETED does not report a cancellation and keeps the saved state", !claimsCancelled(d2) && /COMPLETED/.test(actionRow(actionId)), text(d2));
  const c3 = await confirmRaw(user, actionId);
  ok("confirm after COMPLETED is idempotent", c3.status === 200 && cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1);
  const p2 = await pendingWorkout(user);
  await dismissRaw(user, p2.actionId);
  const c4 = await confirmRaw(user, p2.actionId);
  ok("confirm after CANCELLED is refused (no resurrection) and writes nothing", !claimsSaved(c4) && /CANCELLED/.test(actionRow(p2.actionId)), `${c4.status} ${text(c4)}`);
  const d3 = await dismissRaw(user, p2.actionId);
  ok("dismiss twice is safe", d3.status < 500, `${d3.status} ${text(d3)}`);
  // expired action
  const p3 = await pendingWorkout(user);
  aiq(`update fitness_agent_actions set expires_at = now() - interval '1 minute' where id='${p3.actionId}'`);
  const c5 = await confirmRaw(user, p3.actionId);
  ok("expired action cannot be confirmed", (c5.status >= 400 || !claimsSaved(c5)) && cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1, `${c5.status} ${text(c5)}`);
}

export async function multiproc() { // second ai-service process on the same DB/Redis; overlapping confirm/dismiss across processes
  setJourney("multi-process-race");
  const root = process.cwd();
  const aiPort = 3013;
  const env = { ...process.env, NODE_ENV: "development", PORT: String(aiPort), INTERNAL_SERVICE_SECRET: SECRET, JWT_SECRET: "test_jwt_secret_for_ai_chat_verification_only_32+chars",
    DATABASE_URL: "postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_ai_test?schema=public", REDIS_HOST: "localhost", REDIS_PORT: "56379",
    USER_SERVICE_URL: "http://localhost:3004", FITNESS_SERVICE_URL: "http://localhost:3002", QDRANT_HOST: "localhost", QDRANT_PORT: "6333",
    LLM_PROVIDER: "ollama", LLM_MODEL: "qwen3:30b-a3b-instruct-2507-q4_K_M", LLM_BASE_URL: "http://127.0.0.1:11435", OLLAMA_BASE_URL: "http://127.0.0.1:11435", EMBEDDING_PROVIDER: "ollama", EMBEDDING_MODEL: "nomic-embed-text" };
  const child = spawn(process.execPath, [path.join(root, "node_modules/tsx/dist/cli.mjs"), "src/server.ts"], { cwd: path.join(root, "backend/services/ai-service"), env, stdio: "ignore", detached: true, windowsHide: true });
  child.unref();
  try {
    let up = false; for (let i = 0; i < 40 && !up; i += 1) { try { up = (await fetch(`http://127.0.0.1:${aiPort}/health`)).ok; } catch { /* wait */ } if (!up) await sleep(2000); }
    ok("second ai-service process is up (same DB + Redis)", up);
    if (!up) return;
    // Direct calls with the gateway-verified identity headers (what the gateway forwards), one per process.
    const user = U.C;
    const direct = (port, path0, body) => http("POST", `http://127.0.0.1:${port}${path0}`, { body, headers: { "x-internal-token": SECRET, "x-user-id": user.userId, "x-user-role": "CUSTOMER" } });
    let contradictions = 0;
    for (let round = 0; round < 8; round += 1) {
      const { actionId } = await pendingWorkout(user);
      const before = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`);
      const aFirst = round % 2 === 0;
      const [x, y] = await Promise.all([
        direct(aFirst ? 3003 : 3013, `/ai/agent/actions/${actionId}/confirm`, { confirmed: true }),
        direct(aFirst ? 3013 : 3003, `/ai/agent/actions/${actionId}/dismiss`, {}),
      ]);
      const status = actionRow(actionId).split("|")[1];
      const programs = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) - before;
      const bad = (status === "COMPLETED" && (programs !== 1 || claimsCancelled(y))) || (status === "CANCELLED" && (programs !== 0 || claimsSaved(x))) || !["COMPLETED", "CANCELLED"].includes(status);
      if (bad) contradictions += 1;
      info(`round ${round}: confirm on ${aFirst ? "proc A" : "proc B"} / dismiss on ${aFirst ? "proc B" : "proc A"} -> ${status}, programs+${programs}, confirm=[${x.status}] dismiss=[${y.status}]`);
    }
    ok("8 cross-process confirm-vs-dismiss races: one winner each, truthful loser, no contradiction", contradictions === 0, `contradictions=${contradictions}`);
    const { actionId } = await pendingWorkout(user);
    const before = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`);
    await Promise.all([direct(3003, `/ai/agent/actions/${actionId}/confirm`, { confirmed: true }), direct(3013, `/ai/agent/actions/${actionId}/confirm`, { confirmed: true })]);
    ok("double confirm across two processes writes exactly one program", cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1);
  } finally { spawnSync("taskkill", ["/PID", String(child.pid), "/T", "/F"], { stdio: "ignore" }); }
}

export async function failure() { // downstream (fitness-service) down -> truthful failure, recoverable; restore -> idempotent retry
  setJourney("downstream-failure-retry");
  const user = U.C;
  const pids = fs.existsSync(".tmp-stack/pids.json") ? JSON.parse(fs.readFileSync(".tmp-stack/pids.json", "utf8")) : {};
  const { actionId } = await pendingWorkout(user);
  const before = cnt(`select count(*) from workout_programs where user_id='${user.userId}'`);
  const DOCKER = process.env.VERIFY_RUNTIME === "docker"; // Docker stack: stop/start the real fitness container
  if (DOCKER) spawnSync("docker", ["stop", "gymcoach-fitness-dev"], { stdio: "ignore" });
  else spawnSync("taskkill", ["/PID", String(pids.fitness), "/T", "/F"], { stdio: "ignore" });
  await sleep(2500);
  const c1 = await confirmRaw(user, actionId);
  info(`confirm while fitness-service is DOWN -> ${c1.status} ${text(c1)}`);
  const s1 = actionRow(actionId);
  ok("truthful failure: no success claim, no COMPLETED, no raw stack/URL/SQL in the message", !claimsSaved(c1) && !/COMPLETED/.test(s1) && !/localhost|ECONN|prisma|stack|at .*\.ts/i.test(text(c1)), `${c1.status} ${s1} ${text(c1)}`);
  ok("action stays recoverable (PENDING), nothing written", /PENDING/.test(s1), s1);
  if (DOCKER) { spawnSync("docker", ["start", "gymcoach-fitness-dev"], { stdio: "ignore" }); for (let i = 0; i < 40; i += 1) { try { const r = await fetch("http://127.0.0.1:3002/health"); if (r.ok) break; } catch {} await sleep(3000); } }
  else spawnSync(process.execPath, ["test/ai-chat-full-verification/stack.mjs", "up"], { stdio: "ignore" });
  await sleep(3000);
  const c2 = await confirmRaw(user, actionId);
  ok("after the service is restored the SAME action can be retried and saves", c2.status === 200 && cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1, `${c2.status} ${text(c2)} ${actionRow(actionId)}`);
  const c3 = await confirmRaw(user, actionId);
  ok("a further retry is idempotent (still exactly one program)", cnt(`select count(*) from workout_programs where user_id='${user.userId}'`) === before + 1);
}

const SUITES = { race, multiproc, failure };
if (process.argv[1].endsWith("concurrency.mjs")) {
  const which = process.argv.slice(2);
  for (const name of which) { const fn = SUITES[name]; if (!fn) continue; try { await fn(); } catch (e) { ok(`suite ${name} threw`, false, e?.message); } }
  finish(which);
}
