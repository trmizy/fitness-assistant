const { test } = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const ts = require("typescript");

function loadExtractor() {
  const calls = [];
  const source = fs.readFileSync(
    path.join(
      __dirname,
      "../../backend/services/ai-service/src/llm/profile_extractor.ts",
    ),
    "utf8",
  );
  const compiled = ts.transpileModule(source, {
    compilerOptions: {
      module: ts.ModuleKind.CommonJS,
      target: ts.ScriptTarget.ES2022,
    },
  }).outputText;
  const exports = {};
  vm.runInNewContext(compiled, {
    exports,
    require(name) {
      if (name === "@gym-coach/shared")
        return { logger: { warn() {}, debug() {}, info() {} } };
      if (name === "./nutrition_engine")
        return {
          checkMacroCalorieConsistency() {
            return { consistent: true };
          },
        };
      if (name === "../clients/service-lambda.client")
        return {
          async requestService(request) {
            calls.push(request);
            const weight =
              request.headers.Authorization === "Bearer fixture-a" ? 70 : 80;
            const data =
              request.path === "/profile/me"
                ? { profile: { currentWeight: weight } }
                : request.path === "/inbody"
                  ? [{ weight, bodyFatPct: 20, date: "2026-10-16" }]
                  : request.path === "/nutrition/daily-history"
                    ? { data: [] }
                    : request.path === "/workouts" ||
                        request.path === "/nutrition"
                      ? []
                      : null;
            return { status: 200, data };
          },
        };
      throw new Error(`Unexpected dependency: ${name}`);
    },
  });
  return { extractor: exports.profileExtractor, calls };
}

test("personalization uses the shared service transport with bearer identity and structured query parameters", async () => {
  const { extractor, calls } = loadExtractor();
  const context = await extractor.extract("fixture-a", "Bearer fixture-a");
  assert.equal(context.latestInBody.weightKg, 70);
  assert.equal(calls.length, 8);
  assert.ok(
    calls.every(
      (c) =>
        c.method === "GET" &&
        c.timeoutMs === 3000 &&
        c.headers.Authorization === "Bearer fixture-a",
    ),
  );
  const inbody = calls.find((c) => c.path === "/inbody");
  assert.equal(inbody.service, "user");
  assert.equal(calls.find((c) => c.path === "/workouts").params.limit, 20);
  assert.equal(
    calls.find((c) => c.path === "/nutrition/daily-history").params.days,
    7,
  );
  assert.ok(calls.every((c) => !c.path.includes("?")));
});

test("concurrent personalization requests retain each account identity and measurements", async () => {
  const { extractor } = loadExtractor();
  const [a, b] = await Promise.all([
    extractor.extract("fixture-a", "Bearer fixture-a"),
    extractor.extract("fixture-b", "Bearer fixture-b"),
  ]);
  assert.equal(a.latestInBody.weightKg, 70);
  assert.equal(b.latestInBody.weightKg, 80);
});
