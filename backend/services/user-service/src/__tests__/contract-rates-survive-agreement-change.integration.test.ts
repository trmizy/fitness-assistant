import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, SessionMode } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { gymClient } from "../clients/gym.client";
import { contractService } from "../services/contract.service";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
installAccountsActive(); // Codex #4: requestContract asks auth-service, fail-closed

/**
 * Phase 1 (brand-level PT-Gym agreement UI) acceptance: a PT-client contract that is already
 * requested/signed keeps the rate table it was snapshotted with when the PT-Gym agreement later
 * changes (renegotiated brand terms, a new agreement after termination) - and so does the money
 * path, which reads the rates from the contract row (contract-payout.service `ratesOf`), never
 * from gym-service.
 *
 * BACKEND INTEGRATION on an isolated `*_test` database; gym-service is stubbed at the client
 * boundary exactly like contract-gym-agreement-snapshot.integration.test.ts.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

type Agreement = { collaborationId: string; platformRate: string; ptRate: string; gymRate: string; brandId: string; agreementScope: "BRAND" };

async function request(ptUserId: string, clientUserId: string, packageId: string, agreement: Agreement | null) {
  const restores = [
    patch(ptServicePackageRepository, "findById", async () => ({
      id: packageId, ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
      sessionMode: SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: 30, /* Codex #6: a gym contract needs a fixed duration unless the membership is unlimited */ isActive: true, archivedAt: null,
    })),
    // Listing Management: requestContract re-reads the package FOR SHARE inside its transaction.
    patch(ptServicePackageRepository, "findByIdForShare", async (id: string) => {
      const row = (await ptServicePackageRepository.findById(id)) as any;
      return row ? { version: 1, ...row } : null;
    }),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
    patch(gymClient, "getClientMembershipAtGym", async () => {
      const m = { membershipId: "mem-rates-test", planName: "Thang", purchaseGymId: "gym-any", startDate: null, endDate: new Date(Date.now() + 365 * 86400000).toISOString() };
      return { hasActiveMembership: true, brandId: "brand-rates", membership: m, memberships: [m] };
    }),
    patch(gymClient, "getActiveCollaboration", async () => agreement),
  ];
  try {
    const created = await contractService.requestContract(clientUserId, { ptUserId, packageId, gymId: "gym-rates-1" });
    return await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  } finally {
    restores.forEach((r) => r());
  }
}

const createdIds: string[] = [];
dbTest.after(async () => {
  await prisma.contract.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
});

const V1: Agreement = { collaborationId: "agr-v1", platformRate: "0.1000", ptRate: "0.6000", gymRate: "0.3000", brandId: "brand-rates", agreementScope: "BRAND" };
const V2: Agreement = { collaborationId: "agr-v2", platformRate: "0.1000", ptRate: "0.5000", gymRate: "0.4000", brandId: "brand-rates", agreementScope: "BRAND" };

dbTest("an existing contract keeps its snapshotted rates when the brand agreement is renegotiated; only NEW contracts take the new terms", async () => {
  const ptUserId = randomUUID();
  const packageId = randomUUID();
  const first = await request(ptUserId, randomUUID(), packageId, V1);
  createdIds.push(first.id);
  assert.ok(first.ptRate.equals("0.6") && first.gymRate.equals("0.3") && first.platformRate.equals("0.1"));
  assert.equal(first.gymAgreementId, "agr-v1");

  // The brand agreement is renegotiated / re-signed with different terms ...
  const second = await request(ptUserId, randomUUID(), packageId, V2);
  createdIds.push(second.id);
  assert.ok(second.ptRate.equals("0.5") && second.gymRate.equals("0.4"));
  assert.equal(second.gymAgreementId, "agr-v2");

  // ... and the first contract is untouched, row-level (this is what the settlement reads).
  const again = await prisma.contract.findUniqueOrThrow({ where: { id: first.id } });
  assert.ok(again.ptRate.equals("0.6") && again.gymRate.equals("0.3") && again.platformRate.equals("0.1"));
  assert.equal(again.gymAgreementId, "agr-v1");
  assert.equal(again.gymBrandId, "brand-rates");
});

dbTest("after the agreement ends (no usable agreement) a new request is refused, but the contract already requested keeps its rates", async () => {
  const ptUserId = randomUUID();
  const packageId = randomUUID();
  const first = await request(ptUserId, randomUUID(), packageId, V1);
  createdIds.push(first.id);

  await assert.rejects(() => request(ptUserId, randomUUID(), packageId, null), (e: any) => e.status === 400);

  const again = await prisma.contract.findUniqueOrThrow({ where: { id: first.id } });
  assert.ok(again.ptRate.equals("0.6") && again.gymRate.equals("0.3"));
  assert.equal(again.status, "PENDING_REVIEW");
});
