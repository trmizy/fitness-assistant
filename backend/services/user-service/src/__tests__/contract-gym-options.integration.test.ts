import { guardedTest as dbTest, skip } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import type { AddressInfo } from "node:net";
import express from "express";
import { Prisma, SessionMode } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { trainingLocationRepository } from "../repositories/training_location.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { gymClient, GymServiceUnavailableError } from "../clients/gym.client";
import { authServiceClient } from "../clients/auth-service.client";
import { contractService } from "../services/contract.service";
import { contractGymOptionsService } from "../services/contract-gym-options.service";
import contractRoutes from "../routes/contract.routes";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
installAccountsActive(); // Codex #4: requestContract asks auth-service, fail-closed

/**
 * Phase 3 / slice P3.4 - GET /contracts/gym-options.
 *
 * BACKEND INTEGRATION on an isolated `*_test` database: the trainer-side guards
 * (pt-restriction.service reads) and the contracts table are real; gym-service is a TEST FIXTURE
 * stubbed at the gymClient boundary (listAcceptedGymsForPt / getActiveCollaboration /
 * getClientMembershipAtGym), as are the package, PT-profile, training-location, availability and
 * notification reads that belong to other data owners. The HTTP tests mount the real
 * contract.routes behind a stubbed auth-service verdict (no real token verification).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const RATES = { platformRate: "0.1000", ptRate: "0.7000", gymRate: "0.2000" };

interface FakeGym {
  id: string;
  name: string;
  city?: string;
  brandId: string | null;
  /** What getActiveCollaboration answers (the accept-time view). null = request/accept would refuse. */
  collab?: "OK" | null;
  /** The client's active membership at this gym's brand (the P3.1 answer), if any. */
  membership?: { id: string; planName: string; purchaseGymId: string; endDate: string | null };
  /** gym-service lists it (public picker) even though the accept-time view disagrees. */
  listed?: boolean;
}

interface World {
  ptUserId: string;
  clientUserId: string;
  packageId: string;
  gyms: FakeGym[];
  trainingGymIds?: string[];
  sessionMode?: SessionMode;
  accepting?: boolean;
  referralCode?: string | null;
  packageActive?: boolean;
  calls: { list: number; collab: number; membership: string[] };
  listFails?: boolean;
  membershipFails?: boolean;
}

function newWorld(over: Partial<World> & { gyms: FakeGym[] }): World {
  return {
    ptUserId: randomUUID(),
    clientUserId: randomUUID(),
    packageId: randomUUID(),
    calls: { list: 0, collab: 0, membership: [] },
    ...over,
  };
}

/** Install the fixture; returns the restore function. */
function install(w: World): () => void {
  const byId = new Map(w.gyms.map((g) => [g.id, g]));
  return composeRestores([
    patch(ptServicePackageRepository, "findById", async (id: string) =>
      id === w.packageId
        ? {
            id: w.packageId, ptUserId: w.ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
            sessionMode: w.sessionMode ?? SessionMode.OFFLINE, sessionDurationMinutes: 60, validityDays: 30, /* Codex #6: a gym contract needs a fixed duration unless the membership is unlimited */
            isActive: w.packageActive ?? true, archivedAt: null,
          }
        : null,
    ),
    // requestContract now re-reads the package INSIDE its transaction (SELECT ... FOR SHARE, plan §12.13 item 4):
    // serve the same fixture row for that read (no such row exists in the database).
    patch(ptServicePackageRepository, "findByIdForShare", async (id: string) => {
      const row = (await ptServicePackageRepository.findById(id)) as any;
      return row ? { version: 1, ...row } : null;
    }),
    patch(profileRepository, "findByUserId", async () => ({
      isPT: true, ptSuspended: false, isAcceptingClients: w.accepting ?? true, referralCode: w.referralCode ?? null,
    })),
    patch(trainingLocationRepository, "findByPtUserId", async () =>
      (w.trainingGymIds ?? []).map((gymId) => ({ gymId, isActive: true })),
    ),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
    patch(gymClient, "listAcceptedGymsForPt", async () => {
      w.calls.list++;
      if (w.listFails) throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
      return w.gyms
        .filter((g) => g.listed !== false)
        .map((g) => ({ collaborationId: `agr-${g.id}`, gym: { id: g.id, name: g.name, city: g.city }, rates: { ...RATES } }));
    }),
    patch(gymClient, "getActiveCollaboration", async (gymId: string) => {
      w.calls.collab++;
      const g = byId.get(gymId);
      if (!g || g.collab === null) return null;
      return { collaborationId: `agr-${gymId}`, ...RATES, brandId: g.brandId, agreementScope: g.brandId ? "BRAND" : "BRANCH" };
    }),
    patch(gymClient, "getClientMembershipAtGym", async (clientId: string, gymId: string) => {
      w.calls.membership.push(`${clientId}:${gymId}`);
      if (w.membershipFails) throw new GymServiceUnavailableError(new Error("ECONNREFUSED"));
      const g = byId.get(gymId);
      if (!g) return null;
      const m = g.membership;
      return {
        hasActiveMembership: !!m,
        brandId: g.brandId,
        membership: m
          ? { membershipId: m.id, planName: m.planName, purchaseGymId: m.purchaseGymId, startDate: null, endDate: m.endDate }
          : null,
      };
    }),
  ]);
}

