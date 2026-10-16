/**
 * BUG-A1 (AWS DEV E2E, 2026-09-30): GET /admin/ai/overview and /admin/ai/queue timed out at
 * exactly the Lambda's 30s limit and returned 503 on every call. Root cause: those handlers
 * read queue counts straight off `aiQueue` (BullMQ), which lazily opens a real ioredis
 * connection to REDIS_HOST (default "localhost") on first use — unreachable from the AI HTTP
 * Lambda, and ioredis's default retry strategy does not reject quickly enough to hit the
 * existing `.catch(() => null)`. These tests exercise `getAiQueueStats()` through the
 * `sqsDeps`/`bullmqStatsDeps` seams (same pattern as `bedrockRuntimeDeps` in
 * services/bedrock.client.ts) so no real AWS call or Redis connection is ever made, and prove:
 *   - QUEUE_PROVIDER=sqs never touches the BullMQ seam at all (no Redis connection attempted).
 *   - The BullMQ path is used only when QUEUE_PROVIDER is unset/not "sqs".
 *   - Either path degrades to null counts within the 2s bound instead of hanging, on both a
 *     hard failure and a slow/never-resolving dependency.
 */
import test from "node:test";
import assert from "node:assert/strict";

process.env.AI_TASKS_QUEUE_URL =
  process.env.AI_TASKS_QUEUE_URL ||
  "https://sqs.ap-southeast-1.amazonaws.com/000000000000/test-ai-tasks";

import {
  getAiQueueStats,
  sqsDeps,
  bullmqStatsDeps,
} from "../workers/queue-provider";

function withEnv<T>(name: string, value: string | undefined, fn: () => T): T {
  const prev = process.env[name];
  if (value === undefined) delete process.env[name];
  else process.env[name] = value;
  try {
    return fn();
  } finally {
    if (prev === undefined) delete process.env[name];
    else process.env[name] = prev;
  }
}

test("QUEUE_PROVIDER=sqs: reads real SQS attributes, never touches the BullMQ seam", async () => {
  let bullmqCalled = false;
  const originalGetStats = bullmqStatsDeps.getStats;
  bullmqStatsDeps.getStats = async () => {
    bullmqCalled = true;
    return { waiting: -1, active: -1, completed: -1, failed: -1, delayed: -1 };
  };
  const originalGetAttrs = sqsDeps.getQueueAttributes;
  sqsDeps.getQueueAttributes = async () =>
    ({
      Attributes: {
        ApproximateNumberOfMessages: "3",
        ApproximateNumberOfMessagesNotVisible: "1",
        ApproximateNumberOfMessagesDelayed: "0",
      },
    }) as never;

  try {
    const stats = await withEnv("QUEUE_PROVIDER", "sqs", () =>
      getAiQueueStats(),
    );
    assert.deepEqual(stats, {
      waiting: 3,
      active: 1,
      completed: null, // SQS has no concept of a completed-message count
      failed: null, // SQS has no concept of a failed-message count (DLQ only)
      delayed: 0,
    });
    assert.equal(bullmqCalled, false, "sqs mode must never call the BullMQ stats seam");
  } finally {
    bullmqStatsDeps.getStats = originalGetStats;
    sqsDeps.getQueueAttributes = originalGetAttrs;
  }
});

test("QUEUE_PROVIDER=sqs + SQS call fails: degrades to null counts, does not throw", async () => {
  const original = sqsDeps.getQueueAttributes;
  sqsDeps.getQueueAttributes = async () => {
    throw new Error("simulated AccessDenied");
  };
  try {
    const stats = await withEnv("QUEUE_PROVIDER", "sqs", () =>
      getAiQueueStats(),
    );
    assert.deepEqual(stats, {
      waiting: null,
      active: null,
      completed: null,
      failed: null,
      delayed: null,
    });
  } finally {
    sqsDeps.getQueueAttributes = original;
  }
});

