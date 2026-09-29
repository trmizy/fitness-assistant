/**
 * Phase 8 — WB-11 FitnessRoadmap against the REAL backend, through the same helpers the screens use.
 *
 *   npx tsx --test e2e/phase8-roadmap.e2e.ts    (gateway http://localhost:3000, john.doe@example.com)
 *
 * Expects the account to already have ONE ACTIVE roadmap (created + activated from the app's wizard
 * during the Phase 8 emulator run). Leaves no residue: the extra DRAFT it creates is archived.
 *
 * What it can NOT prove on a fresh roadmap: a real phase advance. The server only moves to the next
 * phase once a training cycle in the current phase has COMPLETED with an assessment that has enough
 * real data (minimum days, completed sessions, adherence, comparable InBody). Faking weeks of
 * workouts in the dev DB to force that would be fabricated data, so this asserts the server's
 * correct refusal instead.
 */
import { before, describe, it } from "node:test";
import assert from "node:assert/strict";

import { buildManualRoadmap, getPhaseReadiness, groupForecasts, translateRoadmapError } from "../src/features/roadmap/roadmap";

const BASE_URL = process.env.E2E_BASE_URL ?? "http://localhost:3000";
const EMAIL = process.env.E2E_EMAIL ?? "john.doe@example.com";
const PASSWORD = process.env.E2E_PASSWORD ?? "password123";
let token = "";

async function call(method: string, path: string, body?: unknown) {
  const res = await fetch(`${BASE_URL}${path}`, {
    method,
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, data: (await res.json().catch(() => ({}))) as any };
}

before(async () => {
  const res = await fetch(`${BASE_URL}/auth/login`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  const body: any = await res.json();
  token = body?.data?.accessToken ?? body?.accessToken;
  assert.ok(token, "login failed");
});

describe("WB-11 read-only engines", () => {
  it("diagnosis + projection answer with server numbers the wizard renders", async () => {
    const diag = await call("POST", "/fitness-roadmaps/diagnosis", {
      weightKg: 71.3, heightCm: 175, age: 28, gender: "MALE", activityLevel: "MODERATELY_ACTIVE", goal: "WEIGHT_LOSS", timeframeWeeks: 12,
    });
    assert.equal(diag.status, 200);
    const e = diag.data.energyBreakdown;
    assert.ok(e && e.tdee > e.bmr);
    // The breakdown lines always add up to the real TDEE (the card says so).
    assert.equal(e.bmr + e.components.reduce((s: number, c: any) => s + c.kcal, 0), e.tdee);

    const start = new Date();
    const end = new Date(start.getTime() + 8 * 7 * 86_400_000);
    const proj = await call("POST", "/fitness-roadmaps/projection", {
      weightKg: 71.3, heightCm: 175, age: 28, gender: "MALE", activityLevel: "MODERATELY_ACTIVE",
      phases: [{ phaseIndex: 1, phaseType: "FAT_LOSS", name: "Giảm mỡ", plannedStartAt: start.toISOString(), plannedEndAt: end.toISOString() }],
    });
    assert.equal(proj.status, 200);
    const groups = groupForecasts(proj.data);
    assert.equal(groups[0].weeks, 8);
    assert.ok(proj.data.phaseForecasts[0].projectedEndWeightKg < 71.3);
  });
});

describe("WB-11 lifecycle on the real account", () => {
  it("the ACTIVE roadmap has an active phase with a linked ACTIVE cycle", async () => {
    const cur = await call("GET", "/fitness-roadmaps/current");
    assert.equal(cur.status, 200, JSON.stringify(cur.data));
    assert.equal(cur.data.roadmap.status, "ACTIVE");
    assert.ok(cur.data.activePhase);
    assert.equal(getPhaseReadiness(cur.data.activePhase, cur.data.pendingRebuild).kind, "ACTIVE_CYCLE");
  });

  it("advance while the cycle is still running does NOT move the phase (server holds it)", async () => {
    const before = await call("GET", "/fitness-roadmaps/current");
    const r = await call("POST", `/fitness-roadmaps/${before.data.roadmap.id}/advance`, {});
    assert.equal(r.status, 200, JSON.stringify(r.data));
    const after = await call("GET", "/fitness-roadmaps/current");
    assert.equal(after.data.activePhase.id, before.data.activePhase.id);
    assert.equal(after.data.activePhase.status, "ACTIVE");
  });

  it("archive is refused while a phase is ACTIVE — and the app says why in Vietnamese", async () => {
    const cur = await call("GET", "/fitness-roadmaps/current");
    const r = await call("POST", `/fitness-roadmaps/${cur.data.roadmap.id}/archive`, {});
    assert.equal(r.status, 409);
    assert.notEqual(translateRoadmapError(r.data.error), r.data.error, "server message has a Vietnamese translation");
  });

  it("advanced-form DRAFT: saved as DRAFT, activation refused while another roadmap runs, then discarded", async () => {
    const created = await call(
      "POST",
      "/fitness-roadmaps",
      buildManualRoadmap({ name: "E2E Phase 8 — bản nháp", goalType: "WEIGHT_LOSS", phases: [{ phaseType: "FAT_LOSS", weeks: 8 }, { phaseType: "DIET_BREAK", weeks: 2 }] }),
    );
    assert.equal(created.status, 201, JSON.stringify(created.data));
    const id = created.data.roadmap.id;
    try {
      assert.equal(created.data.roadmap.status, "DRAFT");
      assert.equal(created.data.phases.length, 2);
      assert.deepEqual(created.data.phases.map((p: any) => p.objective?.maxCycles), [2, 1]);

      const act = await call("POST", `/fitness-roadmaps/${id}/activate`, {});
      assert.equal(act.status, 409);
      assert.match(translateRoadmapError(act.data.error), /lộ trình khác/);
    } finally {
      const arch = await call("POST", `/fitness-roadmaps/${id}/archive`, {});
      assert.equal(arch.status, 200, JSON.stringify(arch.data));
    }
  });
});
