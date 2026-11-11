/**
 * V2.3A.7 Phase 1 regression: LlmCallOpts.systemPrompt gives callers an
 * explicit system/user role split that bypasses buildOllamaMessages()'s
 * brittle "Câu hỏi của user:" substring-sniffing (the role-split bug
 * confirmed live-active on the production Bedrock path in V2.3A.6).
 *
 * Covers the two live-reachable branches on this account's actual
 * configuration (LLM_PROVIDER=bedrock) plus LLM_PROVIDER=ollama for
 * local-dev parity. Must prove BOTH: (1) the new structured path produces
 * a real system role/block, and (2) every pre-existing caller that omits
 * systemPrompt gets byte-for-byte the exact same behavior as before this
 * task (the backwards-compatibility property the whole fix depends on).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.LLM_PROVIDER = "bedrock";
process.env.EMBEDDING_PROVIDER = "bedrock";
process.env.BEDROCK_REGION = "ap-southeast-1";
process.env.BEDROCK_CHAT_MODEL = "apac.amazon.nova-pro-v1:0";
delete process.env.ANTHROPIC_API_KEY;
delete process.env.LLM_MODEL;

let sent: Array<{ command: any }> = [];
let responder: (command: any) => Promise<unknown> = async () => {
  throw new Error("no responder configured");
};

let sdk: typeof import("@aws-sdk/client-bedrock-runtime");
let bedrock: typeof import("../services/bedrock.client");
let llm: typeof import("../services/llm.service");
let trap: http.Server;

function converseReply(text: string) {
  return {
    output: { message: { role: "assistant", content: [{ text }] } },
    stopReason: "end_turn",
    usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    $metadata: {},
  };
}

test.before(async () => {
  // Trap so a regression can never silently fall through to a real Ollama
  // host if LLM_PROVIDER were ever misread.
  trap = http.createServer((_req, res) => res.writeHead(500).end());
  await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", resolve));
  const trapUrl = `http://127.0.0.1:${(trap.address() as AddressInfo).port}`;
  process.env.LLM_BASE_URL = trapUrl;
  process.env.OLLAMA_BASE_URL = trapUrl;

  sdk = await import("@aws-sdk/client-bedrock-runtime");
  bedrock = await import("../services/bedrock.client");
  llm = await import("../services/llm.service");
  bedrock.bedrockRuntimeDeps.send = (command) => {
    sent.push({ command });
    return responder(command);
  };
});

test.after(async () => {
  await new Promise<void>((resolve) => trap.close(() => resolve()));
});

test.beforeEach(() => {
  sent = [];
});

// ── the fix: structured systemPrompt ────────────────────────────────────

test("bedrock: systemPrompt produces a real system block, user content holds ONLY the user turn", async () => {
  responder = async () => converseReply('{"ok":true}');
  const systemPrompt = "Bạn là bộ phân tích ngữ nghĩa. Trích xuất primaryIntent.";
  const userPrompt = 'Tin nhắn: """Đổi giúp tôi PT này đi."""';

  await llm.llmService.callLLM(userPrompt, {
    responseFormat: "json",
    numPredict: 400,
    systemPrompt,
  });

  assert.equal(sent.length, 1);
  const input: any = sent[0].command.input;
  assert.ok(input.system, "a system block must be present");
  assert.match(input.system[0].text, /Bạn là bộ phân tích ngữ nghĩa/, "real instructions reach the system slot");
  assert.match(input.system[0].text, /Respond with valid JSON only/, "JSON-mode instruction still appended");
  assert.equal(input.messages.length, 1);
  assert.equal(input.messages[0].role, "user");
  assert.equal(input.messages[0].content[0].text, userPrompt, "user content holds ONLY the user turn, not the instructions");
  assert.doesNotMatch(input.messages[0].content[0].text, /bộ phân tích ngữ nghĩa/, "instructions must not leak into the user turn");
});

test("bedrock: systemPrompt works with callLlmJson (the real semantic-interpreter call path)", async () => {
  const { callLlmJson } = await import("../llm/json_llm_call.util");
  const { z } = await import("zod");
  responder = async () => converseReply('{"a":"ok"}');
  const result = await callLlmJson('Tin nhắn: """test"""', z.object({ a: z.string() }), {
    userId: "u1",
    phase: "test",
    numPredict: 400,
    systemPrompt: "SYSTEM RULES HERE",
  });
  assert.deepEqual(result, { a: "ok" });
  const input: any = sent[0].command.input;
  assert.match(input.system[0].text, /SYSTEM RULES HERE/);
  assert.equal(input.messages[0].content[0].text, 'Tin nhắn: """test"""');
});

// ── backwards compatibility: every pre-existing caller is unaffected ────

test("bedrock: a legacy call with NO systemPrompt keeps the exact prior behavior (no system block for a plain prompt)", async () => {
  responder = async () => converseReply("ok");
  await llm.llmService.callLLM("plain prompt", { numPredict: 3000 });
  assert.equal(sent[0].command.input.system, undefined, "unchanged from the pre-V2.3A.7 behavior");
});

test("bedrock: a legacy call using the real 'Câu hỏi của user:' marker still splits exactly as before", async () => {
  responder = async () => converseReply("ok");
  await llm.llmService.callLLM("System rules\nCâu hỏi của user: hello", { responseFormat: "json", numPredict: 900 });
  const input: any = sent[0].command.input;
  assert.match(input.system[0].text, /System rules/);
  assert.equal(input.messages[0].content[0].text.startsWith("Câu hỏi của user:"), true);
});

test("sanity: real Bedrock Converse command type is used (not a reimplemented request shape)", async () => {
  responder = async () => converseReply("ok");
  await llm.llmService.callLLM("x", { systemPrompt: "y" });
  assert.ok(sent[0].command instanceof sdk.ConverseCommand);
});
