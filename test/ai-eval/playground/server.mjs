// AI Coach playground (v2): a local page where YOU type a question as a chosen kind of user (newbie / knows-how / veteran), the REAL AI
// answers (gateway -> ai-service -> real model), and you rate the answer. Ratings go to data/eval/ai-system-eval/reviews/*.jsonl, which
// the engineer reads and fixes against. Nothing here is saved to the app except what the normal confirm button would save in the TEST DB.
// Usage (repo root, stack up): GATEWAY_URL=http://localhost:13000 node test/ai-eval/playground/server.mjs   -> http://127.0.0.1:17000
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import { say, confirmAction, dismissAction } from "../../ai-chat-full-verification/lib.mjs";
import { userFor } from "../journey-users.mjs";

const PORT = Number(process.env.PLAYGROUND_PORT || 17000);
const spec = JSON.parse(fs.readFileSync("test/ai-eval/journeys/journey-v1.json", "utf8"));
const REVIEWS_DIR = "data/eval/ai-system-eval/reviews";
fs.mkdirSync(REVIEWS_DIR, { recursive: true });
const reviewFile = () => path.join(REVIEWS_DIR, `reviews-${new Date().toISOString().slice(0, 10)}.jsonl`);
const users = {};
const userOf = async (persona) => {
  const p = spec.personas[persona];
  if (!p) throw new Error("unknown persona");
  return (users[persona] ??= await userFor(persona, p.profile));
};

const json = (res, code, body) => { res.writeHead(code, { "content-type": "application/json; charset=utf-8" }); res.end(JSON.stringify(body)); };
const readBody = (req) => new Promise((r) => { let d = ""; req.on("data", (c) => (d += c)); req.on("end", () => r(d ? JSON.parse(d) : {})); });

// What the reviewer needs to see of a structured block, without internals.
const brief = (b) => ({ kind: b.kind ?? b.type, actionId: b.actionId ?? null, title: b.title ?? b.summary?.title ?? null, note: b.note ?? null, detail: JSON.stringify(b).length > 60000 ? null : b });
const shape = (r) => {
  const d = r.raw?.data ?? {};
  const blocks = (d.structuredBlocks ?? []).map(brief);
  if (d.block) blocks.push(brief(d.block));
  return { status: r.status, ms: r.ms, sessionId: r.sessionId, answer: r.answer, blocks, error: r.status >= 400 ? JSON.stringify(r.raw).slice(0, 300) : null };
};

http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://x");
    if (req.method === "GET" && url.pathname === "/") { res.writeHead(200, { "content-type": "text/html; charset=utf-8" }); return res.end(fs.readFileSync("test/ai-eval/playground/index.html")); }
    if (req.method === "GET" && url.pathname === "/api/personas")
      return json(res, 200, Object.entries(spec.personas).map(([key, p]) => ({ key, label: p.label, profile: p.profile, scenario: p.turns.map((t) => ({ say: t.say, ideal: t.ideal })) })));
    if (req.method === "GET" && url.pathname === "/api/reviews") {
      const f = reviewFile();
      return json(res, 200, fs.existsSync(f) ? fs.readFileSync(f, "utf8").trim().split("\n").filter(Boolean).map((l) => JSON.parse(l)) : []);
    }
    if (req.method === "POST" && url.pathname === "/api/ask") {
      const b = await readBody(req);
      const u = await userOf(b.persona);
      return json(res, 200, shape(await say(u, String(b.question ?? ""), b.sessionId || undefined)));
    }
    if (req.method === "POST" && url.pathname === "/api/action") {
      const b = await readBody(req);
      const u = await userOf(b.persona);
      const r = b.op === "dismiss" ? await dismissAction(u, b.actionId) : await confirmAction(u, b.actionId);
      const blk = r.json?.data?.block;
      return json(res, 200, { status: r.status, message: blk?.message ?? r.json?.error?.message ?? JSON.stringify(r.json).slice(0, 300), steps: blk?.steps ?? [] });
    }
    if (req.method === "POST" && url.pathname === "/api/rate") {
      const b = await readBody(req);
      const row = { at: new Date().toISOString(), persona: b.persona, mode: b.mode, question: b.question, answer: b.answer, blocks: b.blocks, verdict: b.verdict, note: b.note ?? "", shouldBe: b.shouldBe ?? "", ideal: b.ideal ?? "" };
      fs.appendFileSync(reviewFile(), JSON.stringify(row) + "\n");
      return json(res, 200, { saved: true, file: reviewFile() });
    }
    json(res, 404, { error: "not found" });
  } catch (e) { json(res, 500, { error: String(e?.message ?? e) }); }
}).listen(PORT, "127.0.0.1", () => console.log(`AI Coach playground: http://127.0.0.1:${PORT}   (gateway ${process.env.GATEWAY_URL || "http://localhost:3000"})`));
