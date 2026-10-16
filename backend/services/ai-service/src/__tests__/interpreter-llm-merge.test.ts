/**
 * V2.3A.7 phase 3 + phase 5, end-to-end through the real LLM-fallback path:
 * interpretWithLlm() must (a) send the semantic prompt to Bedrock with a
 * real system/user role split (Phase 1's fix, exercised via the actual
 * production call chain this time, not just llmService directly), and (b)
 * never let its own merge silently erase a deterministic grounding failure
 * the guard already flagged (Phase 5's integration fix — found live during
 * this task: the pre-existing merge unconditionally reset
 * clarificationRequired to false and floored confidence at 0.6, which
 * would have thrown away the guard's correction exactly in the UNKNOWN-
 * primaryIntent cases that trigger this fallback path in the first place).
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.LLM_PROVIDER = "bedrock";
process.env.EMBEDDING_PROVIDER = "bedrock";
process.env.BEDROCK_CHAT_MODEL = "apac.amazon.nova-pro-v1:0";
delete process.env.ANTHROPIC_API_KEY;

let sent: Array<{ command: any }> = [];
let responder: (command: any) => Promise<unknown> = async () => {
  throw new Error("no responder configured");
};
let bedrock: typeof import("../services/bedrock.client");
let interpreter: typeof import("../conversational-intelligence/interpreter");
let trap: http.Server;

function converseReply(json: unknown) {
  return {
    output: { message: { role: "assistant", content: [{ text: JSON.stringify(json) }] } },
    stopReason: "end_turn",
    usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
    $metadata: {},
  };
}

test.before(async () => {
  trap = http.createServer((_req, res) => res.writeHead(500).end());
  await new Promise<void>((resolve) => trap.listen(0, "127.0.0.1", resolve));
  const trapUrl = `http://127.0.0.1:${(trap.address() as AddressInfo).port}`;
  process.env.LLM_BASE_URL = trapUrl;
  process.env.OLLAMA_BASE_URL = trapUrl;

  bedrock = await import("../services/bedrock.client");
  interpreter = await import("../conversational-intelligence/interpreter");
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

test("the real semantic-interpretation call sends a structured system/user split to Bedrock", async () => {
  responder = async () => converseReply({ primaryIntent: "UNKNOWN", entities: [], goalSignals: [], asksRecommendation: false, isCorrection: false });
  await interpreter.interpretWithLlm("đổi sang PT đó đi", {}, "u1");

  assert.equal(sent.length, 1);
  const input: any = sent[0].command.input;
  assert.ok(input.system, "a system block must be present");
  assert.match(input.system[0].text, /bộ phân tích ngữ nghĩa/, "real instructions reach the system slot");
  assert.equal(input.messages[0].content[0].text.includes("bộ phân tích ngữ nghĩa"), false, "instructions must not leak into the user turn");
  assert.match(input.messages[0].content[0].text, /Tin nhắn: """đổi sang PT đó đi"""/);
});

test("a deterministic grounding failure survives the LLM-merge (clarificationRequired stays true, confidence stays low)", async () => {
  responder = async () => converseReply({ primaryIntent: "PROVIDE_INFORMATION", entities: [], goalSignals: [], asksRecommendation: false, isCorrection: false });
  const merged = await interpreter.interpretWithLlm("đổi sang PT đó đi", {}, "u1");

  assert.ok(merged);
  assert.deepEqual(merged!.references, [], "the guard's correction (from the deterministic base) survives the merge");
  assert.equal(merged!.clarificationRequired, true, "must NOT be reset to false by the merge");
  assert.ok(merged!.confidence <= 0.35, "must NOT be floored up to 0.6 by the merge");
  assert.equal(merged!.source, "MERGED");
});

test("control: a message with NO grounding failure keeps the pre-existing merge behavior (clarificationRequired false, confidence floored to >=0.6)", async () => {
  responder = async () => converseReply({ primaryIntent: "PROVIDE_INFORMATION", entities: [], goalSignals: [], asksRecommendation: false, isCorrection: false });
  const merged = await interpreter.interpretWithLlm("một câu rất mơ hồ không rõ ý gì cả luôn à", {}, "u1");

  assert.ok(merged);
  assert.equal(merged!.clarificationRequired, false, "unrelated to references -- unchanged legacy behavior");
  assert.ok(merged!.confidence >= 0.6, "unrelated to references -- unchanged legacy floor");
});
