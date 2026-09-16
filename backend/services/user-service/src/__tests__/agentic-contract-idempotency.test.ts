import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { agenticFitnessService } from "../services/agentic-fitness.service";
import { prisma } from "../repositories/profile.repository";

/**
 * DB-backed idempotency evidence for PT contract automation — named a
 * BLOCKED item in Codex's independent evaluation
 * (docs/codex-ai-agent-evaluation-report.md §15/§21: "duplicate contract
 * confirmation ... Code inspection found the expected mechanisms
 * (agentActionId, deterministic draft id, advisory locks), but this
 * evaluator did not run DB-backed duplicate-write tests."). This is that
 * DB-backed test, against real Contract/PTServicePackage/UserProfile rows
 * (not the existing regression suite's DB-free CompleteContractDeps stubs
 * — this specifically exercises the real Prisma writes and the real
 * advisory-lock transaction in agenticFitnessService.confirmDraft).
 *
 * Real DB (not the CompleteContractDeps-stubbed unit style used
 * elsewhere) — creates and tears down its own isolated PT/client/package
 * rows so it never touches unrelated data.
 */

async function seedRealPt(id: string) {
  await prisma.userProfile.create({
    data: {
      userId: id, firstName: "Idem", lastName: "PT", email: `${id}@test.gymini.invalid`,
      isPT: true, ptSuspended: false, isAcceptingClients: true, dataOrigin: "REAL",
      specialties: ["Giảm mỡ"],
    },
  });
  const profile = await prisma.userProfile.findUniqueOrThrow({ where: { userId: id }, select: { id: true } });
  await prisma.pTApplication.create({
    data: { userProfileId: profile.id, status: "APPROVED", approvedAt: new Date(), yearsOfExperience: "3", languages: ["vi"], mainSpecialties: ["Giảm mỡ"], targetClientGroups: [] },
  });
  const pkg = await prisma.pTServicePackage.create({
    data: { ptUserId: id, name: "10 buổi test", sessionCount: 10, price: 1_500_000, sessionMode: "OFFLINE", sessionDurationMinutes: 60, isActive: true },
  });
  const days = ["MONDAY", "WEDNESDAY", "FRIDAY"] as const;
  for (const day of days) {
    await prisma.pTAvailability.create({ data: { ptUserId: id, dayOfWeek: day, startTime: "08:00", endTime: "20:00", isActive: true } });
  }
  return { ptId: id, packageId: pkg.id };
}

async function seedRealClient(id: string) {
  await prisma.userProfile.create({
    data: {
      userId: id, firstName: "Idem", lastName: "Client", email: `${id}@test.gymini.invalid`,
      isPT: false, dataOrigin: "REAL", goal: "WEIGHT_LOSS", experienceLevel: "BEGINNER",
      preferredTrainingDays: [1, 3, 5], ptBudgetVnd: 2_000_000, sessionDurationMinutes: 60,
    },
  });
  return id;
}

async function cleanup(ptId: string, clientId: string) {
  const contracts = await prisma.contract.findMany({ where: { ptUserId: ptId }, select: { id: true } });
  const contractIds = contracts.map((c) => c.id);
  await prisma.sessionReview.deleteMany({ where: { contractId: { in: contractIds } } }).catch(() => {});
  await prisma.session.deleteMany({ where: { contractId: { in: contractIds } } }).catch(() => {});
  await prisma.agentContractDraft.deleteMany({ where: { OR: [{ userId: clientId }, { ptId }] } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { ptUserId: ptId } });
  await prisma.pTServicePackage.deleteMany({ where: { ptUserId: ptId } });
  await prisma.pTAvailability.deleteMany({ where: { ptUserId: ptId } });
  const ptProfile = await prisma.userProfile.findUnique({ where: { userId: ptId }, select: { id: true } });
  if (ptProfile) await prisma.pTApplication.deleteMany({ where: { userProfileId: ptProfile.id } });
  await prisma.userProfile.deleteMany({ where: { userId: { in: [ptId, clientId] } } });
}

test.after(async () => {
  await prisma.$disconnect();
});

test("agenticFitnessService: confirming the same draft twice creates exactly one Contract, never two", async () => {
  const ptId = `idem-pt-${randomUUID()}`;
  const clientId = `idem-client-${randomUUID()}`;
  const actionId = `idem-action-${randomUUID()}`;
  const { packageId } = await seedRealPt(ptId);
  await seedRealClient(clientId);
  try {
    const preferences = { goal: "WEIGHT_LOSS" as const, days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 2_000_000, demo: false };
    const draft1 = await agenticFitnessService.createDraft(clientId, ptId, packageId, preferences, actionId);
    const draft2 = await agenticFitnessService.createDraft(clientId, ptId, packageId, preferences, actionId);
    assert.equal(draft1.id, draft2.id, "same actionId must produce the exact same deterministic draft id");

    const confirm1 = await agenticFitnessService.confirmDraft(clientId, draft1.id, true);
    const confirm2 = await agenticFitnessService.confirmDraft(clientId, draft1.id, true);
    assert.equal(confirm1.contractId, confirm2.contractId, "confirming the same draft twice must return the SAME contract id, not create a second one");

    const contracts = await prisma.contract.findMany({ where: { ptUserId: ptId, clientUserId: clientId } });
    assert.equal(contracts.length, 1, `expected exactly 1 Contract row after double-confirm, found ${contracts.length}`);
    assert.equal(contracts[0].agentActionId, draft1.id);
  } finally {
    await cleanup(ptId, clientId);
  }
});

