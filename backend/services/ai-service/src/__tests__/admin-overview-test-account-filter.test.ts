import { describe, it, afterEach } from "node:test";
import assert from "node:assert/strict";
import { conversationRepository, prisma } from "../repositories/conversation.repository";

/**
 * GET /admin/ai/overview returned 500 on the deployed server: the test-account exclusion list (~37k ids at seed scale)
 * was bound one variable per id through Prisma `notIn`, over Postgres' 32767 limit. These tests pin the contract at the
 * query-building level (TEST FIXTURE, no database): every statement of adminGetOverviewStats sends the id list as ONE array
 * parameter, and the numbers the stub rows produce are mapped exactly as before.
 */

type SqlLike = { strings?: readonly string[]; values?: unknown[]; sql?: string };

/** Bind-variable count after Prisma flattens nested Prisma.sql fragments; an array value is a single parameter. */
function bindCount(values: unknown[]): number {
  let n = 0;
  for (const v of values) {
    if (v && typeof v === "object" && Array.isArray((v as SqlLike).values) && (v as SqlLike).strings) {
      n += bindCount((v as SqlLike).values as unknown[]);
    } else {
      n += 1;
    }
  }
  return n;
}

function sqlText(strings: readonly string[], values: unknown[]): string {
  let out = strings.join(" ");
  for (const v of values) {
    if (v && typeof v === "object" && (v as SqlLike).strings) out += " " + sqlText((v as SqlLike).strings!, (v as SqlLike).values ?? []);
  }
  return out;
}

const original = {
  queryRaw: prisma.$queryRaw,
  convCount: prisma.conversation.count,
  planGroupBy: prisma.workoutPlan.groupBy,
};

afterEach(() => {
  (prisma as any).$queryRaw = original.queryRaw;
  prisma.conversation.count = original.convCount;
  prisma.workoutPlan.groupBy = original.planGroupBy;
});

function install(rowsFor: (sql: string) => unknown[]) {
  const calls: Array<{ sql: string; binds: number; arrays: number }> = [];
  (prisma as any).$queryRaw = (async (strings: readonly string[], ...values: unknown[]) => {
    const sql = sqlText(strings, values);
    const flat: unknown[] = [];
    const walk = (vs: unknown[]) => {
      for (const v of vs) {
        if (v && typeof v === "object" && (v as SqlLike).strings) walk((v as SqlLike).values ?? []);
        else flat.push(v);
      }
    };
    walk(values);
    calls.push({ sql, binds: bindCount(values), arrays: flat.filter(Array.isArray).length });
    return rowsFor(sql);
  }) as any;
  // The old code path: these must never be reached by adminGetOverviewStats any more.
  prisma.conversation.count = (async () => {
    throw new Error("prisma.conversation.count must not be used (notIn bind explosion)");
  }) as any;
  prisma.workoutPlan.groupBy = (async () => {
    throw new Error("prisma.workoutPlan.groupBy must not be used (notIn bind explosion)");
  }) as any;
  return calls;
}

const rows = (sql: string): unknown[] => {
  if (sql.includes('FROM "workout_plans"')) {
    return [
      { status: "COMPLETED", cnt: 7n },
      { status: "FAILED", cnt: 2n },
    ];
  }
  if (sql.includes("PERCENTILE_CONT")) return [{ avg: 3.5, p95: 9.25 }];
  if (sql.includes('"route_intent"')) return [{ route_intent: "workout", cnt: 4n }];
  if (sql.includes('"response_language"')) return [{ response_language: "vi", cnt: 9n }];
  // conversation counts
  return [{ total: 200n, last24h: 20n, fallback: 10n, deterministic_fallback: 4n, warning: 30n, slow: 5n }];
};

describe("adminGetOverviewStats — test-account exclusion", () => {
  it("37k excluded ids stay ONE array parameter per statement (never one bind per id), no Prisma count/groupBy", async () => {
    const ids = Array.from({ length: 37409 }, (_, i) => `user-${i}`);
    const calls = install(rows);

    await conversationRepository.adminGetOverviewStats(ids);

    assert.equal(calls.length, 5, "counts, latency, intents, languages and plan statuses are all raw statements");
    for (const c of calls) {
      assert.ok(c.binds < 100, `statement binds ${c.binds} variables (limit is 32767): ${c.sql.slice(0, 80)}`);
      assert.equal(c.arrays, 1, "the id list is sent as a single array parameter");
      assert.match(c.sql, /ANY\(/);
    }
    assert.ok(calls.some((c) => c.sql.includes('FROM "workout_plans"')), "plan statuses honour the exclusion too");
  });

  it("maps the aggregate rows to the same response shape and rates as before", async () => {
    install(rows);

    const out = await conversationRepository.adminGetOverviewStats(["a", "b"]);

    assert.equal(out.conversations.total, 200);
    assert.equal(out.conversations.last24h, 20);
    assert.equal(out.conversations.fallbackRate, 5); // 10 / 200
    assert.equal(out.conversations.deterministicFallbackRate, 2); // 4 / 200
    assert.equal(out.conversations.warningRate, 15); // 30 / 200
    assert.equal(out.conversations.slowCount, 5);
    assert.equal(out.conversations.avgLatencySeconds, 3.5);
    assert.equal(out.conversations.p95LatencySeconds, 9.25);
    assert.equal(out.excludedTestAccounts, 2);
    assert.deepEqual(out.intents, [{ intent: "workout", count: 4 }]);
    assert.deepEqual(out.languages, [{ language: "vi", count: 9 }]);
    assert.deepEqual(out.plans, { queued: 0, processing: 0, completed: 7, failed: 2 });
  });

  it("no exclusion list (null / empty) adds no ANY() filter and reports excludedTestAccounts null / 0", async () => {
    const calls = install(rows);
    const unfiltered = await conversationRepository.adminGetOverviewStats(null);
    assert.equal(unfiltered.excludedTestAccounts, null);
    for (const c of calls) assert.doesNotMatch(c.sql, /ANY\(/);

    const empty = await conversationRepository.adminGetOverviewStats([]);
    assert.equal(empty.excludedTestAccounts, 0);
  });

  it("an empty conversations table yields zero rates, not NaN", async () => {
    install((sql) =>
      sql.includes('FROM "workout_plans"') || sql.includes("PERCENTILE_CONT") || sql.includes('"route_intent"') || sql.includes('"response_language"')
        ? sql.includes("PERCENTILE_CONT") ? [{ avg: null, p95: null }] : []
        : [{ total: 0n, last24h: 0n, fallback: 0n, deterministic_fallback: 0n, warning: 0n, slow: 0n }],
    );

    const out = await conversationRepository.adminGetOverviewStats(["a"]);

    assert.equal(out.conversations.total, 0);
    assert.equal(out.conversations.fallbackRate, 0);
    assert.equal(out.conversations.avgLatencySeconds, null);
    assert.deepEqual(out.plans, { queued: 0, processing: 0, completed: 0, failed: 0 });
  });
});
