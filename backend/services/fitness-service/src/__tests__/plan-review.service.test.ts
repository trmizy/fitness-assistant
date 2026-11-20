import test from "node:test";
import assert from "node:assert/strict";
import { createPlanReviewService } from "../services/plan-review/plan-review.service";
import { InMemoryPlanReviewRepository } from "../services/plan-review/plan-review.memory-repository";
import type { ProgramSnapshotSource } from "../services/plan-review/plan-review.engine";

/**
 * Workout Plan Review & Approval — service-level scenarios.
 * Evidence label: TEST FIXTURE / BACKEND LOGIC. These use an in-memory repository that reproduces the DB guarantees
 * (partial-unique open request, unique idempotency key, conditional status+revision writes) — they do NOT exercise Postgres.
 * The Postgres-backed twin is plan-review.integration.test.ts (skipped without an isolated *_test database).
 */

const PT = "pt-1";
const PT2 = "pt-2";
const CLIENT = "client-1";
const CLIENT2 = "client-2";
const ptActor = { id: PT, role: "PT" };
const clientActor = { id: CLIENT, role: "CUSTOMER" };

/**
 * `version` mirrors WorkoutProgram.version: workout.service bumps it atomically with every reviewable edit. Tests that "edit the
 * plan" therefore pass a higher version, exactly as a real mutation would (version-0 sample = a brand-new program at 1).
 */
function makeProgram(id = "prog-1", repsFirst = 10, version = 1): ProgramSnapshotSource {
  return {
    id, name: "Giảm mỡ tăng cơ", goal: "FAT_LOSS", durationWeeks: 8, daysPerWeek: 2, version,
    sourcePlanId: "ai-plan-1", aiPlanVersion: 2,
    days: [
      { dayNumber: 1, title: "Ngực + Lưng", exercises: [{ exerciseId: "e1", order: 1, sets: 3, reps: repsFirst, exercise: { exerciseName: "Bench Press" } }] },
      { dayNumber: 2, title: "Chân", exercises: [{ exerciseId: "e2", order: 1, sets: 4, reps: 8, exercise: { exerciseName: "Squat" } }] },
    ],
  };
}

function setup() {
  const repo = new InMemoryPlanReviewRepository();
  const contracts = new Map<string, Set<string>>([[PT, new Set([CLIENT])], [PT2, new Set([CLIENT2, CLIENT])]]);
  const state = {
    rosterDown: false,
    programs: new Map<string, ProgramSnapshotSource | null>([[CLIENT, makeProgram()], [CLIENT2, makeProgram("prog-2")]]),
    notifyCalls: [] as Array<{ userId: string; text: string; entityId: string; kind: string; dedupeKey: string; link: string }>,
    notifyFails: false,
  };
  // Stands in for the locked workout_programs.version read of the Prisma repository (atomic approval guard).
  repo.subjectVersionOf = (id) => {
    for (const p of state.programs.values()) if (p && p.id === id) return p.version;
    return null;
  };
  const service = createPlanReviewService({
    repo,
    loadCurrentProgram: async (id) => state.programs.get(id) ?? null,
    fetchActiveClientIds: async (pt) => {
      if (state.rosterDown) throw new Error("user-service unavailable");
      return [...(contracts.get(pt) ?? [])];
    },
    notify: async (n) => {
      if (state.notifyFails) throw new Error("channel down");
      state.notifyCalls.push({ userId: n.userId, text: n.text, entityId: n.requestId, kind: n.kind, dedupeKey: n.dedupeKey, link: n.link });
    },
    now: () => new Date("2026-11-19T10:00:00Z"),
  });
  return { repo, contracts, state, service };
}

async function rejects(p: Promise<unknown>, status: number, code: string) {
  await assert.rejects(p, (e: any) => {
    assert.equal(e.status, status, `status ${e.status} ${e.code}`);
    assert.equal(e.code, code);
    return true;
  });
}

// ── submit / approve / request changes / reject ────────────────────────────

