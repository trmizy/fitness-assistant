/**
 * AWS-deployment defect (found while checking V-T012 DEP-01): the nutrition worker called fitness-service with a bare axios request to
 * FITNESS_SERVICE_URL || "http://localhost:3002". The deployed worker Lambda has FITNESS_LAMBDA_NAME but NO FITNESS_SERVICE_URL, so the
 * food-catalog fetch failed ("Chưa có dữ liệu thực phẩm…") and the bootstrap auto-save could never reach fitness-service.
 *
 * TEST FIXTURE (real processNutritionPlanJob, real requestService + invokeHttpLambda code; only the AWS SDK network `send`, the LLM call
 * and the plan-row writes are stubbed). Proves: with FITNESS_LAMBDA_NAME set, BOTH calls go through Lambda invoke and axios is never used.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { randomUUID } from "node:crypto";
import axios from "axios";
import { LambdaClient } from "@aws-sdk/client-lambda";
import { conversationRepository } from "../repositories/conversation.repository";
import { llmService } from "../services/llm.service";
import { processNutritionPlanJob } from "../services/nutrition.processor";

const fx = JSON.parse(fs.readFileSync(path.join(__dirname, "fixtures", "nutrition-30b-4meal-valid.json"), "utf8"));

async function run(env: { lambda?: string; url?: string }, failFoods = false) {
  const savedUser = process.env.USER_LAMBDA_NAME; process.env.USER_LAMBDA_NAME = "user-fn";
  const saved = { l: process.env.FITNESS_LAMBDA_NAME, u: process.env.FITNESS_SERVICE_URL, s: process.env.INTERNAL_SERVICE_SECRET };
  if (env.lambda) process.env.FITNESS_LAMBDA_NAME = env.lambda; else delete process.env.FITNESS_LAMBDA_NAME;
  if (env.url) process.env.FITNESS_SERVICE_URL = env.url; else delete process.env.FITNESS_SERVICE_URL;
  process.env.INTERNAL_SERVICE_SECRET = "transport-test-secret";
  const orig = {
    send: (LambdaClient.prototype as any).send, get: axios.get, post: axios.post, call: llmService.callLLM,
    status: conversationRepository.updateNutritionPlanStatus, complete: conversationRepository.updateNutritionPlanCompletion, failed: conversationRepository.updateNutritionPlanFailed,
  };
  const invokes: Array<{ fn: string; event: any }> = [];
  const http: string[] = [];
  let completed: any = null; let failure: string | null = null;
  try {
    (LambdaClient.prototype as any).send = async (cmd: any) => {
      const event = JSON.parse(Buffer.from(cmd.input.Payload).toString("utf8"));
      invokes.push({ fn: cmd.input.FunctionName, event });
      let statusCode = 200; let body: any = {};
      if (event.rawPath === "/internal/foods/for-ai-nutrition") {
        if (failFoods) { statusCode = 503; body = { error: "fitness lambda down" }; } else body = { success: true, data: { foods: fx.foods } };
      } else if (event.rawPath === "/nutrition/from-ai-plan") body = { success: true, data: { alreadyExists: false } };
      else { statusCode = 404; body = { error: "not found (optional worker context)" }; }
      return { StatusCode: 200, Payload: Buffer.from(JSON.stringify({ statusCode, body: JSON.stringify(body) })) };
    };
    axios.get = (async (url: string) => { http.push(`GET ${url}`); throw new Error("axios must not be used when FITNESS_LAMBDA_NAME is set"); }) as any;
    axios.post = (async (url: string) => { http.push(`POST ${url}`); throw new Error("axios must not be used when FITNESS_LAMBDA_NAME is set"); }) as any;
    llmService.callLLM = (async () => ({ answer: fx.llmTemplateAnswer })) as any;
    conversationRepository.updateNutritionPlanStatus = (async () => ({})) as any;
    conversationRepository.updateNutritionPlanCompletion = (async (_id: string, c: any) => { completed = c; return {}; }) as any;
    conversationRepository.updateNutritionPlanFailed = (async (_id: string, reason: string) => { failure = reason; return {}; }) as any;
    const userId = `lambda-${randomUUID()}`;
    const planId = randomUUID();
    await processNutritionPlanJob({
      id: "fixture",
      data: { planId, userId, goal: "WEIGHT_LOSS", durationWeeks: 1, mealsPerDay: fx.mealsPerDay, dailyCaloriesTarget: fx.dailyCaloriesTarget,
        proteinTargetG: fx.proteinTargetG, carbTargetG: fx.carbTargetG, fatTargetG: fx.fatTargetG, excludedFoodKeys: fx.excludedFoodKeys, autoSaveOnComplete: true },
    } as any);
    return { invokes, http, completed, failure, userId, planId };
  } finally {
    (LambdaClient.prototype as any).send = orig.send; axios.get = orig.get; axios.post = orig.post; llmService.callLLM = orig.call;
    conversationRepository.updateNutritionPlanStatus = orig.status; conversationRepository.updateNutritionPlanCompletion = orig.complete; conversationRepository.updateNutritionPlanFailed = orig.failed;
    if (saved.l === undefined) delete process.env.FITNESS_LAMBDA_NAME; else process.env.FITNESS_LAMBDA_NAME = saved.l;
    if (saved.u === undefined) delete process.env.FITNESS_SERVICE_URL; else process.env.FITNESS_SERVICE_URL = saved.u;
    if (saved.s === undefined) delete process.env.INTERNAL_SERVICE_SECRET; else process.env.INTERNAL_SERVICE_SECRET = saved.s;
    if (savedUser === undefined) delete process.env.USER_LAMBDA_NAME; else process.env.USER_LAMBDA_NAME = savedUser;
  }
}

test("Lambda deployment (FITNESS_LAMBDA_NAME set, no FITNESS_SERVICE_URL): food catalog fetch AND auto-save go through Lambda invoke, never HTTP", async () => {
  const r = await run({ lambda: "fitness-fn" });
  assert.equal(r.failure, null, String(r.failure));
  assert.ok(r.completed, "the plan completes");
  assert.deepEqual(r.http, [], "no axios/HTTP call at all");
  const fitness = r.invokes.filter((i) => i.fn === "fitness-fn" && ["/internal/foods/for-ai-nutrition", "/nutrition/from-ai-plan"].includes(i.event.rawPath));
  assert.equal(fitness.length, 2, "the foods GET and the autosave POST both went through the fitness Lambda");
  const [foods, save] = fitness;
  assert.equal(foods.fn, "fitness-fn");
  assert.equal(foods.event.requestContext.http.method, "GET");
  assert.equal(foods.event.rawPath, "/internal/foods/for-ai-nutrition");
  assert.equal(foods.event.headers["x-user-id"], r.userId, "identity of the plan owner");
  assert.equal(foods.event.headers["x-internal-token"], "transport-test-secret");
  assert.equal(save.fn, "fitness-fn");
  assert.equal(save.event.requestContext.http.method, "POST");
  assert.equal(save.event.rawPath, "/nutrition/from-ai-plan");
  assert.equal(save.event.headers["x-user-id"], r.userId);
  const body = JSON.parse(save.event.body);
  assert.equal(body.sourcePlanId, r.planId, "auto-save is bound to this execution's plan");
  assert.equal(body.weeklySchedule.length, 7);
});

test("Lambda deployment: a fitness Lambda failure on the food catalog fails the plan with the existing message (no silent success, no HTTP fallback)", async () => {
  const r = await run({ lambda: "fitness-fn" }, true);
  assert.match(String(r.failure), /Chưa có dữ liệu thực phẩm/);
  assert.equal(r.completed, null);
  assert.deepEqual(r.http, []);
  assert.ok(!r.invokes.some((i) => i.event.rawPath === "/nutrition/from-ai-plan"), "no autosave after a failed catalog call");
});

test("Local/docker (no FITNESS_LAMBDA_NAME): behaviour unchanged — plain HTTP to FITNESS_SERVICE_URL, no Lambda invoke", async () => {
  const saved = { get: axios.get, post: axios.post, send: (LambdaClient.prototype as any).send, call: llmService.callLLM, s: conversationRepository.updateNutritionPlanStatus, c: conversationRepository.updateNutritionPlanCompletion, f: conversationRepository.updateNutritionPlanFailed };
  const urls: string[] = []; let lambdaCalls = 0; let completed: any = null;
  const prevLambda = process.env.FITNESS_LAMBDA_NAME; const prevUrl = process.env.FITNESS_SERVICE_URL;
  delete process.env.FITNESS_LAMBDA_NAME; process.env.FITNESS_SERVICE_URL = "http://fitness.example:3002";
  try {
    (LambdaClient.prototype as any).send = async () => { lambdaCalls++; throw new Error("no lambda expected"); };
    axios.get = (async (url: string, cfg: any) => { urls.push(`GET ${url}`); assert.equal(cfg.headers["x-user-id"].startsWith("http-"), true); return { status: 200, data: { success: true, data: { foods: fx.foods } } }; }) as any;
    axios.post = (async (url: string) => { urls.push(`POST ${url}`); return { status: 200, data: { success: true } }; }) as any;
    llmService.callLLM = (async () => ({ answer: fx.llmTemplateAnswer })) as any;
    conversationRepository.updateNutritionPlanStatus = (async () => ({})) as any;
    conversationRepository.updateNutritionPlanCompletion = (async (_id: string, c: any) => { completed = c; return {}; }) as any;
    conversationRepository.updateNutritionPlanFailed = (async () => ({})) as any;
    await processNutritionPlanJob({ id: "fixture", data: { planId: randomUUID(), userId: `http-${randomUUID()}`, goal: "WEIGHT_LOSS", durationWeeks: 1, mealsPerDay: fx.mealsPerDay, dailyCaloriesTarget: fx.dailyCaloriesTarget, proteinTargetG: fx.proteinTargetG, carbTargetG: fx.carbTargetG, fatTargetG: fx.fatTargetG, excludedFoodKeys: fx.excludedFoodKeys, autoSaveOnComplete: true } } as any);
    assert.ok(completed);
    assert.deepEqual(urls.filter((u) => /for-ai-nutrition|from-ai-plan/.test(u)), ["GET http://fitness.example:3002/internal/foods/for-ai-nutrition", "POST http://fitness.example:3002/nutrition/from-ai-plan"]);
    assert.equal(lambdaCalls, 0);
  } finally {
    axios.get = saved.get; axios.post = saved.post; (LambdaClient.prototype as any).send = saved.send; llmService.callLLM = saved.call;
    conversationRepository.updateNutritionPlanStatus = saved.s; conversationRepository.updateNutritionPlanCompletion = saved.c; conversationRepository.updateNutritionPlanFailed = saved.f;
    if (prevLambda === undefined) delete process.env.FITNESS_LAMBDA_NAME; else process.env.FITNESS_LAMBDA_NAME = prevLambda;
    if (prevUrl === undefined) delete process.env.FITNESS_SERVICE_URL; else process.env.FITNESS_SERVICE_URL = prevUrl;
  }
});
