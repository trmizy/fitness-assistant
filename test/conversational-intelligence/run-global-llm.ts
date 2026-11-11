// Measures the typed LLM routing fallback on the turns the deterministic router leaves UNKNOWN (held-out set 2). Needs the tunnel on :11435.
import fs from "node:fs";
process.env.LLM_PROVIDER = process.env.LLM_PROVIDER ?? "ollama";
process.env.LLM_BASE_URL = process.env.LLM_BASE_URL ?? "http://127.0.0.1:11435";
process.env.OLLAMA_BASE_URL = process.env.LLM_BASE_URL;
process.env.LLM_MODEL = process.env.LLM_MODEL ?? "qwen3:30b-a3b-instruct-2507-q4_K_M";
process.env.CYCLE_ANALYSIS_LLM_TIMEOUT_MS = "60000";
async function main() {
  const { classifyGlobal } = await import("../../backend/services/ai-service/src/conversational-intelligence/global/router");
  const { llmRoute } = await import("../../backend/services/ai-service/src/conversational-intelligence/global/llm-route");
  const cases = JSON.parse(fs.readFileSync("test/conversational-intelligence/global-holdout2.json", "utf8"));
  const unknown = cases.filter((c: any) => classifyGlobal(c.text, { active: c.ctx.active ?? null, proposal: c.ctx.proposal }).route === "UNKNOWN");
  let ok = 0, wrongUnsafe = 0, none = 0; const lat: number[] = []; const rows: string[] = [];
  for (const c of unknown) {
    const t0 = Date.now(); const r = await llmRoute(c.text, { active: c.ctx.active ?? null, proposal: c.ctx.proposal }, "eval").catch(() => null); lat.push(Date.now() - t0);
    const expectedLlmRoute = ["READ_STATE", "RECOMMEND", "KNOWLEDGE_QA"].includes(c.exp.route) ? c.exp.route : "OTHER";
    const good = r ? (r.route === expectedLlmRoute && (!c.exp.topic || r.topic === c.exp.topic)) : expectedLlmRoute === "OTHER";
    if (!r) none += 1;
    if (good) ok += 1;
    rows.push(`${good ? "OK " : "BAD"} ${c.text} → ${r ? r.route + (r.topic ? "(" + r.topic + ")" : "") : "no-route(pass-through)"}  [expected ${c.exp.route}${c.exp.topic ? "(" + c.exp.topic + ")" : ""}]`);
    // an LLM route can never start a workflow or write: any route it returns is READ/RECOMMEND/QA by construction
    if (r && !["READ_STATE", "RECOMMEND", "KNOWLEDGE_QA"].includes(r.route)) wrongUnsafe += 1;
  }
  lat.sort((a, b) => a - b);
  const out = { model: process.env.LLM_MODEL, unknownTurns: unknown.length, correctOrSafePassThrough: `${ok}/${unknown.length}`, noRoute: none, unsafeRoutes: wrongUnsafe, latencyMs: { p50: lat[Math.floor(lat.length / 2)], max: lat[lat.length - 1], min: lat[0] }, rows };
  fs.writeFileSync("test/conversational-intelligence/results/global-llm-fallback.json", JSON.stringify(out, null, 2));
  console.log(JSON.stringify({ ...out, rows: undefined }, null, 2)); for (const r of rows) console.log("  " + r);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
