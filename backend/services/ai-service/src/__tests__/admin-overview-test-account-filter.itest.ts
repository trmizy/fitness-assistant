/**
 * BACKEND INTEGRATION (real Postgres) for GET /admin/ai/overview's statistics query.
 *
 * Run (isolated test Postgres only, see safe-test-db.ts):
 *   NODE_ENV=test DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/<db>_test \
 *     npx tsx --test --test-force-exit src/__tests__/admin-overview-test-account-filter.itest.ts
 *
 * The database must have the ai-service migrations applied and EMPTY `conversations` / `workout_plans` tables; the suite
 * refuses to run otherwise (it never deletes rows it did not insert).
 *
 * Why: the deployed server excludes ~37k test-account ids from the admin statistics. Prisma `notIn` binds one variable
 * per id and Postgres caps a statement at 32767, so the endpoint answered 500 ("too many bind variables"). The repository
 * now sends the list as ONE text[] parameter. The first test reproduces the old failure on the real database, the others
 * prove the new SQL (COUNT(*) FILTER, "status"::text on the PlanStatus enum, = ANY(text[])) returns the right numbers.
 */
import { describe, it, before, after } from "node:test";
import assert from "node:assert/strict";
import { assertSafeTestDatabase } from "../test-utils/safe-test-db";
import { conversationRepository, prisma } from "../repositories/conversation.repository";

const TAG = `ovw-${Date.now()}`;
const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

const EXCLUDED_TEST_USERS = [`${TAG}-test-7`, `${TAG}-test-8`];
const FILLER_COUNT = 40_000;
const bigExclusionList = [
  ...Array.from({ length: FILLER_COUNT }, (_, i) => `${TAG}-filler-${i}`),
  ...EXCLUDED_TEST_USERS,
];

const created = { conversations: [] as string[], plans: [] as string[] };

function conv(userId: string | null, over: Record<string, unknown>) {
  return {
    userId,
    question: "q",
    answer: "a",
    modelUsed: "test-model",
    responseTime: 1,
    promptTokens: 1,
    completionTokens: 1,
    totalTokens: 2,
    ...over,
  };
}

function plan(userId: string, status: "QUEUED" | "PROCESSING" | "COMPLETED" | "FAILED") {
  return { userId, name: "p", goal: "g", duration: 4, daysPerWeek: 3, plan: {}, status };
}

before(async () => {
  assertSafeTestDatabase(process.env.DATABASE_URL ?? "");
  const [c, p] = await Promise.all([prisma.conversation.count(), prisma.workoutPlan.count()]);
  assert.equal(c + p, 0, "refusing to run: conversations/workout_plans must be empty in the isolated test database");

  const now = Date.now();
  const rows = [
    // kept: real users + one anonymous row
    conv(`${TAG}-real-1`, { createdAt: new Date(now - 1 * HOUR), usedFallback: true, responseTime: 12, warningCount: 1, routeIntent: "workout", responseLanguage: "vi" }),
    conv(`${TAG}-real-2`, { createdAt: new Date(now - 3 * DAY), usedDeterministicFallback: true, responseTime: 2, routeIntent: "nutrition", responseLanguage: "en" }),
    conv(null, { createdAt: new Date(now - 10 * DAY), responseTime: 1 }),
    // excluded: test accounts (must disappear from every number)
    conv(`${TAG}-test-7`, { createdAt: new Date(now - 1 * HOUR), usedFallback: true, responseTime: 20, warningCount: 2, routeIntent: "workout", responseLanguage: "vi" }),
    conv(`${TAG}-test-8`, { createdAt: new Date(now - 2 * HOUR), responseTime: 5, routeIntent: "chitchat", responseLanguage: "vi" }),
  ];
  for (const r of rows) created.conversations.push((await prisma.conversation.create({ data: r as any })).id);
  for (const p of [
    plan(`${TAG}-real-1`, "COMPLETED"),
    plan(`${TAG}-real-2`, "FAILED"),
    plan(`${TAG}-test-7`, "COMPLETED"),
    plan(`${TAG}-test-8`, "QUEUED"),
  ]) created.plans.push((await prisma.workoutPlan.create({ data: p as any })).id);
});

after(async () => {
  await prisma.conversation.deleteMany({ where: { id: { in: created.conversations } } });
  await prisma.workoutPlan.deleteMany({ where: { id: { in: created.plans } } });
  await prisma.$disconnect();
});

describe("GET /admin/ai/overview statistics on real Postgres (40,002 excluded ids)", () => {
  it("PRECONDITION: the old Prisma notIn form really fails at this size (bind-variable limit)", async () => {
    await assert.rejects(
      () => prisma.conversation.count({ where: { OR: [{ userId: null }, { userId: { notIn: bigExclusionList } }] } }),
      (e: any) => /too many bind variables|32767/i.test(String(e?.message)),
    );
  });

  it("with the exclusion list the numbers cover only real + anonymous rows", async () => {
    const out = await conversationRepository.adminGetOverviewStats(bigExclusionList);

    assert.equal(out.excludedTestAccounts, FILLER_COUNT + 2);
    assert.equal(out.conversations.total, 3);
    assert.equal(out.conversations.last24h, 1); // real-1 only; test-7/8 excluded
    assert.equal(out.conversations.fallbackRate, 33.3); // 1 of 3
    assert.equal(out.conversations.deterministicFallbackRate, 33.3);
    assert.equal(out.conversations.warningRate, 33.3); // real-1 only (test-7's warnings excluded)
    assert.equal(out.conversations.slowCount, 1); // real-1 (12 s); test-7's 20 s excluded
    // 7-day window holds real-1 (12) and real-2 (2); anonymous row is 10 days old
    assert.equal(out.conversations.avgLatencySeconds, 7);
    assert.equal(out.conversations.p95LatencySeconds, 11.5);
    const intents = Object.fromEntries(out.intents.map((i) => [i.intent, i.count]));
    assert.deepEqual(intents, { workout: 1, nutrition: 1 }); // chitchat belonged to test-8
    const langs = Object.fromEntries(out.languages.map((l) => [l.language, l.count]));
    assert.deepEqual(langs, { vi: 1, en: 1 });
    assert.deepEqual(out.plans, { queued: 0, processing: 0, completed: 1, failed: 1 }); // enum status read as text
  });

  it("no exclusion (null) counts every row", async () => {
    const out = await conversationRepository.adminGetOverviewStats(null);

    assert.equal(out.excludedTestAccounts, null);
    assert.equal(out.conversations.total, 5);
    assert.equal(out.conversations.slowCount, 2); // 12 s (real-1) and 20 s (test-7); the 5 s row is not slow
    assert.deepEqual(out.plans, { queued: 1, processing: 0, completed: 2, failed: 1 });
  });
});
