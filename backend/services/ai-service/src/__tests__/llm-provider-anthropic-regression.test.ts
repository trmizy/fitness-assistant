/**
 * Regression: LLM_PROVIDER=anthropic (direct Anthropic API) keeps working
 * exactly as before the Bedrock provider existed — same Messages API request,
 * same Claude token floor, and goal-image vision still goes to Anthropic, not
 * Bedrock. The Anthropic SDK is pointed at a local stub via ANTHROPIC_BASE_URL.
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import type { AddressInfo } from "node:net";

process.env.LLM_PROVIDER = "anthropic";
process.env.ANTHROPIC_API_KEY = "test-key-not-real";
delete process.env.EMBEDDING_PROVIDER;
delete process.env.LLM_MODEL;
delete process.env.GOAL_VISION_MODEL;

const messageRequests: any[] = [];
const anthropic = http.createServer((req, res) => {
  let raw = "";
  req.on("data", (chunk) => (raw += chunk));
  req.on("end", () => {
    const body = JSON.parse(raw || "{}");
    messageRequests.push(body);
    res.writeHead(200, { "Content-Type": "application/json" });
    const isTool = Array.isArray(body.tools) && body.tools.length > 0;
    res.end(
      JSON.stringify({
        id: "msg_1",
        type: "message",
        role: "assistant",
        model: body.model,
        content: isTool
          ? [
              {
                type: "tool_use",
                id: "tool_1",
                name: body.tools[0].name,
                input: { muscularity: "HIGH", relativeLeanness: "MODERATE", focusMuscles: ["BACK"], confidence: 0.6, usable: true },
              },
            ]
          : [{ type: "text", text: "anthropic answer" }],
        stop_reason: isTool ? "tool_use" : "end_turn",
        stop_sequence: null,
        usage: { input_tokens: 3, output_tokens: 2 },
      }),
    );
  });
});

let bedrockCalls = 0;

test.before(async () => {
  await new Promise<void>((resolve) => anthropic.listen(0, "127.0.0.1", resolve));
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(anthropic.address() as AddressInfo).port}`;
  const bedrock = await import("../services/bedrock.client");
  bedrock.bedrockRuntimeDeps.send = async () => {
    bedrockCalls += 1;
    throw new Error("Bedrock must not be called when LLM_PROVIDER=anthropic");
  };
});

test.after(async () => {
  await new Promise<void>((resolve) => anthropic.close(() => resolve()));
});

test("anthropic chat request is unchanged", async () => {
  const { llmService } = await import("../services/llm.service");
  const result = await llmService.callLLM("System rules\nCâu hỏi của user: hello", {
    responseFormat: "json",
    numPredict: 900,
  });
  assert.equal(result.answer, "anthropic answer");
  assert.equal(result.totalTokens, 5);
  const body = messageRequests.at(-1);
  assert.equal(body.model, "claude-sonnet-5");
  assert.equal(body.max_tokens, 2048);
  assert.match(body.system, /Respond with valid JSON only/);
  assert.equal(body.messages[0].content.startsWith("Câu hỏi của user:"), true);
});

test("anthropic goal-image vision still uses the Anthropic API", async () => {
  const { analyzeGoalImage } = await import("../services/fitness-goal-vision.service");
  const png = Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), Buffer.from("png-bytes")]).toString("base64");
  const result = await analyzeGoalImage({ mediaType: "image/png", base64: png });
  assert.equal(result.muscularity, "HIGH");
  const body = messageRequests.at(-1);
  assert.equal(body.tool_choice.name, "describe_goal_attributes");
  assert.equal(body.messages[0].content[0].type, "image");
});

test("Bedrock was never called", () => {
  assert.equal(bedrockCalls, 0);
});
