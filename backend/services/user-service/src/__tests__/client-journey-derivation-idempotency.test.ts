import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { deriveForCompletedContract } from "../services/client-journey-derivation.service";
import { prisma } from "../repositories/profile.repository";

/**
 * ADV-006 (docs/ai-agent-adversarial-findings.md, hardening pass #2):
 * "same completed contract derivation invoked twice -> exactly 1
 * ClientJourney" was previously proven only by code inspection
 * (findFirst-before-create). This is the real DB-backed proof, for both
 * the sequential and the CONCURRENT case — the concurrent case is the one
 * a plain findFirst-then-create genuinely cannot protect against, and is
 * only safe now because of the DB-level unique constraint added in
 * migration 20260914120000_client_journey_contract_id_unique
 * (`@@unique([contractId])`) plus the derivation service's `upsert`
 * (see docs/adr-client-journey-attribution.md for the attribution design
 * this builds on).
 */

async function seedCompletedContract() {
  const clientId = `journey-idem-client-${randomUUID()}`;
  const ptId = `journey-idem-pt-${randomUUID()}`;
  await prisma.userProfile.create({
    data: {
      userId: clientId, firstName: "Journey", lastName: "Idem", email: `${clientId}@test.gymini.invalid`,
      isPT: false, dataOrigin: "REAL", goal: "WEIGHT_LOSS", experienceLevel: "BEGINNER",
      preferredTrainingDays: [1, 3, 5], injuries: [],
    },
  });
  const startDate = new Date(Date.now() - 60 * 86_400_000);
  const completedAt = new Date(Date.now() - 5 * 86_400_000);
  await prisma.inBodyEntry.create({
    data: { userId: clientId, date: new Date(startDate.getTime() - 2 * 86_400_000), dateOnly: new Date(startDate.getTime() - 2 * 86_400_000), weight: 80, bodyFat: 20, bodyFatPct: 25, muscleMass: 60 },
  });
  const contract = await prisma.contract.create({
    data: {
      ptUserId: ptId, clientUserId: clientId, status: "COMPLETED",
      packageType: "PACKAGE", packageName: "Journey idempotency test", sessionMode: "OFFLINE",
      totalSessions: 8, usedSessions: 8, price: 1_000_000, pricePerSession: 125_000,
      startDate, completedAt, sessionDurationMinutes: 60,
      source: "INDEPENDENT", dataOrigin: "REAL",
    },
  });
  return { clientId, ptId, contractId: contract.id };
}

async function cleanup(clientId: string, contractId: string) {
  await prisma.clientJourney.deleteMany({ where: { contractId } }).catch(() => {});
  await prisma.contract.deleteMany({ where: { id: contractId } }).catch(() => {});
  await prisma.inBodyEntry.deleteMany({ where: { userId: clientId } }).catch(() => {});
  await prisma.userProfile.deleteMany({ where: { userId: clientId } }).catch(() => {});
}

test.after(async () => {
  await prisma.$disconnect();
});

test("deriveForCompletedContract: deriving the same completed contract twice SEQUENTIALLY creates exactly one ClientJourney", async () => {
  const { clientId, contractId } = await seedCompletedContract();
  try {
    const first = await deriveForCompletedContract(contractId);
    const second = await deriveForCompletedContract(contractId);
    assert.equal(first.status, "created", `expected first derivation to succeed, got: ${JSON.stringify(first)}`);
    assert.equal(second.status, "already_exists", `expected second derivation to be a no-op, got: ${JSON.stringify(second)}`);
    const journeys = await prisma.clientJourney.findMany({ where: { contractId } });
    assert.equal(journeys.length, 1, `expected exactly 1 ClientJourney row, found ${journeys.length}`);
  } finally {
    await cleanup(clientId, contractId);
  }
});

test("deriveForCompletedContract: deriving the same completed contract CONCURRENTLY (10 parallel calls) still results in exactly one real ClientJourney row", async () => {
  const { clientId, contractId } = await seedCompletedContract();
  try {
    const results = await Promise.all(Array.from({ length: 10 }, () => deriveForCompletedContract(contractId)));
    // Every one of the 10 concurrent calls must complete without a real
    // error (Prisma's upsert() resolves successfully on either its
    // insert or its update-into-no-op branch, so this does not by itself
    // distinguish which call "won" the race — that is an implementation
    // detail Prisma's return value does not expose, and is not the
    // property that actually matters here).
    for (const r of results) {
      assert.notEqual(r.reason, "derivation_error", `unexpected internal error in a concurrent call: ${JSON.stringify(r)}`);
    }
    // The property that DOES matter, and the one a plain findFirst-then-
    // create genuinely cannot guarantee under real concurrency (a classic
    // TOCTOU race): exactly one real row exists in the database once all
    // 10 concurrent calls have settled. This is only true because of the
    // DB-level unique constraint added in this pass
    // (migration 20260914120000_client_journey_contract_id_unique) plus
    // the derivation service's `upsert` — a bare findFirst+create would
    // let multiple concurrent calls all pass the findFirst check before
    // any of them commits, producing duplicate rows.
    const journeys = await prisma.clientJourney.findMany({ where: { contractId } });
    assert.equal(journeys.length, 1, `expected exactly 1 real ClientJourney row in the DB after 10 concurrent derivations, found ${journeys.length}`);
  } finally {
    await cleanup(clientId, contractId);
  }
});
