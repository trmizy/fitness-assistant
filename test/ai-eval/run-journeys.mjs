// Runs the persona journeys (journey-v1.json) through the REAL gateway and saves full transcripts for HUMAN review (no pass/fail: the
// judgement is the reviewer's). Accounts are cached (journey-users.mjs) so the auth rate limiter is not burnt.
// Usage (repo root, stack up): GATEWAY_URL=http://localhost:13000 node test/ai-eval/run-journeys.mjs [--persona newbie] [--file <journey.json>]
import fs from "node:fs";
import path from "node:path";
import { say } from "../ai-chat-full-verification/lib.mjs";
import { userFor } from "./journey-users.mjs";

const arg = (n) => { const i = process.argv.indexOf(`--${n}`); return i > 0 ? process.argv[i + 1] : undefined; };
const only = arg("persona");
const file = arg("file") ?? "test/ai-eval/journeys/journey-v1.json";
const spec = JSON.parse(fs.readFileSync(file, "utf8"));

const kinds = (r) => (r.raw?.data?.structuredBlocks ?? []).map((b) => b.kind).concat(r.raw?.data?.block?.type ? [r.raw.data.block.type] : []);
const out = { version: spec.version, at: new Date().toISOString(), evidence: "REAL HTTP/API", personas: {} };
for (const [key, p] of Object.entries(spec.personas)) {
  if (only && key !== only) continue;
  const u = await userFor(key, p.profile);
  let sessionId; const turns = [];
  console.log(`\n=== ${p.label} ===`);
  for (const t of p.turns) {
    const r = await say(u, t.say, sessionId);
    sessionId = r.sessionId ?? sessionId;
    turns.push({ say: t.say, ideal: t.ideal, status: r.status, ms: r.ms, answer: r.answer, blocks: kinds(r) });
    console.log(`\n> ${t.say}\n[${r.status} ${r.ms}ms blocks=${kinds(r).join(",") || "-"}]\n${String(r.answer).slice(0, 900)}`);
  }
  out.personas[key] = { label: p.label, turns };
}
const dest = path.join("test/ai-eval/results", `journey-${spec.version}-${Date.now().toString(36)}.json`);
fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.writeFileSync(dest, JSON.stringify(out, null, 2));
console.log(`\nSaved ${dest}`);
