// Child-process probe for provider-gate.test.mjs: loads the REAL ai-service Bedrock client (bedrock.client.ts) with the env
// stack.mjs gives the ai-service (endpoint override → gate, FAKE credentials) and makes one chat + one embedding call.
// Run with tsx, cwd = backend/services/ai-service. Prints one JSON line. No real provider is reachable from here.
import path from "node:path";
import { pathToFileURL } from "node:url";

const mod = await import(pathToFileURL(path.resolve("src/services/bedrock.client.ts")).href);
const out = {};
try {
  const r = await mod.converseText({ userText: "probe", maxTokens: 50, timeoutMs: 5000 });
  out.chat = { ok: true, text: r.text, inputTokens: r.inputTokens };
} catch (e) { out.chat = { ok: false, name: e?.name, message: String(e?.message).slice(0, 160) }; }
try {
  const v = await mod.embedTextsWithCohere(["probe text"], "search_query", { timeoutMs: 5000 });
  out.embedding = { ok: true, vectors: v.length };
} catch (e) { out.embedding = { ok: false, name: e?.name, message: String(e?.message).slice(0, 160) }; }
console.log(JSON.stringify(out));
