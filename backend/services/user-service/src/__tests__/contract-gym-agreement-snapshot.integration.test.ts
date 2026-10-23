import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import nodeTest from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { randomUUID } from "node:crypto";
import { Prisma, SessionMode } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import { contractService } from "../services/contract.service";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
installAccountsActive(); // Codex #4: requestContract asks auth-service, fail-closed

/**
 * Phase 3 / slice P3.2 - the PT-gym agreement behind a contract's rates is snapshotted on the
 * contract row (gymBrandId / gymAgreementId / gymAgreementScope / gymMembershipId), next to the
 * rate snapshot.
 *
 * BACKEND INTEGRATION on an isolated `*_test` database: requestContract runs for real, including
 * the real contracts INSERT and the real pt-restriction reads. gym-service is stubbed at the client
 * boundary (gymClient.getActiveCollaboration), and so are the package / PT-profile / availability /
 * notification reads that need other services' data. The gym-service HTTP shape is covered
 * separately at the axios boundary (no DB needed).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const MEMBERSHIP_ID = "mem-snapshot-test";
const RATES = { platformRate: "0.1000", ptRate: "0.7000", gymRate: "0.2000" };

async function requestWith(opts: { gymId?: string; collab?: unknown; sessionMode?: SessionMode; onGymCall?: () => void }) {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  const packageId = randomUUID();
  const restores = [
    patch(ptServicePackageRepository, "findById", async () => ({
      id: packageId, ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
      sessionMode: opts.sessionMode ?? SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: 30, /* Codex #6: a gym contract needs a fixed duration unless the membership is unlimited */
      isActive: true, archivedAt: null,
    })),
    // Listing Management: requestContract re-reads the package FOR SHARE inside its transaction.
    patch(ptServicePackageRepository, "findByIdForShare", async (id: string) => {
      const row = (await ptServicePackageRepository.findById(id)) as any;
      return row ? { version: 1, ...row } : null;
    }),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
    // P3.3: a gym contract needs an active membership at the brand. This suite is about the agreement
    // snapshot, so the client simply holds one (gym-service stub at the client boundary).
    patch(gymClient, "getClientMembershipAtGym", async () => {
      const m = { membershipId: MEMBERSHIP_ID, planName: "Thang", purchaseGymId: "gym-any", startDate: null, endDate: new Date(Date.now() + 365 * 86400000).toISOString() };
      return { hasActiveMembership: true, brandId: "brand-any", membership: m, memberships: [m] };
    }),
    patch(gymClient, "getActiveCollaboration", async () => {
      opts.onGymCall?.();
      if (opts.collab === "UNAVAILABLE") throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
      return opts.collab as any;
    }),
  ];
  try {
    const created = await contractService.requestContract(clientUserId, { ptUserId, packageId, gymId: opts.gymId });
    // Read it back from the database: the snapshot must be on the ROW, not just on the returned object.
    return await prisma.contract.findUniqueOrThrow({ where: { id: created.id } });
  } finally {
    restores.forEach((r) => r());
  }
}

const createdIds: string[] = [];
async function request(opts: Parameters<typeof requestWith>[0]) {
  const row = await requestWith(opts);
  createdIds.push(row.id);
  return row;
}
dbTest.after(async () => {
  await prisma.contract.deleteMany({ where: { id: { in: createdIds } } });
  await prisma.$disconnect();
});

dbTest("gym contract: brand, agreement id and scope are snapshotted on the row beside the rates", async () => {
  const row = await request({
    gymId: "gym-branch-1",
    collab: { collaborationId: "agr-brand-1", ...RATES, brandId: "brand-1", agreementScope: "BRAND" },
  });
  assert.equal(row.source, "GYM");
  assert.equal(row.gymId, "gym-branch-1");
  assert.equal(row.gymBrandId, "brand-1");
  assert.equal(row.gymAgreementId, "agr-brand-1");
  assert.equal(row.gymAgreementScope, "BRAND");
  assert.equal(row.gymMembershipId, MEMBERSHIP_ID, "P3.3: the membership that allowed the request is snapshotted");
  // the existing rate snapshot is untouched
  assert.ok(row.platformRate.equals("0.1") && row.ptRate.equals("0.7") && row.gymRate.equals("0.2"));
  assert.equal(row.status, "PENDING_REVIEW");
});

dbTest("legacy per-branch agreement: scope BRANCH is snapshotted as is", async () => {
  const row = await request({
    gymId: "gym-branch-2",
    collab: { collaborationId: "agr-legacy-1", ...RATES, brandId: "brand-2", agreementScope: "BRANCH" },
  });
  assert.equal(row.gymAgreementId, "agr-legacy-1");
  assert.equal(row.gymAgreementScope, "BRANCH");
  assert.equal(row.gymBrandId, "brand-2");
});