test("QUEUE_PROVIDER=sqs + SQS call never resolves: bounded by the 2s timeout, does not hang the request", async () => {
  const original = sqsDeps.getQueueAttributes;
  sqsDeps.getQueueAttributes = () => new Promise(() => {}) as never; // never settles
  try {
    const startedAt = Date.now();
    const stats = await withEnv("QUEUE_PROVIDER", "sqs", () =>
      getAiQueueStats(),
    );
    const elapsedMs = Date.now() - startedAt;
    assert.deepEqual(stats, {
      waiting: null,
      active: null,
      completed: null,
      failed: null,
      delayed: null,
    });
    assert.ok(
      elapsedMs < 3000,
      `expected getAiQueueStats to resolve well under the old 30s Lambda timeout, took ${elapsedMs}ms`,
    );
  } finally {
    sqsDeps.getQueueAttributes = original;
  }
});

test("QUEUE_PROVIDER=sqs but AI_TASKS_QUEUE_URL unset: returns null counts without calling SQS", async () => {
  let called = false;
  const original = sqsDeps.getQueueAttributes;
  sqsDeps.getQueueAttributes = async () => {
    called = true;
    return {} as never;
  };
  try {
    const stats = await withEnv("QUEUE_PROVIDER", "sqs", () =>
      withEnv("AI_TASKS_QUEUE_URL", undefined, () => getAiQueueStats()),
    );
    assert.deepEqual(stats, {
      waiting: null,
      active: null,
      completed: null,
      failed: null,
      delayed: null,
    });
    assert.equal(called, false);
  } finally {
    sqsDeps.getQueueAttributes = original;
  }
});

test("QUEUE_PROVIDER unset (BullMQ/local/docker mode): reads live BullMQ counts, never touches the SQS seam", async () => {
  let sqsCalled = false;
  const originalSqs = sqsDeps.getQueueAttributes;
  sqsDeps.getQueueAttributes = async () => {
    sqsCalled = true;
    return {} as never;
  };
  const originalBullmq = bullmqStatsDeps.getStats;
  bullmqStatsDeps.getStats = async () => ({
    waiting: 2,
    active: 1,
    completed: 40,
    failed: 3,
    delayed: 0,
  });

  try {
    const stats = await withEnv("QUEUE_PROVIDER", undefined, () =>
      getAiQueueStats(),
    );
    assert.deepEqual(stats, {
      waiting: 2,
      active: 1,
      completed: 40,
      failed: 3,
      delayed: 0,
    });
    assert.equal(sqsCalled, false, "non-sqs mode must never call the SQS stats seam");
  } finally {
    sqsDeps.getQueueAttributes = originalSqs;
    bullmqStatsDeps.getStats = originalBullmq;
  }
});

test("QUEUE_PROVIDER unset + BullMQ/Redis unreachable (rejects): degrades to null counts", async () => {
  const original = bullmqStatsDeps.getStats;
  bullmqStatsDeps.getStats = async () => {
    throw new Error("simulated ECONNREFUSED 127.0.0.1:6379");
  };
  try {
    const stats = await withEnv("QUEUE_PROVIDER", undefined, () =>
      getAiQueueStats(),
    );
    assert.deepEqual(stats, {
      waiting: null,
      active: null,
      completed: null,
      failed: null,
      delayed: null,
    });
  } finally {
    bullmqStatsDeps.getStats = original;
  }
});

test("QUEUE_PROVIDER unset + BullMQ/Redis hangs (never resolves, the exact AWS DEV failure mode): bounded by the 2s timeout", async () => {
  const original = bullmqStatsDeps.getStats;
  bullmqStatsDeps.getStats = () => new Promise(() => {}); // simulates ioredis's default retry strategy never rejecting
  try {
    const startedAt = Date.now();
    const stats = await withEnv("QUEUE_PROVIDER", undefined, () =>
      getAiQueueStats(),
    );
    const elapsedMs = Date.now() - startedAt;
    assert.deepEqual(stats, {
      waiting: null,
      active: null,
      completed: null,
      failed: null,
      delayed: null,
    });
    assert.ok(
      elapsedMs < 3000,
      `expected getAiQueueStats to resolve well under the old 30s Lambda timeout, took ${elapsedMs}ms`,
    );
  } finally {
    bullmqStatsDeps.getStats = original;
  }
});