test("agenticFitnessService: two DIFFERENT actionIds for the same PT/package create two real, independent drafts (not falsely deduped)", async () => {
  const ptId = `idem-pt-${randomUUID()}`;
  const clientId = `idem-client-${randomUUID()}`;
  const { packageId } = await seedRealPt(ptId);
  await seedRealClient(clientId);
  try {
    const preferences = { goal: "WEIGHT_LOSS" as const, days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 2_000_000, demo: false };
    const draftA = await agenticFitnessService.createDraft(clientId, ptId, packageId, preferences, `idem-action-a-${randomUUID()}`);
    const draftB = await agenticFitnessService.createDraft(clientId, ptId, packageId, preferences, `idem-action-b-${randomUUID()}`);
    assert.notEqual(draftA.id, draftB.id, "different actionIds must produce different draft ids — dedup is keyed by actionId, not by PT+package alone");
  } finally {
    await cleanup(ptId, clientId);
  }
});

// ── Stale-state tests (P1, Codex Regression #2 §10: "Stale PT: NOT
// MEASURED", "Stale package: NOT MEASURED", "Stale availability: NOT
// MEASURED"). Each scenario creates a real draft against real eligible
// state, then mutates that real state before confirming — proving
// `confirmDraft`'s real re-validation (`this.candidates(...)` re-run at
// confirm time) actually rejects the stale confirmation with no Contract
// row written, using the same eligibility-recompute path production
// traffic goes through, not a test-only stub.

test("agenticFitnessService: PT stops accepting clients between draft and confirm -> confirm is rejected, no Contract row", async () => {
  const ptId = `idem-pt-${randomUUID()}`;
  const clientId = `idem-client-${randomUUID()}`;
  const actionId = `idem-stale-pt-${randomUUID()}`;
  const { packageId } = await seedRealPt(ptId);
  await seedRealClient(clientId);
  try {
    const preferences = { goal: "WEIGHT_LOSS" as const, days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 2_000_000, demo: false };
    const draft = await agenticFitnessService.createDraft(clientId, ptId, packageId, preferences, actionId);

    // Real state mutation: the PT closes their books after the draft was
    // proposed but before the user confirms.
    await prisma.userProfile.update({ where: { userId: ptId }, data: { isAcceptingClients: false } });

    await assert.rejects(
      () => agenticFitnessService.confirmDraft(clientId, draft.id, true),
      (err: any) => {
        assert.equal(err.status, 409, `expected 409, got ${err.status}: ${err.message}`);
        return true;
      },
      "confirming after the PT stopped accepting clients must be rejected",
    );

    const contracts = await prisma.contract.findMany({ where: { ptUserId: ptId, clientUserId: clientId } });
    assert.equal(contracts.length, 0, "a rejected stale-PT confirm must leave zero Contract rows — no partial write");
  } finally {
    await cleanup(ptId, clientId);
  }
});

test("agenticFitnessService: package is archived between draft and confirm -> confirm is rejected, no Contract row", async () => {
  const ptId = `idem-pt-${randomUUID()}`;
  const clientId = `idem-client-${randomUUID()}`;
  const actionId = `idem-stale-package-${randomUUID()}`;
  const { packageId } = await seedRealPt(ptId);
  await seedRealClient(clientId);
  try {
    const preferences = { goal: "WEIGHT_LOSS" as const, days: [1, 3, 5], sessionMinutes: 60, budgetVnd: 2_000_000, demo: false };
    const draft = await agenticFitnessService.createDraft(clientId, ptId, packageId, preferences, actionId);

    // Real state mutation: the PT archives the package (e.g. repricing,
    // discontinuing it) after the draft was proposed but before confirm —
    // the same soft-delete real PTServicePackage.archivedAt the product's
    // own package-management UI sets.
    await prisma.pTServicePackage.update({ where: { id: packageId }, data: { archivedAt: new Date(), isActive: false } });

    await assert.rejects(
      () => agenticFitnessService.confirmDraft(clientId, draft.id, true),
      (err: any) => {
        assert.equal(err.status, 409, `expected 409, got ${err.status}: ${err.message}`);
        return true;
      },
      "confirming after the package was archived must be rejected",
    );

    const contracts = await prisma.contract.findMany({ where: { ptUserId: ptId, clientUserId: clientId } });
    assert.equal(contracts.length, 0, "a rejected stale-package confirm must leave zero Contract rows — no partial write");
  } finally {
    await cleanup(ptId, clientId);
  }
});
