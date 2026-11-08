/**
 * Gemini fallback for the two Anthropic-direct vision features. Anthropic is a
 * local http stub (ANTHROPIC_BASE_URL), Gemini is a stubbed global fetch — no
 * network. One optional live call runs only with RUN_LIVE_GEMINI=1.
 */
import test, { beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import fs from "node:fs";
import path from "node:path";
import type { AddressInfo } from "node:net";

const REAL_GEMINI_KEY = process.env.GEMINI_API_KEY;
process.env.LLM_PROVIDER = "anthropic";
process.env.ANTHROPIC_API_KEY = "test-key-not-real";
delete process.env.GOAL_VISION_MODEL;
process.env.GEMINI_VISION_MODELS = "m1,m2";

let anthropicMode: { status: number; body: unknown } = { status: 200, body: {} };
let anthropicCalls = 0;
const server = http.createServer((req, res) => {
  req.resume();
  req.on("end", () => {
    anthropicCalls++;
    res.writeHead(anthropicMode.status, { "Content-Type": "application/json" });
    res.end(JSON.stringify(anthropicMode.body));
  });
});
const ready = new Promise<void>((r) => server.listen(0, "127.0.0.1", () => {
  process.env.ANTHROPIC_BASE_URL = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
  r();
}));

const JPEG_B64 = Buffer.concat([Buffer.from([255, 216, 255, 224]), Buffer.alloc(64, 1)]).toString("base64");
const image = { mediaType: "image/jpeg" as const, base64: JPEG_B64 };
const GOOD_GOAL = { muscularity: "HIGH", relativeLeanness: "MODERATE", focusMuscles: ["CHEST"], confidence: 0.8, usable: true };
const toolUse = (input: unknown) => ({ id: "msg_1", type: "message", role: "assistant", model: "x", stop_reason: "tool_use",
  usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: "tool_use", id: "tu_1", name: "t", input }] });
const anthropicError = (_status: number, message: string) => ({ type: "error", error: { type: "api_error", message } });

