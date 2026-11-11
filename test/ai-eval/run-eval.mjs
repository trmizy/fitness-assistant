// Runs an evaluation set (data/eval/ai-system-eval) through the REAL gateway and scores it (score.mjs). REAL HTTP/API for routing/business/
// safety; sideEffect axis reads the isolated test DB. Heldout sets are sealed: need EVAL_OPEN_HELDOUT="<reason>" and are access-logged.
// Usage (repo root): GATEWAY_URL=http://localhost:13000 node test/ai-eval/run-eval.mjs --set data/eval/ai-system-eval/dev/dev-v1.json [--group health]
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";
import { registerUser, login, putProfile, say, confirmAction, q } from "../ai-chat-full-verification/lib.mjs";
import { scoreTurn, summarize } from "./score.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const setPath = arg("set");
if (!setPath) throw new Error("--set <file> required");
const only = arg("group");
const abs = path.resolve(setPath);
const sealed = abs.split(path.sep).includes("heldout");
if (sealed) {
  const reason = process.env.EVAL_OPEN_HELDOUT;
  if (!reason) throw new Error("heldout set is SEALED: set EVAL_OPEN_HELDOUT=\"<reason>\" (one scored run per release candidate; never to hunt for fixes)");
  const log = path.join(path.dirname(abs), "ACCESS_LOG.jsonl");
  fs.appendFileSync(log, JSON.stringify({ at: new Date().toISOString(), file: path.basename(abs), sha256: crypto.createHash("sha256").update(fs.readFileSync(abs)).digest("hex"), reason }) + "\n");
}
const items = JSON.parse(fs.readFileSync(abs, "utf8")).filter((i) => !only || i.group === only);

// Users: one client (profile set) + optional PT from an existing probe-pt-copilot stamp. Cached so the auth rate limiter is not burnt.
const stamp = process.env.EVAL_STAMP || "v1";
const clientUser = async () => {
  const email = `eval.client.${stamp}@gymini-test.local`;
  let u;
  try { u = await login(email); if (!u.token) throw 0; } catch { u = await registerUser(email, "Eval Client"); }
  if (!u.token) u = await registerUser(email, "Eval Client");
  const p = await putProfile(u, { age: 30, gender: "MALE", heightCm: 175, goal: "WEIGHT_LOSS", activityLevel: "LIGHTLY_ACTIVE", experienceLevel: "BEGINNER", currentWeight: 80, targetWeight: 72, hasCompletedOnboarding: true });
  if (p.status !== 200) throw new Error("profile " + p.status);
  return u;
};
const ptUser = async () => {
  const s = process.env.PROBE_STAMP;
  if (!s) return null;
  const c = JSON.parse(fs.readFileSync(path.resolve(".tmp-stack", `pt-probe-${s}.json`), "utf8"));
  return login(c.pt.email);
};
const users = { client: null, pt: undefined };

const results = [];
for (const item of items) {
  const persona = item.persona ?? "client";
  users[persona] ??= persona === "pt" ? await ptUser() : await clientUser();
  const u = users[persona];
  if (!u) { results.push({ id: item.id, group: item.group, pass: false, skipped: "no PT fixture (set PROBE_STAMP)", turns: [] }); continue; }
  let sessionId; const turns = [];
  for (const t of item.turns) {
    const reply = await say(u, t.say, sessionId);
    sessionId = reply.sessionId ?? sessionId;
    let value;
    if (t.confirm) {
      const id = (reply.raw?.data?.structuredBlocks ?? []).find((b) => b.actionId)?.actionId;
      if (id) await confirmAction(u, id);
    }
    if (t.sideEffect) { try { value = q(t.sideEffect.db, t.sideEffect.query.replaceAll("$USER", u.userId)); } catch (e) { value = `ERR ${e.message.slice(0, 60)}`; } }
    const axes = scoreTurn(t, reply, value);
    turns.push({ say: t.say, answer: String(reply.answer).slice(0, 300), status: reply.status, ms: reply.ms, axes });
  }
  const pass = turns.every((t) => Object.values(t.axes).every((a) => a.pass));
  results.push({ id: item.id, group: item.group, author: item.author, pass, turns });
  console.log(`${pass ? "PASS" : "FAIL"}  ${item.id}${pass ? "" : "  — " + turns.flatMap((t) => Object.entries(t.axes).filter(([, a]) => !a.pass).map(([k, a]) => `${k}: ${a.why}`)).join(" | ")}`);
}
const scored = results.filter((r) => !r.skipped);
const summary = summarize(scored);
console.log("\ngroup".padEnd(14) + "items  pass  routingErr reasoningErr  axes");
for (const [g, s] of Object.entries(summary)) console.log(g.padEnd(13) + `${String(s.items).padStart(5)} ${String(s.itemsPassed).padStart(5)} ${String(s.routingErrors).padStart(10)} ${String(s.reasoningErrors).padStart(12)}  ` + Object.entries(s.axes).map(([a, v]) => `${a} ${v.pass}/${v.n}`).join(", "));
const skipped = results.length - scored.length;
const out = path.join("test/ai-eval/results", `${path.basename(setPath, ".json")}-${Date.now().toString(36)}.json`);
fs.mkdirSync(path.dirname(out), { recursive: true });
fs.writeFileSync(out, JSON.stringify({ at: new Date().toISOString(), set: setPath, sealed, evidence: "REAL HTTP/API", skipped, summary, results }, null, 2));
console.log(`\n${scored.filter((r) => r.pass).length}/${scored.length} items passed${skipped ? `, ${skipped} skipped` : ""} → ${out}`);
