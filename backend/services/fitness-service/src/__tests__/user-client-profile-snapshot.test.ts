/**
 * Regression test for a real bug found during Phase 2 audit (2026-09-06):
 * `UserProfileSnapshot` declared `safetyScreeningStatus`/`safetyScreeningFlags`,
 * but `fetchUserProfile`'s mapping function never copied them from the raw
 * user-service response into the returned object — so
 * `nutritionBootstrapScreening()` always saw `undefined` regardless of the
 * user's real screening answers, silently defaulting every user to
 * "UNKNOWN"/no flags and making the entire safety gate a no-op.
 *
 * This is exactly the class of bug nutrition-onboarding-bootstrap.
 * integration.test.ts cannot catch — that test stubs `fetchUserProfile`
 * wholesale via `nutritionBootstrapDeps`, bypassing the real HTTP-response-
 * to-snapshot mapping entirely. This test exercises the REAL function
 * against a real (local, ephemeral) HTTP server standing in for
 * user-service, so a future edit that drops a field from the mapping
 * fails a test instead of shipping silently.
 *
 * Run with: npx tsx --test src/__tests__/user-client-profile-snapshot.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { fetchUserProfile } from "../clients/user.client";

async function withFakeUserService(
  profileBody: Record<string, unknown>,
  run: () => Promise<void>,
): Promise<void> {
  const server = http.createServer((_req, res) => {
    res.writeHead(200, { "content-type": "application/json" });
    res.end(JSON.stringify({ profile: profileBody }));
  });
  await new Promise<void>((resolve) => server.listen(0, resolve));
  const address = server.address();
  const port = typeof address === "object" && address ? address.port : 0;
  const previousUrl = process.env.USER_SERVICE_URL;
  process.env.USER_SERVICE_URL = `http://127.0.0.1:${port}`;
  try {
    await run();
  } finally {
    process.env.USER_SERVICE_URL = previousUrl;
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}

test("fetchUserProfile propagates safetyScreeningStatus/Flags from the real user-service response", async () => {
  await withFakeUserService(
    { safetyScreeningStatus: "FOLLOW_UP_SUGGESTED", safetyScreeningFlags: ["heart_condition", "chest_pain"] },
    async () => {
      const snapshot = await fetchUserProfile("user-1");
      assert.equal(snapshot?.safetyScreeningStatus, "FOLLOW_UP_SUGGESTED");
      assert.deepEqual(snapshot?.safetyScreeningFlags, ["heart_condition", "chest_pain"]);
    },
  );
});

test("fetchUserProfile defaults safetyScreeningFlags to [] (never undefined) when the field is absent", async () => {
  await withFakeUserService({ goal: "WEIGHT_LOSS" }, async () => {
    const snapshot = await fetchUserProfile("user-2");
    assert.equal(snapshot?.safetyScreeningStatus, null);
    assert.deepEqual(snapshot?.safetyScreeningFlags, []);
  });
});

test("fetchUserProfile still propagates every other previously-verified field alongside the new ones", async () => {
  await withFakeUserService(
    {
      goal: "MUSCLE_GAIN",
      currentWeight: 80,
      age: 30,
      gender: "FEMALE",
      heightCm: 165,
      activityLevel: "MODERATELY_ACTIVE",
      nutritionBudgetLevel: "LOW",
      safetyScreeningStatus: "CLEARED",
      safetyScreeningFlags: [],
    },
    async () => {
      const snapshot = await fetchUserProfile("user-3");
      assert.equal(snapshot?.goal, "MUSCLE_GAIN");
      assert.equal(snapshot?.currentWeight, 80);
      assert.equal(snapshot?.age, 30);
      assert.equal(snapshot?.gender, "FEMALE");
      assert.equal(snapshot?.heightCm, 165);
      assert.equal(snapshot?.activityLevel, "MODERATELY_ACTIVE");
      assert.equal(snapshot?.nutritionBudgetLevel, "LOW");
      assert.equal(snapshot?.safetyScreeningStatus, "CLEARED");
      assert.deepEqual(snapshot?.safetyScreeningFlags, []);
    },
  );
});

// Smart Substitute region personalization — same bug class as
// safetyScreeningStatus above (a type declaration with no mapping), so
// tested the same way: a real HTTP round trip, never a wholesale-stubbed
// fetchUserProfile.
test("fetchUserProfile propagates region and dietaryPreference from the real user-service response", async () => {
  await withFakeUserService(
    { region: "TRUNG", dietaryPreference: "Ăn chay (có trứng/sữa)" },
    async () => {
      const snapshot = await fetchUserProfile("user-4");
      assert.equal(snapshot?.region, "TRUNG");
      assert.equal(snapshot?.dietaryPreference, "Ăn chay (có trứng/sữa)");
    },
  );
});

test("fetchUserProfile defaults region and dietaryPreference to null (never undefined) when absent", async () => {
  await withFakeUserService({ goal: "WEIGHT_LOSS" }, async () => {
    const snapshot = await fetchUserProfile("user-5");
    assert.equal(snapshot?.region, null);
    assert.equal(snapshot?.dietaryPreference, null);
  });
});
