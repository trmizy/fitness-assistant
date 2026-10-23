import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import nodeTest from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { Prisma, SessionMode } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { trainingLocationRepository } from "../repositories/training_location.repository";
import { contractRepository } from "../repositories/contract.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import { contractService } from "../services/contract.service";
import { contractGymOptionsService } from "../services/contract-gym-options.service";
import { contractController } from "../controllers/contract.controller";
import {
  evaluateMembershipForContract,
  projectedContractEnd,
  MEMBERSHIP_REQUIRED,
  MEMBERSHIP_DOES_NOT_COVER_CONTRACT,
  GYM_CONTRACT_REQUIRES_FIXED_DURATION,
  hasFixedDuration,
} from "../services/contract-gym-membership.service";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
installAccountsActive(); // Codex #4: requestContract asks auth-service, fail-closed

/**
 * Phase 3 / slice P3.3 (owner decision D67): requestContract refuses a gym contract unless the
 * client holds an active gym membership at the brand of the gym that lasts at least as long as the
 * contract; GET /contracts/gym-options reports the SAME verdict per branch.
 *
 * BACKEND INTEGRATION on an isolated `*_test` database: requestContract and getGymOptions run for
 * real, including the contracts INSERT and the pt-restriction reads. gym-service is a TEST FIXTURE
 * stubbed at the gymClient boundary; the stub models P3.1's answer honestly (brand-level scope,
 * "active" = status ACTIVE and not past its end date). Package / PT-profile / availability /
 * notification reads (other data owners) are stubbed as in the other contract-* suites.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const DAY = 24 * 60 * 60 * 1000;
const RATES = { platformRate: "0.1000", ptRate: "0.7000", gymRate: "0.2000" };
const iso = (ms: number) => new Date(ms).toISOString();

interface FakeGym { id: string; brandId: string | null }
interface FakeMembership { id: string; brandId: string; purchaseGymId: string; endDate: string | null; status?: string }

interface World {
  ptUserId: string;
  clientUserId: string;
  packageId: string;
  gyms: FakeGym[];
  memberships: FakeMembership[];
  validityDays: number | null;
  sessionMode?: SessionMode;
  gymServiceDown?: boolean;
  membershipCalls: string[];
}

function newWorld(over: Partial<World> = {}): World {
  return {
    ptUserId: randomUUID(),
    clientUserId: randomUUID(),
    packageId: randomUUID(),
    gyms: [{ id: "gym-a1", brandId: "brand-a" }, { id: "gym-a2", brandId: "brand-a" }, { id: "gym-b1", brandId: "brand-b" }],
    memberships: [],
    validityDays: 60,
    membershipCalls: [],
    ...over,
  };
}

function install(w: World): () => void {
  const byId = new Map(w.gyms.map((g) => [g.id, g]));
  const restores = [
    patch(ptServicePackageRepository, "findById", async (id: string) =>
      id === w.packageId
        ? {
            id: w.packageId, ptUserId: w.ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
            sessionMode: w.sessionMode ?? SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: w.validityDays,
            isActive: true, archivedAt: null,
          }
        : null,
    ),
    // requestContract now re-reads the package INSIDE its transaction (SELECT ... FOR SHARE, plan §12.13 item 4):
    // serve the same fixture row for that read (no such row exists in the database).
    patch(ptServicePackageRepository, "findByIdForShare", async (id: string) => {
      const row = (await ptServicePackageRepository.findById(id)) as any;
      return row ? { version: 1, ...row } : null;
    }),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true, referralCode: null })),
    patch(trainingLocationRepository, "findByPtUserId", async () => []),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
    patch(gymClient, "listAcceptedGymsForPt", async () => {
      if (w.gymServiceDown) throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
      return w.gyms.map((g) => ({ collaborationId: `agr-${g.id}`, gym: { id: g.id, name: g.id, city: "HCM" }, rates: { ...RATES } }));
    }),
    patch(gymClient, "getActiveCollaboration", async (gymId: string) => {
      const g = byId.get(gymId);
      if (!g) return null;
      return { collaborationId: `agr-${gymId}`, ...RATES, brandId: g.brandId, agreementScope: "BRAND" };
    }),
    patch(gymClient, "getClientMembershipAtGym", async (clientId: string, gymId: string) => {
      w.membershipCalls.push(`${clientId}:${gymId}`);
      if (w.gymServiceDown) throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
      const g = byId.get(gymId);
      if (!g) return null;
      // P3.1: brand-level scope; active = status ACTIVE and end date not passed. Newest first.
      const active = g.brandId
        ? w.memberships.filter(
            (m) => m.brandId === g.brandId && (m.status ?? "ACTIVE") === "ACTIVE" && (m.endDate == null || Date.parse(m.endDate) > Date.now()),
          )
        : [];
      const rows = active.map((m) => ({ membershipId: m.id, planName: "Plan", purchaseGymId: m.purchaseGymId, startDate: null, endDate: m.endDate }));
      return { hasActiveMembership: rows.length > 0, brandId: g.brandId, membership: rows[0] ?? null, memberships: rows };
    }),
  ];
  return () => [...restores].reverse().forEach((r) => r());
}

async function cleanup(w: World) {
  await prisma.contract.deleteMany({ where: { OR: [{ ptUserId: w.ptUserId }, { clientUserId: w.clientUserId }] } });
}

const rowsFor = (w: World) => prisma.contract.count({ where: { clientUserId: w.clientUserId } });

const request = (w: World, gymId?: string) =>
  contractService.requestContract(w.clientUserId, { ptUserId: w.ptUserId, packageId: w.packageId, gymId });

dbTest.after(async () => {
  await prisma.$disconnect();
});

// Run `fn` inside a fresh world with the stubs installed; always clean up.
async function inWorld(over: Partial<World>, fn: (w: World) => Promise<void>) {
  const w = newWorld(over);
  const restore = install(w);
  try {
    await fn(w);
  } finally {
    restore();
    await cleanup(w);
  }
}

const mem = (over: Partial<FakeMembership> = {}): FakeMembership => ({
  id: `mem-${randomUUID().slice(0, 8)}`, brandId: "brand-a", purchaseGymId: "gym-a1", endDate: iso(Date.now() + 90 * DAY), ...over,
});

// ── requestContract ──────────────────────────────────────────────────────────────────────────────

dbTest("no membership at all: 422 MEMBERSHIP_REQUIRED with gymId/brandId, and NO contract row", async () => {
  await inWorld({}, async (w) => {
    await assert.rejects(
      () => request(w, "gym-a1"),
      (e: any) => {
        assert.equal(e.status, 422);
        assert.equal(e.code, MEMBERSHIP_REQUIRED);
        assert.deepEqual(e.details, { gymId: "gym-a1", brandId: "brand-a" });
        return true;
      },
    );
    assert.equal(await rowsFor(w), 0);
  });
});

dbTest("expired membership (end date passed) counts as none: 422 MEMBERSHIP_REQUIRED, no row", async () => {
  await inWorld({ memberships: [mem({ endDate: iso(Date.now() - DAY) })] }, async (w) => {
    await assert.rejects(() => request(w, "gym-a1"), (e: any) => e.status === 422 && e.code === MEMBERSHIP_REQUIRED);
    assert.equal(await rowsFor(w), 0);
  });
});

dbTest("cancelled / pending-payment membership counts as none: 422 MEMBERSHIP_REQUIRED, no row", async () => {
  for (const status of ["CANCELLED", "EXPIRED", "PENDING_PAYMENT"]) {
    await inWorld({ memberships: [mem({ status })] }, async (w) => {
      await assert.rejects(() => request(w, "gym-a1"), (e: any) => e.status === 422 && e.code === MEMBERSHIP_REQUIRED, status);
      assert.equal(await rowsFor(w), 0);
    });
  }
});

dbTest("active but shorter than the contract (10 days left, 60-day contract): 422 MEMBERSHIP_DOES_NOT_COVER_CONTRACT with both dates, no row", async () => {
  const end = iso(Date.now() + 10 * DAY);
  await inWorld({ memberships: [mem({ endDate: end })], validityDays: 60 }, async (w) => {
    const before = Date.now();
    await assert.rejects(
      () => request(w, "gym-a1"),
      (e: any) => {
        assert.equal(e.status, 422);
        assert.equal(e.code, MEMBERSHIP_DOES_NOT_COVER_CONTRACT);
        assert.equal(e.details.gymId, "gym-a1");
        assert.equal(e.details.brandId, "brand-a");
        assert.equal(e.details.membershipEndDate, end);
        // contract end = now + 60 days, the same arithmetic as activation
        const ce = Date.parse(e.details.contractEndDate);
        assert.ok(ce >= before + 60 * DAY && ce <= Date.now() + 60 * DAY);
        return true;
      },
    );
    assert.equal(await rowsFor(w), 0);
  });
});

dbTest("exactly as long as the contract (60 vs 60 days): allowed, membership snapshotted", async () => {
  const m = mem({ endDate: iso(Date.now() + 60 * DAY) });
  await inWorld({ memberships: [m], validityDays: 60 }, async (w) => {
    const c = await request(w, "gym-a1");
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.status, "PENDING_REVIEW");
    assert.equal(row.gymMembershipId, m.id);
  });
});

dbTest("one day short (59 vs 60 days): blocked; membership that outlasts the contract (90 vs 60): allowed + gymMembershipId on the row", async () => {
  await inWorld({ memberships: [mem({ endDate: iso(Date.now() + 59 * DAY) })] }, async (w) => {
    await assert.rejects(() => request(w, "gym-a1"), (e: any) => e.status === 422 && e.code === MEMBERSHIP_DOES_NOT_COVER_CONTRACT);
    assert.equal(await rowsFor(w), 0);
  });
  const longer = mem({ endDate: iso(Date.now() + 90 * DAY) });
  await inWorld({ memberships: [longer] }, async (w) => {
    const c = await request(w, "gym-a1");
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.gymMembershipId, longer.id);
    assert.equal(row.gymBrandId, "brand-a");
    assert.equal(row.source, "GYM");
    assert.deepEqual(w.membershipCalls, [`${w.clientUserId}:gym-a1`]);
  });
});

dbTest("membership bought at a SIBLING branch of the same brand is valid at the requested branch", async () => {
  const m = mem({ purchaseGymId: "gym-a1" });
  await inWorld({ memberships: [m] }, async (w) => {
    const c = await request(w, "gym-a2");
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.gymId, "gym-a2");
    assert.equal(row.gymMembershipId, m.id);
  });
});

dbTest("a membership of ANOTHER brand only: blocked MEMBERSHIP_REQUIRED, no row", async () => {
  await inWorld({ memberships: [mem({ brandId: "brand-b", purchaseGymId: "gym-b1" })] }, async (w) => {
    await assert.rejects(
      () => request(w, "gym-a1"),
      (e: any) => e.status === 422 && e.code === MEMBERSHIP_REQUIRED && e.details.brandId === "brand-a",
    );
    assert.equal(await rowsFor(w), 0);
  });
});

dbTest("several active memberships of the brand: the one that lasts longest decides and is snapshotted", async () => {
  const shortNewest = mem({ id: "mem-short", purchaseGymId: "gym-a2", endDate: iso(Date.now() + 10 * DAY) });
  const longOlder = mem({ id: "mem-long", purchaseGymId: "gym-a1", endDate: iso(Date.now() + 120 * DAY) });
  await inWorld({ memberships: [shortNewest, longOlder] }, async (w) => {
    const c = await request(w, "gym-a1");
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.gymMembershipId, "mem-long");
  });
});

dbTest("membership without an end date never ends: covers any contract length", async () => {
  const m = mem({ endDate: null });
  await inWorld({ memberships: [m], validityDays: 3650 }, async (w) => {
    const c = await request(w, "gym-a1");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).gymMembershipId, m.id);
  });
});

dbTest("[Codex #6] a gym contract needs a fixed duration: package validityDays null is refused 409 GYM_CONTRACT_REQUIRES_FIXED_DURATION whatever the membership (none / expiring / UNLIMITED), no row, gym-service membership not even asked", async () => {
  for (const memberships of [[], [mem({ endDate: iso(Date.now() + 2 * DAY) })], [mem({ endDate: iso(Date.now() + 3650 * DAY) })], [mem({ endDate: null })]]) {
    await inWorld({ memberships, validityDays: null }, async (w) => {
      await assert.rejects(
        () => request(w, "gym-a1"),
        (e: any) =>
          e.status === 409 &&
          e.code === GYM_CONTRACT_REQUIRES_FIXED_DURATION &&
          /phải có thời hạn cố định/.test(e.message) &&
          e.details.gymId === "gym-a1" &&
          e.details.brandId === "brand-a",
      );
      assert.equal(await rowsFor(w), 0, "nothing written");
      assert.deepEqual(w.membershipCalls, [], "the verdict does not depend on the membership, so gym-service is not asked");
    });
  }
});

dbTest("[Codex #6] validityDays 0 or negative is no fixed duration either (never 'covers forever')", async () => {
  for (const validityDays of [0, -30]) {
    await inWorld({ memberships: [mem({ endDate: null })], validityDays }, async (w) => {
      await assert.rejects(() => request(w, "gym-a1"), (e: any) => e.status === 409 && e.code === GYM_CONTRACT_REQUIRES_FIXED_DURATION);
      assert.equal(await rowsFor(w), 0);
    });
  }
  assert.deepEqual([null, undefined, 0, -1, 1.5, NaN].map(hasFixedDuration), [false, false, false, false, false, false]);
  assert.deepEqual([1, 30, 365].map(hasFixedDuration), [true, true, true]);
});

dbTest("[Codex #6] a UNLIMITED membership (no end date) still covers a fixed-duration gym contract of any length; a long expiring one covers a shorter contract", async () => {
  const unlimited = mem({ endDate: null });
  await inWorld({ memberships: [unlimited], validityDays: 3650 }, async (w) => {
    const c = await request(w, "gym-a1");
    assert.equal((await prisma.contract.findUniqueOrThrow({ where: { id: c.id } })).gymMembershipId, unlimited.id);
  });
  const long = mem({ endDate: iso(Date.now() + 3650 * DAY) });
  await inWorld({ memberships: [long], validityDays: 90 }, async (w) => {
    assert.ok((await request(w, "gym-a1")).id);
  });
});

dbTest("[Codex #6] a contract WITHOUT a gym is unchanged: validityDays null is fine, gym-service is never asked", async () => {
  await inWorld({ validityDays: null }, async (w) => {
    const c = await request(w);
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.source, "INDEPENDENT");
    assert.equal(row.validityDays, null);
    assert.deepEqual(w.membershipCalls, []);
  });
});

dbTest("[Codex #6] two concurrent gym requests for the same PT and client: exactly one contract, the other is refused (nothing doubled)", async () => {
  await inWorld({ memberships: [mem()], validityDays: 60 }, async (w) => {
    const results = await Promise.allSettled([request(w, "gym-a1"), request(w, "gym-a1")]);
    assert.equal(results.filter((r) => r.status === "fulfilled").length, 1, JSON.stringify(results.map((r) => r.status)));
    const lost = results.find((r) => r.status === "rejected") as PromiseRejectedResult;
    assert.equal(lost.reason.status, 409);
    assert.equal(await rowsFor(w), 1);
  });
  // ...and two concurrent requests for a package WITHOUT a duration: both refused, none written
  await inWorld({ memberships: [mem({ endDate: null })], validityDays: null }, async (w) => {
    const results = await Promise.allSettled([request(w, "gym-a1"), request(w, "gym-a1")]);
    assert.deepEqual(results.map((r) => r.status), ["rejected", "rejected"]);
    for (const r of results as PromiseRejectedResult[]) assert.equal(r.reason.code, GYM_CONTRACT_REQUIRES_FIXED_DURATION);
    assert.equal(await rowsFor(w), 0);
  });
});

dbTest("[Codex #6] the package is re-read LOCKED inside the transaction: edited to 'no duration' after the pre-check -> refused, no row; edited to a LONGER duration than the membership was checked against -> PACKAGE_CHANGED, no row", async () => {
  const lockedAs = (validityDays: number | null) =>
    patch(ptServicePackageRepository, "findByIdForShare", async (id: string) => {
      const row = (await ptServicePackageRepository.findById(id)) as any;
      return row ? { version: 2, ...row, validityDays } : null;
    });
  await inWorld({ memberships: [mem({ endDate: null })], validityDays: 60 }, async (w) => {
    const restore = lockedAs(null);
    try {
      await assert.rejects(() => request(w, "gym-a1"), (e: any) => e.status === 409 && e.code === GYM_CONTRACT_REQUIRES_FIXED_DURATION);
    } finally {
      restore();
    }
    assert.equal(await rowsFor(w), 0);
  });
  await inWorld({ memberships: [mem({ endDate: iso(Date.now() + 61 * DAY) })], validityDays: 60 }, async (w) => {
    const restore = lockedAs(365);
    try {
      await assert.rejects(() => request(w, "gym-a1"), (e: any) => e.status === 409 && e.code === "PACKAGE_CHANGED");
    } finally {
      restore();
    }
    assert.equal(await rowsFor(w), 0);
  });
  await inWorld({ memberships: [mem({ endDate: iso(Date.now() + 61 * DAY) })], validityDays: 60 }, async (w) => {
    const restore = lockedAs(30); // shorter than what was checked: still covered
    try {
      assert.ok((await request(w, "gym-a1")).id);
    } finally {
      restore();
    }
  });
});

dbTest("contract without a gym (independent): unchanged - gym-service membership is never asked, snapshot stays null", async () => {
  await inWorld({}, async (w) => {
    const c = await request(w);
    const row = await prisma.contract.findUniqueOrThrow({ where: { id: c.id } });
    assert.equal(row.source, "INDEPENDENT");
    assert.equal(row.gymId, null);
    assert.equal(row.gymMembershipId, null);
    assert.deepEqual(w.membershipCalls, []);
  });
});

dbTest("online package with a gymId: still the old 400 (membership check is not reached)", async () => {
  await inWorld({ sessionMode: SessionMode.ONLINE }, async (w) => {
    await assert.rejects(() => request(w, "gym-a1"), (e: any) => e.status === 400);
    assert.deepEqual(w.membershipCalls, []);
    assert.equal(await rowsFor(w), 0);
  });
});

dbTest("gym-service down at the membership lookup: 503, fail closed, no row (never 'no membership', never 'fine')", async () => {
  await inWorld({ memberships: [mem()] }, async (w) => {
    // Agreement lookup works; only the membership lookup fails.
    const restore = patch(gymClient, "getClientMembershipAtGym", async () => {
      throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
    });
    try {
      await assert.rejects(() => request(w, "gym-a1"), (e: any) => e.status === 503 && e.code === undefined);
    } finally {
      restore();
    }
    assert.equal(await rowsFor(w), 0);
  });
});

dbTest("controller body: 422 carries code + details (gymId, brandId / membershipEndDate, contractEndDate), flat and under details", async () => {
  const call = async (w: World, gymId: string) => {
    let status = 0;
    let body: any;
    const res: any = { status: (s: number) => ((status = s), res), json: (b: any) => ((body = b), res) };
    await contractController.requestContract(
      { headers: { "x-user-id": w.clientUserId }, body: { ptUserId: w.ptUserId, packageId: w.packageId, gymId } },
      res,
    );
    return { status, body };
  };
  await inWorld({}, async (w) => {
    const { status, body } = await call(w, "gym-a1");
    assert.equal(status, 422);
    assert.equal(body.code, "MEMBERSHIP_REQUIRED");
    assert.deepEqual(body.details, { gymId: "gym-a1", brandId: "brand-a" });
    assert.equal(body.gymId, "gym-a1");
    assert.equal(body.brandId, "brand-a");
    assert.equal(typeof body.error, "string");
  });
  const end = iso(Date.now() + 5 * DAY);
  await inWorld({ memberships: [mem({ endDate: end })] }, async (w) => {
    const { status, body } = await call(w, "gym-a2");
    assert.equal(status, 422);
    assert.equal(body.code, "MEMBERSHIP_DOES_NOT_COVER_CONTRACT");
    assert.equal(body.details.membershipEndDate, end);
    assert.equal(typeof body.details.contractEndDate, "string");
    assert.equal(body.membershipEndDate, end);
    assert.equal(body.contractEndDate, body.details.contractEndDate);
  });
  await inWorld({}, async (w) => {
    const restore = patch(gymClient, "getClientMembershipAtGym", async () => {
      throw new GymServiceUnavailableError(new Error("down"));
    });
    try {
      const { status, body } = await call(w, "gym-a1");
      assert.equal(status, 503);
      assert.equal(body.code, undefined);
    } finally {
      restore();
    }
  });
});

// ── gym-options eligibility == requestContract ──────────────────────────────────────────────────

interface MatrixCase {
  name: string;
  memberships: () => FakeMembership[];
  validityDays?: number | null;
  gymId: string;
  expect: "ok" | typeof MEMBERSHIP_REQUIRED | typeof MEMBERSHIP_DOES_NOT_COVER_CONTRACT | typeof GYM_CONTRACT_REQUIRES_FIXED_DURATION;
}
const MATRIX: MatrixCase[] = [
  { name: "no membership", memberships: () => [], gymId: "gym-a1", expect: MEMBERSHIP_REQUIRED },
  { name: "expired", memberships: () => [mem({ endDate: iso(Date.now() - DAY) })], gymId: "gym-a1", expect: MEMBERSHIP_REQUIRED },
  { name: "cancelled", memberships: () => [mem({ status: "CANCELLED" })], gymId: "gym-a1", expect: MEMBERSHIP_REQUIRED },
  { name: "other brand only", memberships: () => [mem({ brandId: "brand-b", purchaseGymId: "gym-b1" })], gymId: "gym-a1", expect: MEMBERSHIP_REQUIRED },
  { name: "too short", memberships: () => [mem({ endDate: iso(Date.now() + 10 * DAY) })], gymId: "gym-a1", expect: MEMBERSHIP_DOES_NOT_COVER_CONTRACT },
  { name: "one day short", memberships: () => [mem({ endDate: iso(Date.now() + 59 * DAY) })], gymId: "gym-a1", expect: MEMBERSHIP_DOES_NOT_COVER_CONTRACT },
  { name: "exactly equal", memberships: () => [mem({ endDate: iso(Date.now() + 60 * DAY) })], gymId: "gym-a1", expect: "ok" },
  { name: "longer", memberships: () => [mem({ endDate: iso(Date.now() + 90 * DAY) })], gymId: "gym-a1", expect: "ok" },
  { name: "sibling branch", memberships: () => [mem({ purchaseGymId: "gym-a1" })], gymId: "gym-a2", expect: "ok" },
  { name: "no end date", memberships: () => [mem({ endDate: null })], gymId: "gym-a1", expect: "ok" },
  { name: "no fixed duration, expiring membership", memberships: () => [mem({ endDate: iso(Date.now() + 2 * DAY) })], validityDays: null, gymId: "gym-a1", expect: GYM_CONTRACT_REQUIRES_FIXED_DURATION },
  { name: "no fixed duration, UNLIMITED membership (still refused)", memberships: () => [mem({ endDate: null })], validityDays: null, gymId: "gym-a1", expect: GYM_CONTRACT_REQUIRES_FIXED_DURATION },
  { name: "no fixed duration, no membership (the package is the problem)", memberships: () => [], validityDays: null, gymId: "gym-a1", expect: GYM_CONTRACT_REQUIRES_FIXED_DURATION },
  {
    name: "short newest + long older",
    memberships: () => [mem({ endDate: iso(Date.now() + 10 * DAY), purchaseGymId: "gym-a2" }), mem({ endDate: iso(Date.now() + 100 * DAY) })],
    gymId: "gym-a1",
    expect: "ok",
  },
];

dbTest("gym-options eligibility equals the requestContract outcome for every case (one shared function)", async () => {
  for (const c of MATRIX) {
    const over: Partial<World> = { memberships: c.memberships() };
    if (c.validityDays !== undefined) over.validityDays = c.validityDays;
    await inWorld(over, async (w) => {
      // Picker first (read-only), then the real request on the same world.
      const options = await contractGymOptionsService.getGymOptions(w.clientUserId, { ptUserId: w.ptUserId, packageId: w.packageId });
      const opt = options.gyms.find((g) => g.gymId === c.gymId);
      assert.ok(opt, `${c.name}: gym listed`);
      let outcome: string = "ok";
      try {
        await request(w, c.gymId);
      } catch (e: any) {
        outcome = e.code ?? `HTTP_${e.status}`;
      }
      assert.equal(outcome, c.expect, `${c.name}: requestContract`);
      // The picker reports exactly the code the request answers with (a client that does not know a reason still blocks the branch).
      const expectedEligibility = c.expect === "ok" ? { canRequest: true, reason: null } : { canRequest: false, reason: c.expect };
      assert.deepEqual(opt.eligibility, expectedEligibility, `${c.name}: eligibility`);
      assert.equal(opt.eligibility.canRequest, outcome === "ok", `${c.name}: canRequest == request succeeded`);
    });
  }
});

// ── pure function / shared formula ───────────────────────────────────────────────────────────────

nodeTest("evaluateMembershipForContract: injected clock - the day boundary and the fail-closed edges are exact", () => {
  const now = new Date("2026-10-17T10:00:00.000Z");
  const look = (endDate: string | null) => ({
    hasActiveMembership: true, brandId: "b",
    membership: { membershipId: "m", planName: "p", purchaseGymId: "g", startDate: null, endDate },
  });
  const at = (days: number, extraMs = 0) => iso(now.getTime() + days * DAY + extraMs);
  const verdict = (endDate: string | null, validityDays: number | null) =>
    evaluateMembershipForContract({ lookup: look(endDate), gymId: "g", validityDays, now });

  assert.equal(verdict(at(60), 60).ok, true, "60 vs 60 -> allowed");
  assert.equal(verdict(at(60, -60_000), 60).ok, true, "60 days minus a minute (membership bought minutes ago) -> still allowed");
  assert.equal(verdict(at(59, 1), 60).ok, true, "59 days and a millisecond rounds up to 60 left");
  assert.equal(verdict(at(59), 60).ok, false, "exactly 59 days left -> blocked");
  assert.equal(verdict(at(10), 60).ok, false, "10 vs 60 -> blocked");
  assert.equal(verdict(at(61), 60).ok, true, "longer -> allowed");
  assert.equal(verdict(null, 60).ok, true, "no end date -> allowed");
  assert.equal(verdict("not-a-date", 60).ok, false, "unreadable end date -> cannot prove coverage -> blocked");
  // Codex #6: no fixed duration is refused first, for EVERY membership (validityDays null never means "covers forever")
  for (const endDate of [at(1), at(3650), null, "not-a-date"]) {
    for (const validityDays of [null, 0, -3]) {
      const v = verdict(endDate, validityDays);
      assert.ok(!v.ok && v.code === GYM_CONTRACT_REQUIRES_FIXED_DURATION && v.details.gymId === "g", `${endDate} / ${validityDays}`);
    }
  }
  const noMembershipNoDuration = evaluateMembershipForContract({ lookup: null, gymId: "g", validityDays: null, now });
  assert.ok(!noMembershipNoDuration.ok && noMembershipNoDuration.code === GYM_CONTRACT_REQUIRES_FIXED_DURATION, "the package is judged before the member");
  const short = verdict(at(10), 60);
  assert.ok(!short.ok && short.code === MEMBERSHIP_DOES_NOT_COVER_CONTRACT);
  assert.equal(!short.ok && short.details.contractEndDate, iso(now.getTime() + 60 * DAY));
  // lookup null (gym-service does not know the branch) and an inactive lookup both read as "required"
  const none = evaluateMembershipForContract({ lookup: null, gymId: "g", brandId: "brand-x", validityDays: 60, now });
  assert.ok(!none.ok && none.code === MEMBERSHIP_REQUIRED && none.details.brandId === "brand-x");
});

nodeTest("[Codex #6] boundary, exactly: days are Asia/Ho_Chi_Minh days = 24 h (UTC+7, no DST), the membership's days left are rounded UP, a membership with no end date always covers", () => {
  // a Vietnamese local midnight, to make the day semantics concrete: 2026-10-17 00:00 +07:00
  const now = new Date("2026-10-17T00:00:00+07:00");
  const look = (endDate: string | null) => ({
    hasActiveMembership: true, brandId: "b",
    membership: { membershipId: "m", planName: "p", purchaseGymId: "g", startDate: null, endDate },
  });
  const validityDays = 30;
  const contractEnd = now.getTime() + validityDays * DAY; // 2026-11-16 00:00 +07:00, the same arithmetic as activation
  const covers = (endMs: number | null) =>
    evaluateMembershipForContract({ lookup: look(endMs === null ? null : iso(endMs)), gymId: "g", validityDays, now }).ok;

  assert.equal(projectedContractEnd(now, validityDays)!.getTime(), contractEnd);
  assert.equal(covers(contractEnd), true, "membership ends exactly when the contract ends -> covers");
  assert.equal(covers(contractEnd + 1), true, "one ms longer -> covers");
  assert.equal(covers(contractEnd - 1), true, "ONE MS SHORT still covers: it still has 30 days left, rounded up (the minutes between buying the membership and sending the request must not turn 30-vs-30 into a refusal)");
  assert.equal(covers(contractEnd - 59 * 60_000), true, "59 minutes short -> still 30 days left rounded up -> covers");
  assert.equal(covers(contractEnd - DAY + 1), true, "one ms more than a whole day short -> 29 days and a bit -> rounds up to 30 -> covers");
  assert.equal(covers(contractEnd - DAY), false, "exactly one whole day short (29 days left) -> refused");
  assert.equal(covers(contractEnd - DAY - 1), false, "a whole day and a ms short -> refused");
  assert.equal(covers(contractEnd - 10 * DAY), false);
  assert.equal(covers(null), true, "unlimited membership -> covers");
  // a membership already over at the request instant is not covering anything
  assert.equal(covers(now.getTime()), false);
  assert.equal(covers(now.getTime() - 1), false);
  // the refusal says which two instants it compared
  const v = evaluateMembershipForContract({ lookup: look(iso(contractEnd - DAY)), gymId: "g", validityDays, now });
  assert.ok(!v.ok && v.code === MEMBERSHIP_DOES_NOT_COVER_CONTRACT);
  assert.equal(!v.ok && v.details.contractEndDate, iso(contractEnd));
  assert.equal(!v.ok && v.details.membershipEndDate, iso(contractEnd - DAY));
});

dbTest("contract end projection uses the SAME arithmetic as activation (activateIfPendingGuarded: startDate + validityDays*24h)", async () => {
  const id = randomUUID();
  const startDate = new Date("2026-11-01T08:30:00.000Z");
  await prisma.contract.create({
    data: {
      id, ptUserId: randomUUID(), clientUserId: randomUUID(), packageName: "P", totalSessions: 10, status: "PENDING_PAYMENT",
      startDate, validityDays: 45, source: "INDEPENDENT", platformRate: "0.1", ptRate: "0.9", gymRate: "0",
    },
  });
  try {
    const { contract, flipped } = await contractRepository.activateIfPendingGuarded(id, "txn-p33");
    assert.equal(flipped, true);
    assert.equal(contract!.endDate!.toISOString(), projectedContractEnd(startDate, 45)!.toISOString());
    assert.equal(projectedContractEnd(startDate, null), null);
  } finally {
    await prisma.contract.deleteMany({ where: { id } });
  }
});