function composeRestores(rs: Array<() => void>): () => void {
  return () => rs.reverse().forEach((r) => r());
}

const opts = (w: World) => ({ ptUserId: w.ptUserId, packageId: w.packageId });

async function cleanup(w: World) {
  await prisma.ptRestriction.deleteMany({ where: { ptUserId: w.ptUserId } });
  await prisma.contract.deleteMany({ where: { ptUserId: w.ptUserId } });
}

const A1: FakeGym = { id: "gym-a1", name: "Alpha Quan 1", city: "HCM", brandId: "brand-a" };
const A2: FakeGym = { id: "gym-a2", name: "Alpha Quan 7", city: "HCM", brandId: "brand-a" };
const B1: FakeGym = { id: "gym-b1", name: "Beta Thu Duc", city: "HCM", brandId: "brand-b" };
const ownMembership = { id: "mem-1", planName: "Thang", purchaseGymId: "gym-a1", endDate: "2026-12-01T00:00:00.000Z" };

// ── gym lists ────────────────────────────────────────────────────────────────────────────────────

dbTest("PT with 0 gyms: empty list, reason NO_GYM_AGREEMENT, nothing else decided", { skip }, async () => {
  const w = newWorld({ gyms: [], referralCode: "PT-REF-1" });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.deepEqual(r.gyms, []);
    assert.equal(r.gymsReason, "NO_GYM_AGREEMENT");
    assert.equal(r.requestBlockedReason, null);
    assert.equal(r.pt.referralCode, "PT-REF-1");
    assert.equal(r.sessionMode, "OFFLINE");
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("PT with 1 gym, client WITH an active membership: facts annotated, no revenue-split rates leak", { skip }, async () => {
  const w = newWorld({ gyms: [{ ...A1, membership: ownMembership }] });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.equal(r.gymsReason, null);
    assert.deepEqual(r.gyms, [
      {
        gymId: "gym-a1", name: "Alpha Quan 1", city: "HCM", brandId: "brand-a", isPtTrainingLocation: false,
        membership: { hasActiveMembership: true, membershipId: "mem-1", planName: "Thang", endDate: "2026-12-01T00:00:00.000Z", purchasedHere: true },
        eligibility: { canRequest: true, reason: null }, // P3.3
      },
    ]);
    // The membership lookup is about THIS client (identity argument), at this branch.
    assert.deepEqual(w.calls.membership, [`${w.clientUserId}:gym-a1`]);
    const json = JSON.stringify(r);
    for (const leaked of ["platformRate", "ptRate", "gymRate", "rates", "agreementId", "collaborationId", "agr-gym-a1"]) {
      assert.ok(!json.includes(leaked), `response must not contain ${leaked}`);
    }
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("PT with 1 gym, client WITHOUT membership: branch still listed (nothing enforced), membership facts empty", { skip }, async () => {
  const w = newWorld({ gyms: [A1], referralCode: "PT-REF-2" });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.equal(r.gyms.length, 1);
    assert.deepEqual(r.gyms[0].membership, {
      hasActiveMembership: false, membershipId: null, planName: null, endDate: null, purchasedHere: false,
    });
    // P3.3: still listed, but the backend says it cannot be requested yet (and why)
    assert.deepEqual(r.gyms[0].eligibility, { canRequest: false, reason: "MEMBERSHIP_REQUIRED" });
    assert.equal(r.pt.referralCode, "PT-REF-2"); // so the UI can carry it into a membership purchase
    assert.equal(r.requestBlockedReason, null);
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("several gyms across brands: per-brand membership, brand-wide membership shows at the sibling branch, plan ordering", { skip }, async () => {
  // Client's membership: brand A, bought at A1. A2 is a sibling branch (valid there, not purchasedHere). B1: other brand, none.
  // PT trains at B1 -> it sorts first, then the branch where the membership was bought, then the rest by name.
  const w = newWorld({
    gyms: [
      { ...B1 },
      { ...A2, membership: ownMembership },
      { ...A1, membership: ownMembership },
    ],
    trainingGymIds: ["gym-b1"],
  });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.deepEqual(r.gyms.map((g) => g.gymId), ["gym-b1", "gym-a1", "gym-a2"]);
    const by = Object.fromEntries(r.gyms.map((g) => [g.gymId, g]));
    assert.equal(by["gym-b1"].isPtTrainingLocation, true);
    assert.equal(by["gym-b1"].membership.hasActiveMembership, false);
    assert.equal(by["gym-a1"].membership.purchasedHere, true);
    assert.equal(by["gym-a2"].membership.hasActiveMembership, true);
    assert.equal(by["gym-a2"].membership.purchasedHere, false);
    assert.deepEqual([...new Set(r.gyms.map((g) => g.brandId))].sort(), ["brand-a", "brand-b"]);
  } finally {
    restore();
    await cleanup(w);
  }
});

// ── exclusions: exactly what accept / request would refuse ─────────────────────────────────────

dbTest("a branch gym-service lists but the accept-time check refuses (closed / partner locked / agreement terminating) is NOT offered", { skip }, async () => {
  const w = newWorld({ gyms: [A1, { ...A2, collab: null }, { ...B1, collab: null }] });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.deepEqual(r.gyms.map((g) => g.gymId), ["gym-a1"]);
    // an excluded branch costs no membership lookup
    assert.deepEqual(w.calls.membership, [`${w.clientUserId}:gym-a1`]);
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("every excluded branch yields an empty list with NO_GYM_AGREEMENT (not a decision about booking without a gym)", { skip }, async () => {
  const w = newWorld({ gyms: [{ ...A1, collab: null }] });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.deepEqual(r.gyms, []);
    assert.equal(r.gymsReason, "NO_GYM_AGREEMENT");
    assert.equal(r.requestBlockedReason, null);
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("CONSISTENCY: everything offered, requestContract accepts; everything excluded, requestContract refuses (same fixture)", { skip }, async () => {
  // P3.3: a gym contract also needs a membership at the brand, so the client holds one at A1's and B1's brand
  // (the fixture's gym-service answer); A2 is excluded by its agreement, not by membership.
  const w = newWorld({
    gyms: [
      { ...A1, membership: ownMembership },
      { ...A2, collab: null },
      { ...B1, membership: { id: "mem-b", planName: "Thang B", purchaseGymId: "gym-b1", endDate: "2026-12-01T00:00:00.000Z" } },
    ],
  });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.ok(r.gyms.every((g) => g.eligibility.canRequest), "offered gyms are requestable for this client");
    const offered = new Set(r.gyms.map((g) => g.gymId));
    assert.deepEqual([...offered].sort(), ["gym-a1", "gym-b1"]);
    for (const g of w.gyms) {
      // a fresh client per attempt so the one-active-contract-per-pair rule does not interfere
      const client = randomUUID();
      const attempt = contractService.requestContract(client, { ptUserId: w.ptUserId, packageId: w.packageId, gymId: g.id });
      if (offered.has(g.id)) {
        const c = await attempt;
        assert.equal(c.gymId, g.id);
      } else {
        await assert.rejects(attempt, (e: any) => e.status === 400);
      }
    }
  } finally {
    restore();
    await cleanup(w);
  }
});

// ── trainer-side refusals come from the existing guards ──────────────────────────────────────────

dbTest("PT restricted at ACCOUNT level (suspension): blocked with the existing code, no branch evaluated", { skip }, async () => {
  const w = newWorld({ gyms: [A1] });
  const restore = install(w);
  try {
    await prisma.ptRestriction.create({
      data: { ptUserId: w.ptUserId, type: "TEMPORARY_SUSPENSION", reasonCategory: "OTHER", imposedBy: "admin-test" },
    });
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.equal(r.requestBlockedReason, "PT_TEMPORARILY_UNAVAILABLE");
    assert.equal(r.gymsReason, "REQUEST_BLOCKED");
    assert.deepEqual(r.gyms, []);
    assert.equal(w.calls.list, 0, "gym-service not asked about a trainer who takes no new business");
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("PT banned: PT_ACCOUNT_LOCKED", { skip }, async () => {
  const w = newWorld({ gyms: [A1] });
  const restore = install(w);
  try {
    await prisma.ptRestriction.create({
      data: { ptUserId: w.ptUserId, type: "PERMANENT_BAN", reasonCategory: "OTHER", imposedBy: "admin-test" },
    });
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.equal(r.requestBlockedReason, "PT_ACCOUNT_LOCKED");
    assert.deepEqual(r.gyms, []);
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("D38 regression: a CONTRACT-scope restriction on ANOTHER client's contract does not block this client", { skip }, async () => {
  const w = newWorld({ gyms: [A1] });
  const restore = install(w);
  try {
    const binh = randomUUID();
    const binhContract = await prisma.contract.create({
      data: {
        ptUserId: w.ptUserId, clientUserId: binh, status: "ACTIVE", packageName: "x", totalSessions: 10,
        price: new Prisma.Decimal("1000000"), sessionMode: SessionMode.OFFLINE,
      },
    });
    await prisma.ptRestriction.create({
      data: {
        ptUserId: w.ptUserId, type: "TEMPORARY_SUSPENSION", reasonCategory: "OTHER", imposedBy: "admin-test",
        scope: "CONTRACT", contractId: binhContract.id,
      },
    });
    const an = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.equal(an.requestBlockedReason, null);
    assert.deepEqual(an.gyms.map((g) => g.gymId), ["gym-a1"]);
    // Binh himself already has a running contract with this PT: the existing duplicate guard speaks.
    const b = await contractGymOptionsService.getGymOptions(binh, opts(w));
    assert.equal(b.requestBlockedReason, "ACTIVE_CONTRACT_EXISTS");
    assert.deepEqual(b.gyms, []);
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("PT not accepting clients: PT_NOT_ACCEPTING_CLIENTS", { skip }, async () => {
  const w = newWorld({ gyms: [A1], accepting: false });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.equal(r.requestBlockedReason, "PT_NOT_ACCEPTING_CLIENTS");
    assert.deepEqual(r.gyms, []);
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("ONLINE package: no branches, ONLINE_PACKAGE, gym-service never called", { skip }, async () => {
  const w = newWorld({ gyms: [A1], sessionMode: SessionMode.ONLINE });
  const restore = install(w);
  try {
    const r = await contractGymOptionsService.getGymOptions(w.clientUserId, opts(w));
    assert.equal(r.gymsReason, "ONLINE_PACKAGE");
    assert.deepEqual(r.gyms, []);
    assert.equal(r.requestBlockedReason, null);
    assert.equal(w.calls.list, 0);
  } finally {
    restore();
    await cleanup(w);
  }
});

// ── input and dependency failures ────────────────────────────────────────────────────────────────

dbTest("input validation mirrors requestContract: missing params 400, unknown package 404, other PT's package 400, withdrawn 422", { skip }, async () => {
  const w = newWorld({ gyms: [] });
  const restore = install(w);
  try {
    const status = async (q: any) => contractGymOptionsService.getGymOptions(w.clientUserId, q).then(() => 200, (e) => e.status);
    assert.equal(await status({}), 400);
    assert.equal(await status({ ptUserId: w.ptUserId }), 400);
    assert.equal(await status({ ptUserId: w.ptUserId, packageId: randomUUID() }), 404);
    assert.equal(await status({ ptUserId: randomUUID(), packageId: w.packageId }), 400);
    w.packageActive = false;
    assert.equal(await status(opts(w)), 422);
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("gym-service unreachable (list or membership lookup) -> 503, never an empty or guessed list", { skip }, async () => {
  for (const fail of ["listFails", "membershipFails"] as const) {
    const w = newWorld({ gyms: [A1], [fail]: true });
    const restore = install(w);
    try {
      await assert.rejects(contractGymOptionsService.getGymOptions(w.clientUserId, opts(w)), (e: any) => e.status === 503);
    } finally {
      restore();
      await cleanup(w);
    }
  }
});

// ── HTTP: real routes, identity from the verified token only ─────────────────────────────────────

async function withServer<T>(fn: (base: string) => Promise<T>): Promise<T> {
  const restoreAuth = patch(authServiceClient, "verifyToken", async (header: string) => {
    const [id, role] = header.replace("Bearer ", "").split("|");
    return { data: { user: { id, email: `${id}@test.local`, role: role || "CUSTOMER" } } };
  });
  const app = express();
  app.use(express.json());
  app.use("/contracts", contractRoutes);
  const server = app.listen(0);
  try {
    return await fn(`http://127.0.0.1:${(server.address() as AddressInfo).port}/contracts`);
  } finally {
    server.close();
    restoreAuth();
  }
}

dbTest("HTTP: GET /contracts/gym-options is routed ahead of /:id, needs a token, and takes the client from the token (a clientId in the query is ignored)", { skip }, async () => {
  const w = newWorld({ gyms: [{ ...A1, membership: ownMembership }] });
  const restore = install(w);
  try {
    await withServer(async (base) => {
      const q = `ptUserId=${w.ptUserId}&packageId=${w.packageId}`;
      assert.equal((await fetch(`${base}/gym-options?${q}`)).status, 401, "no token");

      const other = randomUUID();
      const res = await fetch(`${base}/gym-options?${q}&clientId=${other}&clientUserId=${other}`, {
        headers: { Authorization: `Bearer ${w.clientUserId}|CUSTOMER` },
      });
      assert.equal(res.status, 200);
      const body: any = await res.json();
      assert.deepEqual(body.gyms.map((g: any) => g.gymId), ["gym-a1"]);
      assert.deepEqual(w.calls.membership, [`${w.clientUserId}:gym-a1`], "membership asked for the token's user, not the query's");

      const bad = await fetch(`${base}/gym-options?ptUserId=${w.ptUserId}`, { headers: { Authorization: `Bearer ${w.clientUserId}|CUSTOMER` } });
      assert.equal(bad.status, 400);
    });
  } finally {
    restore();
    await cleanup(w);
  }
});

dbTest("HTTP: restricted PT answers 200 with the blocking code (a fact, not an error)", { skip }, async () => {
  const w = newWorld({ gyms: [A1] });
  const restore = install(w);
  try {
    await prisma.ptRestriction.create({
      data: { ptUserId: w.ptUserId, type: "TEMPORARY_SUSPENSION", reasonCategory: "OTHER", imposedBy: "admin-test" },
    });
    await withServer(async (base) => {
      const res = await fetch(`${base}/gym-options?ptUserId=${w.ptUserId}&packageId=${w.packageId}`, {
        headers: { Authorization: `Bearer ${w.clientUserId}|CUSTOMER` },
      });
      assert.equal(res.status, 200);
      const body: any = await res.json();
      assert.equal(body.requestBlockedReason, "PT_TEMPORARILY_UNAVAILABLE");
      assert.deepEqual(body.gyms, []);
    });
  } finally {
    restore();
    await cleanup(w);
  }
});
