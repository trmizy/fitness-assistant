import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

/**
 * Workout Plan Review & Approval — Postgres-backed repository guarantees (BACKEND INTEGRATION once run).
 * Skipped, NOT failed, without an isolated test database (repo convention: URL must match *_test / postgres-test).
 * Requires the migration 20261119100000_add_plan_review applied to that TEST database (never to AWS).
 *
 * What only a real DB can prove (the in-memory twin in plan-review.service.test.ts mirrors these but cannot verify them):
 *  - the PARTIAL unique index allows exactly one open request per (client, plan) under a real race;
 *  - unique (client, idempotencyKey);
 *  - conditional UPDATE (status + revision) really lets one of two concurrent writers win;
 *  - request state and its audit event are committed in one transaction (rollback leaves neither).
 */
const url = process.env.FITNESS_DATABASE_URL || process.env.DATABASE_URL || "";
const canUseIntegrationDb = /(_test|postgres-test)/i.test(url);
if (process.env.FITNESS_DATABASE_URL) process.env.DATABASE_URL = process.env.FITNESS_DATABASE_URL;
const skipOpts = { skip: canUseIntegrationDb ? false : "Requires FITNESS_DATABASE_URL or DATABASE_URL pointing at a test database.", timeout: 90_000 };

const RUN = randomUUID().slice(0, 8);
const CLIENT = `pr-client-${RUN}`, PT = `pr-pt-${RUN}`;
let repo: (typeof import("../services/plan-review/plan-review.prisma-repository"))["prismaPlanReviewRepository"];
let prisma: (typeof import("../repositories/prisma"))["prisma"];
let UniqueViolation: (typeof import("../services/plan-review/plan-review.types"))["PlanReviewUniqueViolation"];

const submitted = (hash: string) => ({
  type: "SUBMITTED", actorUserId: CLIENT, actorRole: "CLIENT" as const, fromStatus: null, toStatus: "PENDING_REVIEW" as const, contentHash: hash, notifyUserId: PT,
});
const data = (subjectId: string, hash: string, key: string | null = null) => ({
  clientUserId: CLIENT, ptUserId: PT, subjectId, subjectVersion: 1, contentHash: hash, sourcePlanId: null, aiPlanVersion: null,
  snapshot: { programId: subjectId }, idempotencyKey: key, clientNote: null,
});

test.before(async () => {
  if (!canUseIntegrationDb) return;
  prisma = (await import("../repositories/prisma")).prisma;
  repo = (await import("../services/plan-review/plan-review.prisma-repository")).prismaPlanReviewRepository;
  UniqueViolation = (await import("../services/plan-review/plan-review.types")).PlanReviewUniqueViolation;
});
test.after(async () => {
  if (!canUseIntegrationDb) return;
  await prisma.planReviewRequest.deleteMany({ where: { clientUserId: CLIENT } }); // events cascade
  await prisma.$disconnect();
});

test("DB01 partial unique index: a second open request for the same plan is rejected (also under a real race)", skipOpts, async () => {
  const subject = randomUUID();
  const results = await Promise.allSettled([
    repo.createSubmission({ data: data(subject, "a".repeat(64)), submittedEvent: submitted("a".repeat(64)) }),
    repo.createSubmission({ data: data(subject, "b".repeat(64)), submittedEvent: submitted("b".repeat(64)) }),
  ]);
  assert.equal(results.filter((r) => r.status === "fulfilled").length, 1);
  const lost: any = results.find((r) => r.status === "rejected");
  assert.ok(lost.reason instanceof UniqueViolation);
  assert.equal(await prisma.planReviewRequest.count({ where: { clientUserId: CLIENT, subjectId: subject } }), 1);
});

test("DB02 idempotency key is unique per client", skipOpts, async () => {
  const key = `key-${RUN}-12345`;
  await repo.createSubmission({ data: data(randomUUID(), "c".repeat(64), key), submittedEvent: submitted("c".repeat(64)) });
  await assert.rejects(
    repo.createSubmission({ data: data(randomUUID(), "d".repeat(64), key), submittedEvent: submitted("d".repeat(64)) }),
    (e: any) => e instanceof UniqueViolation && e.target === "IDEMPOTENCY_KEY",
  );
});

test("DB03 conditional transition: two concurrent decisions => exactly one winner, one event, revision incremented once", skipOpts, async () => {
  const created = await repo.createSubmission({ data: data(randomUUID(), "e".repeat(64)), submittedEvent: submitted("e".repeat(64)) });
  const decide = (to: "APPROVED" | "REJECTED") =>
    repo.transition({
      id: created.id, fromStatuses: ["PENDING_REVIEW", "IN_REVIEW"], expectedRevision: created.revision, toStatus: to,
      event: { type: to, actorUserId: PT, actorRole: "PT", fromStatus: "PENDING_REVIEW", toStatus: to, contentHash: created.contentHash },
    });
  const [a, b] = await Promise.all([decide("APPROVED"), decide("REJECTED")]);
  assert.equal([a, b].filter(Boolean).length, 1, "exactly one writer wins");
  const row = await prisma.planReviewRequest.findUnique({ where: { id: created.id }, include: { events: true } });
  assert.equal(row!.revision, created.revision + 1);
  assert.equal(row!.events.filter((e) => e.type !== "SUBMITTED").length, 1);
});

test("DB04 supersede + create is one transaction: if the older request moved, nothing is created", skipOpts, async () => {
  const subject = randomUUID();
  const first = await repo.createSubmission({ data: data(subject, "1".repeat(64)), submittedEvent: submitted("1".repeat(64)) });
  await assert.rejects(
    repo.createSubmission({
      data: data(subject, "2".repeat(64)),
      submittedEvent: submitted("2".repeat(64)),
      supersede: { id: first.id, expectedRevision: first.revision + 5, event: { type: "SUPERSEDED", actorUserId: CLIENT, actorRole: "CLIENT", fromStatus: "PENDING_REVIEW", toStatus: "SUPERSEDED", contentHash: first.contentHash } },
    }),
    UniqueViolation,
  );
  assert.equal(await prisma.planReviewRequest.count({ where: { clientUserId: CLIENT, subjectId: subject } }), 1);
  assert.equal((await prisma.planReviewRequest.findUnique({ where: { id: first.id } }))!.status, "PENDING_REVIEW");
});
