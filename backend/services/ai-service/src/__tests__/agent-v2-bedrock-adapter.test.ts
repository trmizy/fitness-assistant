/**
 * V2 — Bedrock Converse adapter (tool use) and Zod→JSON Schema. Offline: the transport is a fake function; AWS is never called.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { buildConverseInput, createBedrockConverseProvider, parseConverseResponse, classifyProviderError } from "../agent-v2/bedrock-converse-adapter";
import { AgentProviderError, type AgentMessage } from "../agent-v2/model-provider";
import { zodToJsonSchema } from "../agent-v2/zod-json-schema";
import { TRAINING_TOOL_CONTRACTS } from "../agent-v2/training-tools";

const tools = [{ name: "training__get_current_program", description: "Current program", inputSchema: { type: "object", properties: {}, additionalProperties: false } }];
const messages: AgentMessage[] = [
  { role: "user", content: [{ type: "text", text: "Lịch của tôi?" }] },
  { role: "assistant", content: [{ type: "text", text: "Để mình xem." }, { type: "toolUse", toolUseId: "tu_1", name: "training__get_current_program", input: {} }] },
  { role: "user", content: [{ type: "toolResult", toolUseId: "tu_1", status: "success", json: { tool: "training.get_current_program", untrustedData: true, data: null } }] },
];

test("request mapping: system, messages with toolUse/toolResult, toolConfig.tools[].toolSpec, inferenceConfig", () => {
  const input: any = buildConverseInput("apac.amazon.nova-pro-v1:0", { system: "SYS", messages, tools, maxOutputTokens: 800, temperature: 0.2 });
  assert.equal(input.modelId, "apac.amazon.nova-pro-v1:0");
  assert.deepEqual(input.system, [{ text: "SYS" }]);
  assert.deepEqual(input.messages[1].content[1], { toolUse: { toolUseId: "tu_1", name: "training__get_current_program", input: {} } });
  assert.deepEqual(input.messages[2].content[0], { toolResult: { toolUseId: "tu_1", status: "success", content: [{ json: { tool: "training.get_current_program", untrustedData: true, data: null } }] } });
  assert.deepEqual(input.toolConfig.tools[0], { toolSpec: { name: "training__get_current_program", description: "Current program", inputSchema: { json: tools[0].inputSchema } } });
  assert.deepEqual(input.inferenceConfig, { maxTokens: 800, temperature: 0.2 });
  const noTools: any = buildConverseInput("m", { system: "S", messages: [messages[0]], tools: [], maxOutputTokens: 10, temperature: 0 });
  assert.equal(noTools.toolConfig, undefined);
});

test("response parsing: several toolUse blocks, text, usage; unknown stop reason → unsupported; missing usage → null", () => {
  const r = parseConverseResponse({
    stopReason: "tool_use",
    output: { message: { role: "assistant", content: [{ text: "Mình sẽ xem." }, { toolUse: { toolUseId: "a", name: "training__x", input: { q: 1 } } }, { toolUse: { toolUseId: "b", name: "training__y", input: {} } }, { reasoningContent: { secret: true } }] } },
    usage: { inputTokens: 1200, outputTokens: 90, totalTokens: 1290 },
  });
  assert.equal(r.stopReason, "tool_use");
  assert.deepEqual(r.content.map((b) => b.type), ["text", "toolUse", "toolUse"], "reasoning/other blocks are dropped");
  assert.deepEqual(r.usage, { inputTokens: 1200, outputTokens: 90 });
  for (const stop of ["end_turn", "max_tokens", "content_filtered", "guardrail_intervened", "malformed_tool_use", "model_context_window_exceeded"]) {
    assert.equal(parseConverseResponse({ stopReason: stop, output: { message: { content: [] } } }).stopReason, stop);
  }
  const odd = parseConverseResponse({ stopReason: "something_new", output: { message: { content: [{ text: "x" }] } } });
  assert.equal(odd.stopReason, "unsupported"); assert.equal(odd.rawStopReason, "something_new"); assert.equal(odd.usage, null);
});

test("invalid / unsupported responses throw invalid_response", () => {
  for (const bad of [null, undefined, "text", {}, { output: {} }, { output: { message: { content: "x" } } }]) {
    assert.throws(() => parseConverseResponse(bad), (e: any) => e instanceof AgentProviderError && e.kind === "invalid_response");
  }
});

test("one converse() = one transport call with maxAttempts 1 (no SDK retries) and the turn's abort signal", async () => {
  const seen: any[] = [];
  const provider = createBedrockConverseProvider({ modelId: "m", transport: async (input, opts) => { seen.push({ input, opts }); return { stopReason: "end_turn", output: { message: { content: [{ text: "ok" }] } }, usage: { inputTokens: 1, outputTokens: 1 } }; } });
  const ac = new AbortController();
  const r = await provider.converse({ system: "S", messages: [messages[0]], tools, maxOutputTokens: 100, temperature: 0, signal: ac.signal });
  assert.equal(r.stopReason, "end_turn");
  assert.equal(seen.length, 1); assert.equal(seen[0].opts.maxAttempts, 1); assert.equal(seen[0].opts.abortSignal, ac.signal);
});

test("an already-aborted signal never reaches the transport; transport errors are classified without provider text", async () => {
  let called = 0;
  const provider = createBedrockConverseProvider({ transport: async () => { called++; return {}; } });
  const ac = new AbortController(); ac.abort();
  await assert.rejects(provider.converse({ system: "S", messages: [messages[0]], tools: [], maxOutputTokens: 1, temperature: 0, signal: ac.signal }), (e: any) => e.kind === "aborted");
  assert.equal(called, 0);
  const cases: Array<[string, string]> = [["ThrottlingException", "throttled"], ["AccessDeniedException", "access_denied"], ["ValidationException", "validation"],
    ["ModelTimeoutException", "timeout"], ["InternalServerException", "server"], ["ServiceUnavailableException", "server"], ["AbortError", "aborted"], ["Weird", "unknown"]];
  for (const [name, kind] of cases) {
    const e = classifyProviderError(Object.assign(new Error("prompt text: Lịch của tôi … AKIAEXAMPLE"), { name }));
    assert.equal(e.kind, kind, name);
    assert.doesNotMatch(e.message, /Lịch|AKIA/);
  }
});

test("Zod → JSON Schema for every offered (READ/DRAFT) training tool: object, strict, required fields, bounds", () => {
  for (const c of TRAINING_TOOL_CONTRACTS.filter((x) => x.kind !== "WRITE")) {
    const s: any = zodToJsonSchema(c.input as any);
    assert.equal(s.type, "object", c.id); assert.equal(s.additionalProperties, false, c.id);
  }
  const search: any = zodToJsonSchema(TRAINING_TOOL_CONTRACTS.find((c) => c.id === "training.search_exercise")!.input as any);
  assert.deepEqual(search, { type: "object", properties: { name: { type: "string", minLength: 1, maxLength: 120 } }, required: ["name"], additionalProperties: false });
  const list: any = zodToJsonSchema(TRAINING_TOOL_CONTRACTS.find((c) => c.id === "training.list_exercises")!.input as any);
  assert.equal(list.required, undefined); assert.deepEqual(list.properties.limit, { type: "integer", minimum: 1, maximum: 50 });
  const assess: any = zodToJsonSchema(TRAINING_TOOL_CONTRACTS.find((c) => c.id === "training.get_latest_assessment")!.input as any);
  assert.equal(assess.properties.cycleId.format, "uuid");
});