dbTest("gym-service that does not send brandId/agreementScope (not yet upgraded): those stay null, agreement id is still kept", async () => {
  const row = await request({ gymId: "gym-branch-3", collab: { collaborationId: "agr-3", ...RATES } });
  assert.equal(row.source, "GYM");
  assert.equal(row.gymBrandId, null);
  assert.equal(row.gymAgreementScope, null);
  assert.equal(row.gymAgreementId, "agr-3");
  assert.equal(row.gymMembershipId, MEMBERSHIP_ID);
  assert.ok(row.gymRate.equals("0.2"));
});

dbTest("independent contract (no gym): all four snapshot columns are null and gym-service is never asked", async () => {
  let asked = 0;
  const row = await request({ collab: null, onGymCall: () => asked++ });
  assert.equal(row.source, "INDEPENDENT");
  assert.equal(row.gymId, null);
  assert.deepEqual(
    [row.gymBrandId, row.gymAgreementId, row.gymAgreementScope, row.gymMembershipId],
    [null, null, null, null],
  );
  assert.ok(row.gymRate.equals("0") && row.ptRate.equals("0.9"));
  assert.equal(asked, 0);
});

dbTest("no agreement / gym-service down: request is still rejected exactly as before, nothing is written", async () => {
  // Scoped to this test's own gymId: other suites insert contracts into the same *_test database in parallel,
  // so a whole-table count would flake on rows that are not this test's doing.
  const before = await prisma.contract.count({ where: { gymId: "gym-x" } });
  await assert.rejects(() => request({ gymId: "gym-x", collab: null }), (e: any) => e.status === 400);
  await assert.rejects(() => request({ gymId: "gym-x", collab: "UNAVAILABLE" }), (e: any) => e.status === 503);
  assert.equal(await prisma.contract.count({ where: { gymId: "gym-x" } }), before);
});

dbTest("a contract row that predates the columns reads back with all four null (existing contracts unchanged)", async () => {
  const id = randomUUID();
  // Created the way every pre-P3.2 writer does: without mentioning the new columns at all.
  await prisma.contract.create({
    data: {
      id, ptUserId: randomUUID(), clientUserId: randomUUID(), packageName: "Legacy", totalSessions: 10,
      status: "PENDING_PAYMENT", gymId: "gym-old", source: "GYM",
      platformRate: "0.1", ptRate: "0.7", gymRate: "0.2",
    },
  });
  createdIds.push(id);
  const row = await prisma.contract.findUniqueOrThrow({ where: { id } });
  assert.deepEqual(
    [row.gymBrandId, row.gymAgreementId, row.gymAgreementScope, row.gymMembershipId],
    [null, null, null, null],
  );
  assert.equal(row.gymId, "gym-old");
});

// -- gym.client at the HTTP boundary (no database) ----------------------------------------------

function stubAxiosGet(payload: unknown) {
  const original = axios.get;
  (axios as any).get = async () => ({ data: payload });
  return () => {
    (axios as any).get = original;
  };
}

nodeTest("gym.client carries brandId + agreementScope when gym-service sends them", async () => {
  const restore = stubAxiosGet({ data: { collaborationId: "a1", ...RATES, brandId: "b1", agreementScope: "BRAND" } });
  try {
    const r = await gymClient.getActiveCollaboration("g1", "pt1");
    assert.equal(r?.collaborationId, "a1");
    assert.equal(r?.brandId, "b1");
    assert.equal(r?.agreementScope, "BRAND");
    assert.equal(r?.ptRate, "0.7000");
  } finally {
    restore();
  }
});

nodeTest("gym.client: absent or unrecognised optional fields become null, rates untouched", async () => {
  let restore = stubAxiosGet({ data: { collaborationId: "a2", ...RATES } });
  try {
    const r = await gymClient.getActiveCollaboration("g1", "pt1");
    assert.equal(r?.brandId, null);
    assert.equal(r?.agreementScope, null);
    assert.equal(r?.gymRate, "0.2000");
  } finally {
    restore();
  }
  restore = stubAxiosGet({ data: { collaborationId: "a3", ...RATES, brandId: "", agreementScope: "SOMETHING_NEW" } });
  try {
    const r = await gymClient.getActiveCollaboration("g1", "pt1");
    assert.equal(r?.brandId, null);
    assert.equal(r?.agreementScope, null);
  } finally {
    restore();
  }
});

nodeTest("gym.client: 404 is still 'no agreement' (null), other failures still GymServiceUnavailableError", async () => {
  const original = axios.get;
  try {
    (axios as any).get = async () => {
      throw { response: { status: 404 } };
    };
    assert.equal(await gymClient.getActiveCollaboration("g1", "pt1"), null);
    (axios as any).get = async () => {
      throw new Error("ECONNREFUSED");
    };
    await assert.rejects(() => gymClient.getActiveCollaboration("g1", "pt1"), GymServiceUnavailableError);
  } finally {
    (axios as any).get = original;
  }
});
