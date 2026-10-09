/**
 * The holdback rate a NEW contract is snapshotted with comes from exactly one function,
 * resolvePtHoldbackRate, and today it always returns "0": the rule is built and tested but
 * switched OFF, so no real contract is affected.
 *
 * TEST FIXTURE — the repositories / availability / notification are stubbed, no DB. The column
 * default for existing rows is pinned in contract-holdback.integration.test.ts.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { Prisma, SessionMode } from "../generated/prisma";
import { resolvePtHoldbackRate } from "../services/pt-holdback-rate";
import { contractService } from "../services/contract.service";
import { contractRepository } from "../repositories/contract.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { profileRepository } from "../repositories/profile.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("resolvePtHoldbackRate always returns '0' for now, whoever the PT is", async () => {
  for (const pt of ["pt-1", "a-pt-who-has-accepted-every-terms-version", "", "00000000-0000-0000-0000-000000000000"]) {
    assert.equal(await resolvePtHoldbackRate(pt), "0");
  }
});

test("requestContract snapshots ptHoldbackRate from resolvePtHoldbackRate: '0' on the row it creates, rates untouched", async () => {
  const created: Record<string, unknown>[] = [];
  const restores = [
    patch(ptServicePackageRepository, "findById", async () => ({
      id: "pkg-1", ptUserId: "pt-1", name: "Gói 10 buổi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
      sessionMode: SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: null, isActive: true, archivedAt: null,
    })),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(contractRepository, "findActiveByPair", async () => null),
    patch(contractRepository, "create", async (data: Record<string, unknown>) => {
      created.push(data);
      return { id: "c-new", ...data };
    }),
    patch(notificationService, "create", async () => ({})),
  ];
  try {
    await contractService.requestContract("client-1", { ptUserId: "pt-1", packageId: "pkg-1" });
    assert.equal(created.length, 1);
    assert.equal(created[0].ptHoldbackRate, "0");
    assert.equal(created[0].platformRate, "0.10");
    assert.equal(created[0].ptRate, "0.90");
    assert.equal(created[0].gymRate, "0");
    assert.equal(created[0].price, 5_000_000);
  } finally {
    restores.forEach((r) => r());
  }
});
