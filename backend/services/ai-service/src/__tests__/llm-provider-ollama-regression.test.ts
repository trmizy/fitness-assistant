/**
 * Regression: adding the Bedrock provider must not change the local
 * development path. LLM_PROVIDER=ollama with EMBEDDING_PROVIDER unset keeps
 * using Ollama /api/chat and /api/embeddings at LLM_BASE_URL, 768-dim vectors,
 * and never touches Bedrock.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.LLM_PROVIDER = "ollama";
delete process.env.EMBEDDING_PROVIDER;
delete process.env.KNOWLEDGE_VECTOR_SIZE;
delete process.env.LLM_MODEL;
delete process.env.EMBEDDING_MODEL;

const requests: Array<{ path: string; body: any }> = [];
const ollama = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = raw ? JSON.parse(raw) : undefined;
    requests.push({ path: req.url ?? "", body });
    res.writeHead(200, { "Content-Type": "application/json" });
    if (req.url === "/api/chat") {
      res.end(JSON.stringify({ message: { content: "ollama answer" }, prompt_eval_count: 5, eval_count: 3 }));
    } else if (req.url === "/api/embeddings") {
      res.end(JSON.stringify({ embedding: new Array(768).fill(0.1) }));
    } else if (req.url === "/api/tags") {
      res.end(JSON.stringify({ models: [{ name: "llama3.2:3b" }, { name: "nomic-embed-text:latest" }] }));
    } else {
      res.end("{}");
    }
  });
});

let llm: typeof import("../services/llm.service");
let bedrockCalls = 0;

test.before(async () => {
  await new Promise<void>((resolve) => ollama.listen(0, "127.0.0.1", resolve));
  process.env.LLM_BASE_URL = `http://127.0.0.1:${(ollama.address() as AddressInfo).port}`;
  const bedrock = await import("../services/bedrock.client");
  bedrock.bedrockRuntimeDeps.send = async () => {
    bedrockCalls += 1;
    throw new Error("Bedrock must not be called when LLM_PROVIDER=ollama");
  };
  llm = await import("../services/llm.service");
});

test.after(async () => {
  await new Promise<void>((resolve) => ollama.close(() => resolve()));
});

test("ollama chat payload is unchanged (model, split messages, num_predict as given, JSON format, temperature)", async () => {
  requests.length = 0;
  const result = await llm.llmService.callLLM("Rules here\nCâu hỏi của user: hi", {
    responseFormat: "json",
    numPredict: 900,
    temperature: 0.2,
  });
  assert.equal(result.answer, "ollama answer");
  assert.equal(result.totalTokens, 8);
  const chat = requests.find((r) => r.path === "/api/chat");
  assert.ok(chat);
  assert.equal(chat.body.model, "llama3.2:3b");
  assert.equal(chat.body.format, "json");
  assert.equal(chat.body.options.num_predict, 900, "no Claude floor applied to Ollama");
  assert.equal(chat.body.options.temperature, 0.2);
  assert.deepEqual(chat.body.messages.map((m: any) => m.role), ["system", "user"]);
});

test("ollama embeddings stay 768-dim nomic-embed-text; inputType is ignored", async () => {
  requests.length = 0;
  const vector = await llm.llmService.generateEmbedding("query", { inputType: "search_query" });
  assert.equal(vector.length, 768);
  const embed = requests.find((r) => r.path === "/api/embeddings");
  assert.deepEqual(embed?.body, { model: "nomic-embed-text", prompt: "query" });
});

test("ollama health still requires both local models", async () => {
  const health = await llm.llmService.getHealthStatus();
  assert.equal(health.llmProvider, "ollama");
  assert.equal(health.llmAvailable, true);
});

test("Bedrock was never called", () => {
  assert.equal(bedrockCalls, 0);
});
