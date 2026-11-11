import test from "node:test";
import assert from "node:assert/strict";
import { positiveIntEnv } from "../utils/env-int";

const KEY = "ENV_INT_TEST_VALUE";
const withEnv = (v: string | undefined, fn: () => void) => {
  const prev = process.env[KEY];
  if (v === undefined) delete process.env[KEY]; else process.env[KEY] = v;
  try { fn(); } finally { if (prev === undefined) delete process.env[KEY]; else process.env[KEY] = prev; }
};

test("unset or blank uses the fallback", () => {
  withEnv(undefined, () => assert.equal(positiveIntEnv(KEY, 7), 7));
  withEnv("", () => assert.equal(positiveIntEnv(KEY, 7), 7));
  withEnv("   ", () => assert.equal(positiveIntEnv(KEY, 7), 7));
});

test("a valid positive integer is used (whitespace tolerated)", () => {
  withEnv("900", () => assert.equal(positiveIntEnv(KEY, 7), 900));
  withEnv(" 30 ", () => assert.equal(positiveIntEnv(KEY, 7), 30));
});

test("a set-but-invalid value throws naming the variable instead of becoming NaN / disabling a limit", () => {
  for (const bad of ["abc", "NaN", "-5", "0", "1.5", "12abc", "1e3", "9999999999999999999999"]) {
    withEnv(bad, () => assert.throws(() => positiveIntEnv(KEY, 7), (e: Error) => e.message.includes(KEY) && /integer >= 1/.test(e.message), `value ${bad}`));
  }
});

test("zero is accepted only when the setting explicitly allows it", () => {
  withEnv("0", () => {
    assert.equal(positiveIntEnv(KEY, 5, { allowZero: true }), 0);
    assert.throws(() => positiveIntEnv(KEY, 5));
  });
});

test("generation settings and rate limiters refuse an invalid environment loudly", async () => {
  const prev = process.env.AI_GENERATION_LEASE_SECONDS;
  process.env.AI_GENERATION_LEASE_SECONDS = "abc";
  try {
    const { generationOpsDeps } = await import("../services/generation-operations");
    assert.throws(() => generationOpsDeps.leaseMs(), /AI_GENERATION_LEASE_SECONDS/);
  } finally {
    if (prev === undefined) delete process.env.AI_GENERATION_LEASE_SECONDS; else process.env.AI_GENERATION_LEASE_SECONDS = prev;
  }
});