const realFetch = globalThis.fetch;
let fetchCalls: { url: string; headers: Record<string, string> }[] = [];
let fetchScript: Array<() => Response | Promise<Response>> = [];
const gemOk = (obj: unknown, wrap = "") => new Response(JSON.stringify({
  candidates: [{ finishReason: "STOP", content: { parts: [{ text: `${wrap}${JSON.stringify(obj)}${wrap ? "\n```" : ""}` }] } }],
}), { status: 200 });

beforeEach(() => {
  anthropicCalls = 0;
  fetchCalls = [];
  fetchScript = [];
  process.env.GEMINI_API_KEY = "gem-test-key";
  process.env.ANTHROPIC_API_KEY = "test-key-not-real";
  globalThis.fetch = (async (url: any, init: any) => {
    const u = String(url);
    if (!u.includes("generativelanguage")) return realFetch(url, init);
    fetchCalls.push({ url: u, headers: init.headers });
    const next = fetchScript.shift();
    if (!next) throw new Error("unexpected extra gemini call");
    return next();
  }) as typeof fetch;
});
after(() => { globalThis.fetch = realFetch; server.close(); });

async function goal() {
  await ready;
  return (await import("../services/fitness-goal-vision.service")).analyzeGoalImage(image);
}

test("Anthropic OK -> Gemini never called", async () => {
  anthropicMode = { status: 200, body: toolUse(GOOD_GOAL) };
  const r = await goal();
  assert.equal(r.usable, true);
  assert.equal(fetchCalls.length, 0);
});

test("billing 400 -> Gemini answers (fenced JSON) and passes the same validation", async () => {
  anthropicMode = { status: 400, body: anthropicError(400, "Your credit balance is too low") };
  fetchScript = [() => gemOk(GOOD_GOAL, "```json\n")];
  const r = await goal();
  assert.deepEqual(r, GOOD_GOAL);
  assert.equal(fetchCalls.length, 1);
  assert.equal(fetchCalls[0].headers["x-goog-api-key"], "gem-test-key");
  assert.ok(!fetchCalls[0].url.includes("gem-test-key"));
});

test("Gemini answer failing the same validation is rejected", async () => {
  anthropicMode = { status: 401, body: anthropicError(401, "bad key") };
  fetchScript = [() => gemOk({ ...GOOD_GOAL, muscularity: "EXTREME" })];
  await assert.rejects(goal(), (e: any) => e.name === "ZodError");
});

test("529 -> model1 503 -> model2 OK (image-chat)", async () => {
  anthropicMode = { status: 529, body: anthropicError(529, "overloaded") };
  fetchScript = [() => new Response("x", { status: 503 }), () => gemOk({ type: "GENERAL", answer: "ok" })];
  await ready;
  const { analyzeImageChat } = await import("../services/fitness-vision-chat.service");
  const r = await analyzeImageChat(image, "what is this?");
  assert.deepEqual(r, { type: "GENERAL", answer: "ok" });
  assert.equal(fetchCalls.length, 2);
  assert.ok(fetchCalls[0].url.includes("/m1:") && fetchCalls[1].url.includes("/m2:"));
});

test("Gemini safety block -> error, never an empty success; original Anthropic error is thrown", async () => {
  anthropicMode = { status: 529, body: anthropicError(529, "overloaded-original") };
  fetchScript = [() => new Response(JSON.stringify({ promptFeedback: { blockReason: "SAFETY" } }), { status: 200 })];
  await assert.rejects(goal(), (e: any) => e.status === 529);
  fetchScript = [() => new Response(JSON.stringify({ candidates: [{ finishReason: "SAFETY" }] }), { status: 200 })];
  await assert.rejects(goal(), (e: any) => e.status === 529);
});

test("both fail -> ORIGINAL Anthropic error", async () => {
  anthropicMode = { status: 403, body: anthropicError(403, "forbidden-original") };
  fetchScript = [() => new Response("x", { status: 503 }), () => new Response("x", { status: 500 })];
  await assert.rejects(goal(), (e: any) => e.status === 403 && /forbidden-original/.test(e.message));
});

test("no GEMINI_API_KEY -> exactly today's behaviour, no fetch", async () => {
  delete process.env.GEMINI_API_KEY;
  anthropicMode = { status: 529, body: anthropicError(529, "overloaded") };
  await assert.rejects(goal(), (e: any) => e.status === 529);
  assert.equal(fetchCalls.length, 0);
});

test("Anthropic answered but unusable (no tool_use) -> no fallback", async () => {
  anthropicMode = { status: 200, body: { ...toolUse({}), content: [{ type: "text", text: "hi" }], stop_reason: "end_turn" } };
  await assert.rejects(goal(), /no goal attributes/);
  assert.equal(fetchCalls.length, 0);
});

test("non-billing 400 (bad request) -> no fallback", async () => {
  anthropicMode = { status: 400, body: anthropicError(400, "invalid image") };
  await assert.rejects(goal(), (e: any) => e.status === 400);
  assert.equal(fetchCalls.length, 0);
});

test("LIVE Gemini (RUN_LIVE_GEMINI=1): image-chat shape on a gym-equipment stock image", { skip: process.env.RUN_LIVE_GEMINI !== "1" }, async () => {
  globalThis.fetch = realFetch;
  assert.ok(REAL_GEMINI_KEY, "GEMINI_API_KEY must be in the environment for the live test");
  const { generateGeminiVisionJson } = await import("../services/gemini-vision.client");
  const { ImageChatResultSchema } = await import("../services/fitness-vision-chat.service");
  const file = path.resolve(__dirname, "../../../../../test/vecteezy_ai-generated-gym-with-many-equipments_37235161.jpg");
  const base64 = fs.readFileSync(file).toString("base64");
  process.env.GEMINI_API_KEY = REAL_GEMINI_KEY;
  delete process.env.GEMINI_VISION_MODELS;
  const { json, model } = await generateGeminiVisionJson({
    image: { mediaType: "image/jpeg", base64 },
    text: 'Classify this photo (EQUIPMENT, WORKOUT_SCHEDULE or GENERAL) and answer briefly "what is this?".',
    schema: { type: "object", properties: { type: { enum: ["EQUIPMENT", "WORKOUT_SCHEDULE", "GENERAL"] }, answer: { type: "string" }, equipmentName: { type: ["string", "null"] }, targetMuscles: { type: "array", items: { type: "string" } }, days: { type: "array", items: {} } }, required: ["type", "answer", "targetMuscles", "days"] },
    label: "live",
  });
  const parsed = ImageChatResultSchema.parse(json);
  console.log("LIVE_RESULT", JSON.stringify({ model, type: parsed.type, keys: Object.keys(parsed) }));
});
