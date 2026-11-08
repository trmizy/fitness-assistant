import test, { beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import fs from "fs";
import os from "os";
import path from "path";
import { extractInBodyVision, type VisionDeps } from "../services/inbody-vision.service";

const GOOD = {
  measurement_date: "2026-01-02",
  weight: 70,
  height: 175,
  skeletal_muscle_mass: 32,
  body_fat_mass: 12,
  segmental_lean_analysis: { right_arm: 3, left_arm: 3, trunk: 25, right_leg: 9, left_leg: 9 },
  segmental_fat_analysis: { right_arm: 1, left_arm: 1, trunk: 6, right_leg: 2, left_leg: 2 },
};

let imgPath: string;
const saved: Record<string, string | undefined> = {};
const KEYS = ["GEMINI_API_KEY", "GEMINI_VISION_MODELS", "INBODY_VISION_PROVIDER", "ANTHROPIC_API_KEY"];

beforeEach(() => {
  for (const k of KEYS) saved[k] = process.env[k];
  imgPath = path.join(os.tmpdir(), `inbody-fb-${process.pid}.png`);
  fs.writeFileSync(imgPath, Buffer.from("fake-image"));
  process.env.GEMINI_API_KEY = "test-key-not-real";
  process.env.GEMINI_VISION_MODELS = "m1,m2";
  delete process.env.INBODY_VISION_PROVIDER;
});
afterEach(() => {
  for (const k of KEYS) {
    if (saved[k] === undefined) delete process.env[k];
    else process.env[k] = saved[k];
  }
  fs.rmSync(imgPath, { force: true });
});

const claudeOk = (calls: { n: number }): VisionDeps["anthropicCreate"] => async () => {
  calls.n++;
  return { content: [{ type: "tool_use", input: GOOD }] } as never;
};
const claudeErr = (status: number | undefined, message: string, calls: { n: number }): VisionDeps["anthropicCreate"] =>
  async () => {
    calls.n++;
    throw Object.assign(new Error(message), status === undefined ? {} : { status });
  };

function geminiFetch(statuses: Array<number | "ok" | "fenced">, urls: string[] = [], headers: Array<Record<string, string>> = []): typeof fetch {
  let i = 0;
  return (async (url: string, init: RequestInit) => {
    urls.push(String(url));
    headers.push(init.headers as Record<string, string>);
    const s = statuses[Math.min(i++, statuses.length - 1)];
    if (s === "ok" || s === "fenced") {
      const text = s === "ok" ? JSON.stringify(GOOD) : "```json\n" + JSON.stringify(GOOD) + "\n```";
      return new Response(JSON.stringify({ candidates: [{ content: { parts: [{ text }] } }] }), { status: 200 });
    }
    return new Response("err", { status: s });
  }) as unknown as typeof fetch;
}

test("Anthropic OK -> no Gemini call", async () => {
  const c = { n: 0 };
  let fetched = 0;
  const r = await extractInBodyVision(imgPath, "image/png", {
    anthropicCreate: claudeOk(c),
    fetchImpl: (async () => { fetched++; return new Response("{}"); }) as unknown as typeof fetch,
  });
  assert.equal(r.weight, 70);
  assert.equal(fetched, 0);
});

test("Anthropic billing error -> Gemini OK (key in header, not URL)", async () => {
  const c = { n: 0 };
  const urls: string[] = [];
  const hdrs: Array<Record<string, string>> = [];
  const r = await extractInBodyVision(imgPath, "image/png", {
    anthropicCreate: claudeErr(400, "Your credit balance is too low to access the Anthropic API", c),
    fetchImpl: geminiFetch(["fenced"], urls, hdrs),
  });
  assert.equal(r.skeletal_muscle_mass, 32);
  assert.equal(urls.length, 1);
  assert.ok(urls[0].includes("/m1:generateContent"));
  assert.ok(!urls[0].includes("key"));
  assert.equal(hdrs[0]["x-goog-api-key"], "test-key-not-real");
});

test("Anthropic 529 -> Gemini model1 503 -> model2 OK", async () => {
  const urls: string[] = [];
  const r = await extractInBodyVision(imgPath, "image/png", {
    anthropicCreate: claudeErr(529, "overloaded", { n: 0 }),
    fetchImpl: geminiFetch([503, "ok"], urls),
  });
  assert.equal(r.height, 175);
  assert.equal(urls.length, 2);
  assert.ok(urls[1].includes("/m2:"));
});

test("both fail -> original Anthropic error is thrown", async () => {
  await assert.rejects(
    extractInBodyVision(imgPath, "image/png", {
      anthropicCreate: claudeErr(529, "overloaded", { n: 0 }),
      fetchImpl: geminiFetch([503]),
    }),
    /overloaded/,
  );
});

test("no GEMINI_API_KEY -> no Gemini call, Anthropic error unchanged", async () => {
  delete process.env.GEMINI_API_KEY;
  let fetched = 0;
  await assert.rejects(
    extractInBodyVision(imgPath, "image/png", {
      anthropicCreate: claudeErr(529, "overloaded", { n: 0 }),
      fetchImpl: (async () => { fetched++; return new Response("{}"); }) as unknown as typeof fetch,
    }),
    /overloaded/,
  );
  assert.equal(fetched, 0);
});

test("validation failure (no tool_use) -> no fallback", async () => {
  let fetched = 0;
  await assert.rejects(
    extractInBodyVision(imgPath, "image/png", {
      anthropicCreate: (async () => ({ content: [{ type: "text", text: "not an inbody" }] })) as never,
      fetchImpl: (async () => { fetched++; return new Response("{}"); }) as unknown as typeof fetch,
    }),
    /did not return structured/,
  );
  assert.equal(fetched, 0);
});

test("non-billing 400 from Anthropic (bad image) -> no fallback", async () => {
  let fetched = 0;
  await assert.rejects(
    extractInBodyVision(imgPath, "image/png", {
      anthropicCreate: claudeErr(400, "Could not process image", { n: 0 }),
      fetchImpl: (async () => { fetched++; return new Response("{}"); }) as unknown as typeof fetch,
    }),
    /Could not process image/,
  );
  assert.equal(fetched, 0);
});

test("INBODY_VISION_PROVIDER=gemini goes to Gemini first", async () => {
  process.env.INBODY_VISION_PROVIDER = "gemini";
  const c = { n: 0 };
  const r = await extractInBodyVision(imgPath, "image/png", {
    anthropicCreate: claudeOk(c),
    fetchImpl: geminiFetch(["ok"]),
  });
  assert.equal(r.weight, 70);
  assert.equal(c.n, 0);
});

test("LIVE Gemini (RUN_LIVE_GEMINI=1)", { skip: process.env.RUN_LIVE_GEMINI !== "1" }, async () => {
  process.env.INBODY_VISION_PROVIDER = "gemini";
  process.env.GEMINI_API_KEY = saved.GEMINI_API_KEY;
  if (saved.GEMINI_VISION_MODELS === undefined) delete process.env.GEMINI_VISION_MODELS;
  else process.env.GEMINI_VISION_MODELS = saved.GEMINI_VISION_MODELS;
  const img = process.env.LIVE_INBODY_IMAGE || "D:/FitnessAssistant/test/InBody'/real_pic.jpg";
  const r = await extractInBodyVision(img, "image/jpeg");
  console.log("LIVE_RESULT", JSON.stringify(r));
  assert.ok(r.weight && r.weight > 20);
});