test("S01 submit: creates a PENDING_REVIEW request bound to (programId, version, hash) with an immutable snapshot + SUBMITTED event", async () => {
  const { service, repo } = setup();
  const { request, replayed } = await service.submit(clientActor, { ptUserId: PT });
  assert.equal(replayed, false);
  assert.equal(request.status, "PENDING_REVIEW");
  assert.equal(request.subjectId, "prog-1");
  assert.equal(request.subjectVersion, 1);
  assert.match(request.contentHash, /^[a-f0-9]{64}$/);
  assert.equal(request.sourcePlanId, "ai-plan-1", "AI WorkoutPlan kept as provenance only");
  assert.equal(request.aiPlanVersion, 2);
  assert.equal((repo.events.filter((e) => e.requestId === request.id))[0].type, "SUBMITTED");
});

test("S02 approve: APPROVED + note + audit event, client is queued for a (generic) notification", async () => {
  const { service, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const res = await service.approve(ptActor, request.id, { note: "Tốt" });
  assert.equal(res.request.status, "APPROVED");
  assert.equal(res.request.decisionNote, "Tốt");
  assert.equal(res.request.effectiveState, "APPROVED_CURRENT");
  const ev = repo.events.filter((e) => e.requestId === request.id).map((e) => e.type);
  assert.deepEqual(ev, ["SUBMITTED", "APPROVED"]);
});

test("S03 request changes / reject require a note; with a note they record the decision", async () => {
  const { service } = setup();
  const a = (await service.submit(clientActor, { ptUserId: PT })).request;
  await rejects(service.requestChanges(ptActor, a.id, { note: "  " }), 400, "NOTE_REQUIRED");
  await rejects(service.reject(ptActor, a.id, {}), 400, "NOTE_REQUIRED");
  await rejects(service.approve(ptActor, a.id, { note: "x".repeat(1001) }), 400, "NOTE_TOO_LONG");
  const res = await service.requestChanges(ptActor, a.id, { note: "Thêm bài vai" });
  assert.equal(res.request.status, "CHANGES_REQUESTED");
  assert.equal(res.request.decisionNote, "Thêm bài vai");
  assert.equal(res.request.effectiveState, "CHANGES_REQUESTED");

  const b = setup();
  const r2 = (await b.service.submit(clientActor, { ptUserId: PT })).request;
  const rej = await b.service.reject(ptActor, r2.id, { note: "Không an toàn" });
  assert.equal(rej.request.status, "REJECTED");
  assert.equal(rej.request.legacyPtReviewStatus, "PT_REJECTED");
});

test("S04 PT open: PENDING_REVIEW -> IN_REVIEW, idempotent, and the PT can still decide afterwards", async () => {
  const { service } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  assert.equal((await service.start(ptActor, request.id)).status, "IN_REVIEW");
  assert.equal((await service.start(ptActor, request.id)).status, "IN_REVIEW");
  assert.equal((await service.approve(ptActor, request.id)).request.status, "APPROVED");
});

// ── plan identity & version ────────────────────────────────────────────────

test("S05 identity: editing the plan keeps the logical planId; resubmitting supersedes the old request, never reuses its approval", async () => {
  const { service, state, repo } = setup();
  const first = (await service.submit(clientActor, { ptUserId: PT })).request;
  state.programs.set(CLIENT, makeProgram("prog-1", 12, 2)); // same program id, edited content
  const second = (await service.submit(clientActor, { ptUserId: PT })).request;
  assert.equal(second.subjectId, first.subjectId, "logical planId unchanged — no 'Plan A.1'");
  assert.notEqual(second.contentHash, first.contentHash);
  assert.equal((await repo.findById(first.id))!.status, "SUPERSEDED");
  assert.equal(second.status, "PENDING_REVIEW");
  assert.equal(repo.requests.size, 2, "no duplicate plan rows — only review requests");
});

test("S06 an approval does not survive a later edit (effective state recomputed at read time)", async () => {
  const { service, state } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  await service.approve(ptActor, request.id);
  assert.equal((await service.get(clientActor, request.id)).effectiveState, "APPROVED_CURRENT");
  state.programs.set(CLIENT, makeProgram("prog-1", 15, 2));
  const after = await service.get(clientActor, request.id);
  assert.equal(after.status, "APPROVED", "the historical decision is immutable…");
  assert.equal(after.effectiveState, "APPROVED_OUTDATED", "…but it is no longer in force for the edited plan");
  assert.equal(after.isOutdated, true);
  const summary: any = await service.summary(clientActor);
  assert.equal(summary.currentPlan.latestReview.effectiveState, "APPROVED_OUTDATED");
});

test("S07 completed workout data is untouched: the service never reads or writes schedules/logs (snapshot = prescription only)", async () => {
  const { service } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const text = JSON.stringify(request.snapshot);
  for (const key of ["schedules", "workout", "logs", "sets_completed", "inbody", "profile"]) assert.ok(!text.includes(key));
});

// ── authorization ──────────────────────────────────────────────────────────

test("S08 wrong PT / wrong client get 404 (no IDOR enumeration) on get, events, decision and cancel", async () => {
  const { service } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const otherPt = { id: PT2, role: "PT" };
  const otherClient = { id: CLIENT2, role: "CUSTOMER" };
  await rejects(service.get(otherPt, request.id), 404, "NOT_FOUND");
  await rejects(service.events(otherPt, request.id), 404, "NOT_FOUND");
  await rejects(service.approve(otherPt, request.id), 404, "NOT_FOUND");
  await rejects(service.start(otherPt, request.id), 404, "NOT_FOUND");
  await rejects(service.get(otherClient, request.id), 404, "NOT_FOUND");
  await rejects(service.events(otherClient, request.id), 404, "NOT_FOUND");
  await rejects(service.cancel(otherClient, request.id), 404, "NOT_FOUND");
  await rejects(service.get(ptActor, "does-not-exist"), 404, "NOT_FOUND");
});

test("S09 submit needs an ACTIVE contract with THAT pt; self-review is refused", async () => {
  const { service, contracts } = setup();
  await rejects(service.submit({ id: CLIENT2, role: "CUSTOMER" }, { ptUserId: PT }), 403, "NO_ACTIVE_CONTRACT");
  await rejects(service.submit(clientActor, { ptUserId: CLIENT }), 400, "SELF_REVIEW");
  contracts.get(PT)!.delete(CLIENT); // contract expired
  await rejects(service.submit(clientActor, { ptUserId: PT }), 403, "NO_ACTIVE_CONTRACT");
});

test("S10 contract ends after submit: PT loses access, open request becomes ACCESS_REVOKED, no snapshot is exposed", async () => {
  const { service, contracts, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  contracts.get(PT)!.delete(CLIENT);
  await rejects(service.get(ptActor, request.id), 403, "NO_ACTIVE_CONTRACT");
  assert.equal((await repo.findById(request.id))!.status, "ACCESS_REVOKED");
  await rejects(service.approve(ptActor, request.id), 403, "NO_ACTIVE_CONTRACT");
  const inbox = await service.listInbox(ptActor);
  assert.equal(inbox.length, 0);
  const ev = repo.events.filter((e) => e.requestId === request.id).map((e) => e.type);
  assert.ok(ev.includes("ACCESS_REVOKED"));
  // the client still sees their own history, with the revoked state
  assert.equal((await service.get(clientActor, request.id)).status, "ACCESS_REVOKED");
});

test("S11 fail closed: an unreadable contract roster is 503 everywhere and never revokes or approves anything", async () => {
  const { service, state, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  state.rosterDown = true;
  await rejects(service.submit(clientActor, { ptUserId: PT }), 503, "AUTH_DEPENDENCY_UNAVAILABLE");
  await rejects(service.get(ptActor, request.id), 503, "AUTH_DEPENDENCY_UNAVAILABLE");
  await rejects(service.approve(ptActor, request.id), 503, "AUTH_DEPENDENCY_UNAVAILABLE");
  await rejects(service.listInbox(ptActor), 503, "AUTH_DEPENDENCY_UNAVAILABLE");
  await rejects(service.summary(ptActor), 503, "AUTH_DEPENDENCY_UNAVAILABLE");
  assert.equal((await repo.findById(request.id))!.status, "PENDING_REVIEW", "an outage must not read as 'contract ended'");
  state.rosterDown = false;
  assert.equal((await service.approve(ptActor, request.id)).request.status, "APPROVED");
});

test("S12 a non-PT role can never decide, even for a request addressed to their own id", async () => {
  const { service } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const impostor = { id: PT, role: "CUSTOMER" };
  await rejects(service.approve(impostor, request.id), 403, "ROLE_NOT_ALLOWED");
  await rejects(service.reject(impostor, request.id, { note: "x y z" }), 403, "ROLE_NOT_ALLOWED");
  await rejects(service.start(impostor, request.id), 403, "ROLE_NOT_ALLOWED");
  await rejects(service.listInbox(impostor), 403, "ROLE_NOT_ALLOWED");
});

// ── stale revision / double submit / concurrency ───────────────────────────

test("S13 stale revision on submit and on decision (client edited after submit → request superseded, decision refused)", async () => {
  const { service, state, repo } = setup();
  await rejects(service.submit(clientActor, { ptUserId: PT, expectedContentHash: "0".repeat(64) }), 409, "STALE_REVISION");
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  await rejects(service.approve(ptActor, request.id, { expectedContentHash: "f".repeat(64) }), 409, "STALE_REVISION");
  await rejects(service.approve(ptActor, request.id, { expectedRevision: 99 }), 409, "CONCURRENT_MODIFICATION");
  state.programs.set(CLIENT, makeProgram("prog-1", 20, 2));
  await rejects(service.approve(ptActor, request.id), 409, "REVISION_OUTDATED");
  assert.equal((await repo.findById(request.id))!.status, "SUPERSEDED");
});

test("S14 double submit and idempotency key: one request; reusing a key for another PT is refused", async () => {
  const { service, repo } = setup();
  const a = await service.submit(clientActor, { ptUserId: PT, idempotencyKey: "key-12345678" });
  const b = await service.submit(clientActor, { ptUserId: PT, idempotencyKey: "key-12345678" });
  const c = await service.submit(clientActor, { ptUserId: PT }); // no key, same content, open request exists
  assert.equal(b.replayed, true);
  assert.equal(c.replayed, true);
  assert.equal(a.request.id, b.request.id);
  assert.equal(a.request.id, c.request.id);
  assert.equal(repo.requests.size, 1);
  await rejects(service.submit(clientActor, { ptUserId: PT2, idempotencyKey: "key-12345678" }), 409, "IDEMPOTENCY_KEY_REUSED");
  await rejects(service.submit(clientActor, { ptUserId: PT2 }), 409, "OPEN_REQUEST_WITH_OTHER_PT");
});

test("S15 concurrency: simultaneous double-submit (two devices) creates exactly one request", async () => {
  const { service, repo } = setup();
  const results = await Promise.allSettled([
    service.submit(clientActor, { ptUserId: PT, idempotencyKey: "dev-a-12345678" }),
    service.submit(clientActor, { ptUserId: PT, idempotencyKey: "dev-b-12345678" }),
    service.submit(clientActor, { ptUserId: PT }),
  ]);
  assert.equal(repo.requests.size, 1);
  assert.ok(results.every((r) => r.status === "fulfilled"), JSON.stringify(results.map((r) => (r as any).reason)));
  const ids = new Set(results.map((r) => (r as any).value.request.id));
  assert.equal(ids.size, 1);
});

test("S16 concurrency: PT approve vs reject at the same instant — exactly one decision wins, one audit event, no flip-flop", async () => {
  const { service, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const [a, r] = await Promise.allSettled([
    service.approve(ptActor, request.id, { expectedRevision: 1 }),
    service.reject(ptActor, request.id, { note: "không ổn", expectedRevision: 1 }),
  ]);
  const winners = [a, r].filter((x) => x.status === "fulfilled");
  assert.equal(winners.length, 1);
  const loser: any = [a, r].find((x) => x.status === "rejected");
  assert.equal(loser.reason.code, "CONCURRENT_MODIFICATION");
  const decisions = repo.events.filter((e) => e.requestId === request.id && ["APPROVED", "REJECTED"].includes(e.type));
  assert.equal(decisions.length, 1);
  assert.equal((await repo.findById(request.id))!.status, decisions[0].type);
});

test("S17 decision replay is idempotent (retry / double click); a different decision after the first is refused", async () => {
  const { service, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const first = await service.approve(ptActor, request.id);
  const again = await service.approve(ptActor, request.id);
  assert.equal(first.replayed, false);
  assert.equal(again.replayed, true);
  await rejects(service.reject(ptActor, request.id, { note: "đổi ý nhé" }), 409, "ILLEGAL_TRANSITION");
  assert.equal(repo.events.filter((e) => e.requestId === request.id && e.type === "APPROVED").length, 1);
});

test("S18 client cancel: pending cancel works (idempotent) and blocks later decisions; cancel after a decision is refused", async () => {
  const { service, repo } = setup();
  const a = (await service.submit(clientActor, { ptUserId: PT })).request;
  assert.equal((await service.cancel(clientActor, a.id)).request.status, "CANCELLED");
  assert.equal((await service.cancel(clientActor, a.id)).replayed, true);
  await rejects(service.approve(ptActor, a.id), 409, "ILLEGAL_TRANSITION");
  assert.equal(repo.events.filter((e) => e.requestId === a.id && e.type === "CANCELLED").length, 1);

  const b = (await service.submit(clientActor, { ptUserId: PT })).request; // a new request is possible after cancel
  await service.approve(ptActor, b.id);
  await rejects(service.cancel(clientActor, b.id), 409, "ILLEGAL_TRANSITION");
});

// ── transaction failure / event retry ──────────────────────────────────────

test("S19 transaction failure: a failed write changes nothing (no state, no event); the retry succeeds", async () => {
  const { service, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const eventsBefore = repo.events.length;
  repo.failNextWriteWith = new Error("db connection lost");
  await assert.rejects(service.approve(ptActor, request.id), /db connection lost/);
  assert.equal((await repo.findById(request.id))!.status, "PENDING_REVIEW");
  assert.equal(repo.events.length, eventsBefore, "no orphan event for a state that never happened");
  assert.equal((await service.approve(ptActor, request.id)).request.status, "APPROVED");

  // same for submit: a failed create must not leave a half-superseded older request behind
  const t = setup();
  const first = (await t.service.submit(clientActor, { ptUserId: PT })).request;
  t.state.programs.set(CLIENT, makeProgram("prog-1", 30, 2));
  t.repo.failNextWriteWith = new Error("db down");
  await assert.rejects(t.service.submit(clientActor, { ptUserId: PT }), /db down/);
  assert.equal((await t.repo.findById(first.id))!.status, "PENDING_REVIEW", "old request must not be superseded by a failed submit");
});

test("S20 outbox: failed delivery stays pending and is retried exactly once; text never contains plan contents or notes", async () => {
  const { service, state, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT, clientNote: "bí mật chấn thương gối" });
  await service.requestChanges(ptActor, request.id, { note: "ghi chú riêng của PT" });
  state.notifyFails = true;
  const failed = await service.dispatchPendingNotifications();
  assert.equal(failed.delivered, 0);
  assert.equal(repo.events.filter((e) => e.notifyUserId && !e.notifiedAt).length, 2, "both events still pending after the failure");
  state.notifyFails = false;
  const ok = await service.dispatchPendingNotifications();
  assert.equal(ok.delivered, 2);
  const again = await service.dispatchPendingNotifications();
  assert.equal(again.delivered, 0, "idempotent: nothing is delivered twice");
  assert.deepEqual(state.notifyCalls.map((c) => c.userId).sort(), [CLIENT, PT].sort());
  for (const c of state.notifyCalls) {
    assert.ok(!/chấn thương|gối|ghi chú riêng|Bench|Squat/i.test(c.text), `leaky notification: ${c.text}`);
  }
});

// ── sync / cross-service ───────────────────────────────────────────────────

test("S21 multi-device sync: the backend is the source of truth — two devices read the same state after each action", async () => {
  const { service } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const web = () => service.listMine(clientActor);
  const mobile = () => service.summary(clientActor) as Promise<any>;
  assert.equal((await web())[0].status, "PENDING_REVIEW");
  assert.equal((await mobile()).currentPlan.latestReview.status, "PENDING_REVIEW");
  await service.approve(ptActor, request.id);
  assert.equal((await web())[0].status, "APPROVED");
  assert.equal((await mobile()).currentPlan.latestReview.effectiveState, "APPROVED_CURRENT");
  assert.deepEqual((await service.summary(ptActor) as any).pending, 0);
});

test("S22 AI plan vs current WorkoutProgram: reviews bind to the program, not the AI plan; no current program => 404; stale programId => 409", async () => {
  const { service, state } = setup();
  await rejects(service.submit(clientActor, { ptUserId: PT, programId: "11111111-1111-4111-8111-111111111111" }), 409, "PROGRAM_NOT_CURRENT");
  state.programs.set(CLIENT, null);
  await rejects(service.submit(clientActor, { ptUserId: PT }), 404, "NO_CURRENT_PROGRAM");
});

test("S23 cross-service race: the AI adjusts the plan (new current program) while the PT is deciding — the decision is refused, not applied to the wrong plan", async () => {
  const { service, state, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  const decide = service.approve(ptActor, request.id); // PT clicks approve…
  state.programs.set(CLIENT, makeProgram("prog-NEW")); // …while ai-service replaced the current program
  const res = await Promise.allSettled([decide]);
  // Either ordering is safe: the approval is only valid if it still matches what is current.
  const status = (await repo.findById(request.id))!.status;
  if (res[0].status === "fulfilled") {
    assert.equal(status, "APPROVED"); // decided before the swap: the historical decision stands, effective state shows it is outdated
    assert.equal((await service.get(clientActor, request.id)).effectiveState, "APPROVED_OUTDATED");
  } else {
    assert.equal(status, "SUPERSEDED");
  }
  // And a decision attempted AFTER the swap is always refused:
  const t = setup();
  const r2 = (await t.service.submit(clientActor, { ptUserId: PT })).request;
  t.state.programs.set(CLIENT, makeProgram("prog-NEW"));
  await rejects(t.service.approve(ptActor, r2.id), 409, "REVISION_OUTDATED");
});

test("S24 inbox/summary only expose verified clients and never leak the snapshot in list views", async () => {
  const { service, contracts } = setup();
  await service.submit(clientActor, { ptUserId: PT });
  await service.submit({ id: CLIENT2, role: "CUSTOMER" }, { ptUserId: PT2 });
  const inbox = await service.listInbox(ptActor);
  assert.equal(inbox.length, 1);
  assert.equal(inbox[0].clientUserId, CLIENT);
  assert.ok(!("snapshot" in inbox[0]), "list views carry no plan snapshot");
  assert.ok(!("idempotencyKey" in inbox[0]));
  assert.equal(((await service.summary(ptActor)) as any).pending, 1);
  contracts.get(PT)!.delete(CLIENT);
  assert.equal(((await service.summary(ptActor)) as any).pending, 0);
});

// ── monotonic version (Phase 2): hash alone is never the identity of a reviewed plan ───────────────

test("S25 A -> B -> A: an approved plan edited away and back (same hash, newer version) is NOT approved any more", async () => {
  const { service, state, repo } = setup();
  const first = (await service.submit(clientActor, { ptUserId: PT })).request; // plan A @ v1
  await service.approve(ptActor, first.id);
  assert.equal((await service.get(clientActor, first.id)).effectiveState, "APPROVED_CURRENT");

  state.programs.set(CLIENT, makeProgram("prog-1", 12, 2)); // B @ v2
  assert.equal((await service.get(clientActor, first.id)).effectiveState, "APPROVED_OUTDATED");
  state.programs.set(CLIENT, makeProgram("prog-1", 10, 3)); // back to A's exact content, but @ v3
  const view = await service.get(clientActor, first.id);
  assert.equal(view.contentHash, (await service.get(clientActor, first.id)).contentHash);
  assert.equal(view.effectiveState, "APPROVED_OUTDATED", "same hash as the approved plan, but it passed through an unreviewed version");
  assert.equal(view.isOutdated, true);
  assert.equal(view.subjectVersion, 1);

  // Re-submitting is a NEW request bound to v3 (the old approval is history, not a reusable authorization).
  const again = (await service.submit(clientActor, { ptUserId: PT })).request;
  assert.notEqual(again.id, first.id);
  assert.equal(again.subjectVersion, 3);
  assert.equal(again.contentHash, first.contentHash, "same content…");
  assert.equal((await service.get(clientActor, first.id)).effectiveState, "APPROVED_OUTDATED", "…yet the v1 approval never revives");
  assert.equal(repo.requests.size, 2);
});

test("S26 A -> B -> A on an OPEN request: the PT cannot approve it; resubmitting supersedes instead of replaying", async () => {
  const { service, state, repo } = setup();
  const first = (await service.submit(clientActor, { ptUserId: PT })).request; // A @ v1
  state.programs.set(CLIENT, makeProgram("prog-1", 12, 2)); // B
  state.programs.set(CLIENT, makeProgram("prog-1", 10, 3)); // A again
  await rejects(service.approve(ptActor, first.id), 409, "REVISION_OUTDATED");
  assert.equal((await repo.findById(first.id))!.status, "SUPERSEDED");

  const t = setup();
  const open = (await t.service.submit(clientActor, { ptUserId: PT })).request;
  t.state.programs.set(CLIENT, makeProgram("prog-1", 10, 4)); // identical content, newer version
  const res = await t.service.submit(clientActor, { ptUserId: PT });
  assert.equal(res.replayed, false, "not a replay: the version moved");
  assert.notEqual(res.request.id, open.id);
  assert.equal((await t.repo.findById(open.id))!.status, "SUPERSEDED");
});

test("S27 atomic approval guard: a plan edit that lands between the pre-check and the commit makes the approval fail and write nothing", async () => {
  const { service, state, repo } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  // The service's read still sees v1 (so the pre-check passes) but the locked row read inside the transaction already says v2.
  repo.subjectVersionOf = () => 2;
  await rejects(service.approve(ptActor, request.id), 409, "REVISION_OUTDATED");
  const row = (await repo.findById(request.id))!;
  assert.notEqual(row.status, "APPROVED", "never approved on a plan that moved");
  assert.equal(row.status, "SUPERSEDED");
  assert.ok(!repo.events.some((e) => e.requestId === request.id && e.type === "APPROVED"), "no APPROVED audit event");
  void state;
});

test("S28 expectedVersion (AI-chat confirmation card): a plan that moved since the preview is refused with 409 and nothing is created", async () => {
  const { service, state, repo } = setup();
  state.programs.set(CLIENT, makeProgram("prog-1", 12, 4)); // the plan is now v4
  await rejects(service.submit(clientActor, { ptUserId: PT, expectedVersion: 3 }), 409, "STALE_REVISION");
  assert.equal(repo.requests.size, 0, "nothing was sent");
  const ok = await service.submit(clientActor, { ptUserId: PT, expectedVersion: 4 });
  assert.equal(ok.request.subjectVersion, 4);
  assert.equal(repo.requests.size, 1);
});

test("S29 notification contract: PT gets REQUESTED, client gets DECIDED; one stable dedupeKey per outbox event; retry reuses the SAME key", async () => {
  const { service, state } = setup();
  const { request } = await service.submit(clientActor, { ptUserId: PT });
  await service.approve(ptActor, request.id, { note: "ok" });
  state.notifyFails = true;
  await service.dispatchPendingNotifications();
  state.notifyFails = false;
  await service.dispatchPendingNotifications();
  const byUser = Object.fromEntries(state.notifyCalls.map((c) => [c.userId, c]));
  assert.equal(byUser[PT].kind, "REQUESTED");
  assert.equal(byUser[PT].link, "/pt/plan-reviews");
  assert.equal(byUser[CLIENT].kind, "DECIDED");
  assert.equal(byUser[CLIENT].link, "/client/training");
  assert.equal(new Set(state.notifyCalls.map((c) => c.dedupeKey)).size, 2, "one key per event");
  for (const c of state.notifyCalls) assert.match(c.dedupeKey, /^plan-review-event:[0-9a-f-]{36}$/);
});

test("S30 an event whose delivery succeeded but could not be marked is re-sent with the SAME dedupeKey (user-service collapses it)", async () => {
  const { service, state, repo } = setup();
  await service.submit(clientActor, { ptUserId: PT });
  await service.dispatchPendingNotifications();
  const sent = state.notifyCalls[0];
  // simulate the crash between "delivered" and "marked delivered"
  for (const e of repo.events) e.notifiedAt = null;
  await service.dispatchPendingNotifications();
  assert.equal(state.notifyCalls.length, 2);
  assert.equal(state.notifyCalls[1].dedupeKey, sent.dedupeKey, "same key => at-least-once without duplicate rows downstream");
});
