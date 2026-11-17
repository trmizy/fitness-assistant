import { guardedTest as dbTest } from "./test-db-guard"; // runs only on a database whose name ends with _test
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { AuditEntityType, Prisma, SessionMode } from "../generated/prisma";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptServicePackageRepository } from "../repositories/pt_service_package.repository";
import { contractRepository } from "../repositories/contract.repository";
import { availabilityService } from "../services/availability.service";
import { notificationService } from "../services/notification.service";
import { gymClient } from "../clients/gym.client";
import { contractService } from "../services/contract.service";
import { contractController } from "../controllers/contract.controller";
import {
  INDEPENDENT_VENUE_ACK_REQUIRED,
  INDEPENDENT_VENUE_AUDIT_ACTION,
  INDEPENDENT_VENUE_CONSENT_SHA256,
  INDEPENDENT_VENUE_CONSENT_TEXT,
  INDEPENDENT_VENUE_CONSENT_VERSION,
} from "../services/independent-venue-consent";
import { installAccountsActive } from "./auth-accounts-active.test-helper";
import { stubPtRestrictionReads } from "./pt-restriction-reads.stub";
installAccountsActive();
stubPtRestrictionReads();

/**
 * N15M-14 - the independent-venue warning is enforced SERVER-side and the consent is recorded.
 *
 * BACKEND INTEGRATION on an isolated *_test database for the real requestContract / contractController code paths;
 * package / profile / gym-service / availability reads are TEST FIXTURES stubbed at their boundaries (as in the other contract-* suites).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function fakeRes() {
  const res: any = {
    statusCode: 200,
    body: undefined,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
  };
  return res;
}

const clientIds: string[] = [];

function world(mode: SessionMode = SessionMode.OFFLINE, lockedMode: SessionMode = mode) {
  const ptUserId = randomUUID();
  const clientUserId = randomUUID();
  clientIds.push(clientUserId);
  const packageId = randomUUID();
  const row = (m: SessionMode) => ({
    id: packageId, ptUserId, name: "Goi 10 buoi", sessionCount: 10, price: new Prisma.Decimal("5000000"),
    sessionMode: m, sessionDurationMinutes: 60, validityDays: 60, isActive: true, archivedAt: null, version: 1,
  });
  const restores = [
    patch(ptServicePackageRepository, "findById", async () => row(mode)),
    patch(ptServicePackageRepository, "findByIdForShare", async () => row(lockedMode)),
    patch(profileRepository, "findByUserId", async () => ({ isPT: true, ptSuspended: false, isAcceptingClients: true, referralCode: null })),
    patch(availabilityService, "countAvailableSlotsForPT", async () => 100),
    patch(notificationService, "create", async () => ({})),
    patch(gymClient, "getActiveCollaboration", async () => null),
    patch(contractRepository, "findActiveByPair", async () => null),
  ];
  return {
    ptUserId, clientUserId, packageId,
    restore: () => restores.forEach((r) => r()),
    body: (extra: Record<string, unknown> = {}) => ({ ptUserId, packageId, expectedPackageVersion: 1, ...extra }),
  };
}

const contractsOf = (clientUserId: string) => prisma.contract.count({ where: { clientUserId } });
const auditsOf = (clientUserId: string) =>
  prisma.auditLog.findMany({ where: { actorUserId: clientUserId, action: INDEPENDENT_VENUE_AUDIT_ACTION } });

dbTest.after(async () => {
  await prisma.auditLog.deleteMany({ where: { actorUserId: { in: clientIds } } });
  await prisma.contract.deleteMany({ where: { clientUserId: { in: clientIds } } });
  await prisma.clientCompatEvent.deleteMany({ where: { actorUserId: { in: clientIds } } });
});

dbTest("consent text: the stored hash is the sha256 of the shown text and the text states the non-responsibility", () => {
  assert.equal(INDEPENDENT_VENUE_CONSENT_SHA256, createHash("sha256").update(INDEPENDENT_VENUE_CONSENT_TEXT, "utf8").digest("hex"));
  assert.match(INDEPENDENT_VENUE_CONSENT_TEXT, /Gymini không chịu trách nhiệm/);
  assert.match(INDEPENDENT_VENUE_CONSENT_TEXT, /hai bên/);
});

dbTest("offline package, no gym, NO flag from the service layer (no HTTP ctx, e.g. the agent) -> 409 INDEPENDENT_VENUE_ACK_REQUIRED, Vietnamese message, nothing written, counted in compat events", async () => {
  const w = world();
  try {
    await assert.rejects(
      contractService.requestContract(w.clientUserId, w.body() as any, undefined, { clientHeader: "mobile/0.9/7", venueConsentHeader: "1" }),
      (e: any) => e.status === 409 && e.code === INDEPENDENT_VENUE_ACK_REQUIRED && /Gymini không chịu trách nhiệm/.test(e.message),
    );
    assert.equal(await contractsOf(w.clientUserId), 0, "no contract row");
    assert.equal((await auditsOf(w.clientUserId)).length, 0, "no consent row");
    const ev = await prisma.clientCompatEvent.findMany({ where: { actorUserId: w.clientUserId } });
    assert.ok(ev.some((e) => e.outcome === "INDEPENDENT_VENUE_ACK_MISSING" && e.clientHeader === "mobile/0.9/7"));
  } finally {
    w.restore();
  }
});

dbTest("only the literal true counts: false / 'true' / 1 / null are refused; the HTTP body carries the code", async () => {
  const w = world(SessionMode.HYBRID);
  try {
    for (const bad of [false, "true", 1, null]) {
      await assert.rejects(
        contractService.requestContract(w.clientUserId, w.body({ acknowledgedIndependentVenue: bad }) as any),
        (e: any) => e.code === INDEPENDENT_VENUE_ACK_REQUIRED,
        String(bad),
      );
    }
    const res = fakeRes();
    await contractController.requestContract(
      { headers: { "x-user-id": w.clientUserId, "x-gymini-venue-consent": "1" }, body: w.body(), get: () => null, socket: {} } as any,
      res,
    );
    assert.equal(res.statusCode, 409);
    assert.equal(res.body.code, INDEPENDENT_VENUE_ACK_REQUIRED);
    assert.match(res.body.error, /Tôi đồng ý/);
    assert.equal(await contractsOf(w.clientUserId), 0);
  } finally {
    w.restore();
  }
});

dbTest("offline + acknowledged -> contract created AND a consent audit row (who, when, version, sha256, text) in the same transaction", async () => {
  const w = world();
  try {
    const res = fakeRes();
    await contractController.requestContract(
      {
        headers: { "x-user-id": w.clientUserId, "x-gymini-client": "web/abc", "x-gymini-venue-consent": "1" },
        body: w.body({ acknowledgedIndependentVenue: true }),
        get: () => "UA-test",
        ip: "203.0.113.9",
        socket: {},
      } as any,
      res,
    );
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const contract = await prisma.contract.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.equal(contract.source, "INDEPENDENT");
    assert.equal(contract.gymId, null);
    const rows = await auditsOf(w.clientUserId);
    assert.equal(rows.length, 1);
    const a = rows[0];
    assert.equal(a.entityType, AuditEntityType.CONTRACT);
    assert.equal(a.entityId, contract.id);
    assert.equal(a.actorUserId, w.clientUserId);
    assert.ok(Math.abs(Date.now() - a.createdAt.getTime()) < 60_000, "when");
    const m = a.metadata as any;
    assert.equal(m.consentVersion, INDEPENDENT_VENUE_CONSENT_VERSION);
    assert.equal(m.consentTextSha256, INDEPENDENT_VENUE_CONSENT_SHA256);
    assert.equal(m.consentText, INDEPENDENT_VENUE_CONSENT_TEXT);
    assert.equal(m.sessionMode, "OFFLINE");
    assert.equal(m.packageId, w.packageId);
    assert.equal(m.clientHeader, "web/abc");
    assert.equal(a.userAgent, "UA-test");
  } finally {
    w.restore();
  }
});

dbTest("online package needs no acknowledgement and records none", async () => {
  const w = world(SessionMode.ONLINE);
  try {
    const c = await contractService.requestContract(w.clientUserId, w.body() as any);
    assert.equal(c.sessionMode, "ONLINE");
    assert.equal((await auditsOf(w.clientUserId)).length, 0);
  } finally {
    w.restore();
  }
});

dbTest("package read as ONLINE up front but OFFLINE on the locked row (switched meanwhile) is judged on the locked row -> refused, nothing written", async () => {
  const w = world(SessionMode.ONLINE, SessionMode.OFFLINE);
  try {
    await assert.rejects(
      contractService.requestContract(w.clientUserId, w.body() as any),
      (e: any) => e.code === INDEPENDENT_VENUE_ACK_REQUIRED,
    );
    assert.equal(await contractsOf(w.clientUserId), 0);
  } finally {
    w.restore();
  }
});

dbTest("the AI-agent confirmation path is not a bypass: no flag -> refused", async () => {
  const w = world();
  try {
    await assert.rejects(
      contractService.requestContract(
        w.clientUserId,
        { ptUserId: w.ptUserId, packageId: w.packageId },
        { actionId: randomUUID(), expectedPrice: 5_000_000, expectedSessions: 10, expectedMinutes: 60, expectedMode: "OFFLINE" },
      ),
      (e: any) => e.code === INDEPENDENT_VENUE_ACK_REQUIRED,
    );
    assert.equal(await contractsOf(w.clientUserId), 0);
  } finally {
    w.restore();
  }
});

// -- legacy grace: an app that predates the consent step must keep working (owner decision 16/11) --
const httpReq = (w: ReturnType<typeof world>, headers: Record<string, string>, body: Record<string, unknown>) => ({
  headers: { "x-user-id": w.clientUserId, ...headers },
  body,
  get: () => "UA-old",
  ip: "203.0.113.7",
  socket: {},
});
const withEnv = async (env: Record<string, string | undefined>, fn: () => Promise<void>) => {
  const saved: Record<string, string | undefined> = {};
  for (const k of Object.keys(env)) {
    saved[k] = process.env[k];
    if (env[k] === undefined) delete process.env[k];
    else process.env[k] = env[k];
  }
  try {
    await fn();
  } finally {
    for (const k of Object.keys(saved)) {
      if (saved[k] === undefined) delete process.env[k];
      else process.env[k] = saved[k];
    }
  }
};

dbTest("LEGACY GRACE: an old app (no X-Gymini-Venue-Consent, flag missing) is accepted, audited with its version, and counted - in the same transaction", async () => {
  const w = world();
  try {
    const res = fakeRes();
    await contractController.requestContract(httpReq(w, { "x-gymini-client": "mobile/1.0.0/41" }, w.body()) as any, res);
    assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    const rows = await prisma.auditLog.findMany({ where: { actorUserId: w.clientUserId, entityId: res.body.id } });
    assert.deepEqual(rows.map((r) => r.action), ["CONTRACT_INDEPENDENT_VENUE_ACK_MISSING_LEGACY"]);
    const m = rows[0].metadata as any;
    assert.equal(m.clientVersion, "mobile/1.0.0/41");
    assert.equal(m.graceReason, "CLIENT_PREDATES_VENUE_CONSENT");
    assert.equal(rows[0].userAgent, "UA-old");
    const ev = await prisma.clientCompatEvent.findMany({ where: { actorUserId: w.clientUserId, outcome: "INDEPENDENT_VENUE_LEGACY_ACCEPTED" } });
    assert.equal(ev.length, 1);
    assert.equal(ev[0].clientHeader, "mobile/1.0.0/41");
    // still an independent contract, so the contract-detail note keeps showing
    const c = await prisma.contract.findUniqueOrThrow({ where: { id: res.body.id } });
    assert.equal(c.source, "INDEPENDENT");
    assert.equal(c.gymId, null);
    assert.equal(c.sessionMode, "OFFLINE");
  } finally {
    w.restore();
  }
});

dbTest("LEGACY GRACE is not a bypass: a NEW client (capability header) without the flag, or anyone sending an explicit false, is refused", async () => {
  const w = world();
  try {
    const cases: Array<[Record<string, string>, Record<string, unknown>]> = [
      [{ "x-gymini-venue-consent": "1" }, w.body()],
      [{ "x-gymini-venue-consent": "2", "x-gymini-client": "web/abc" }, w.body()],
      [{}, w.body({ acknowledgedIndependentVenue: false })],
      [{ "x-gymini-venue-consent": "1" }, w.body({ acknowledgedIndependentVenue: false })],
      [{ "x-gymini-venue-consent": "" }, w.body({ acknowledgedIndependentVenue: "yes" })],
    ];
    for (const [headers, body] of cases) {
      const res = fakeRes();
      await contractController.requestContract(httpReq(w, headers, body) as any, res);
      assert.equal(res.statusCode, 409, JSON.stringify([headers, body]));
      assert.equal(res.body.code, INDEPENDENT_VENUE_ACK_REQUIRED);
    }
    assert.equal(await contractsOf(w.clientUserId), 0);
  } finally {
    w.restore();
  }
});

dbTest("LEGACY GRACE switches: INDEPENDENT_VENUE_LEGACY_GRACE=false, or a cutoff date in the past, refuses an old app; a future cutoff still accepts", async () => {
  const w = world();
  try {
    await withEnv({ INDEPENDENT_VENUE_LEGACY_GRACE: "false" }, async () => {
      const res = fakeRes();
      await contractController.requestContract(httpReq(w, {}, w.body()) as any, res);
      assert.equal(res.statusCode, 409);
    });
    await withEnv({ INDEPENDENT_VENUE_LEGACY_GRACE_UNTIL: "2020-01-01T00:00:00Z" }, async () => {
      const res = fakeRes();
      await contractController.requestContract(httpReq(w, {}, w.body()) as any, res);
      assert.equal(res.statusCode, 409);
    });
    assert.equal(await contractsOf(w.clientUserId), 0);
    await withEnv({ INDEPENDENT_VENUE_LEGACY_GRACE_UNTIL: "2099-01-01T00:00:00Z" }, async () => {
      const res = fakeRes();
      await contractController.requestContract(httpReq(w, {}, w.body()) as any, res);
      assert.equal(res.statusCode, 201, JSON.stringify(res.body));
    });
  } finally {
    w.restore();
  }
});

dbTest("LEGACY GRACE: an old app on an ONLINE package is untouched (no audit, no event)", async () => {
  const w = world(SessionMode.ONLINE);
  try {
    const res = fakeRes();
    await contractController.requestContract(httpReq(w, {}, w.body()) as any, res);
    assert.equal(res.statusCode, 201);
    assert.equal(await prisma.auditLog.count({ where: { actorUserId: w.clientUserId } }), 0);
    assert.equal(await prisma.clientCompatEvent.count({ where: { actorUserId: w.clientUserId } }), 0);
  } finally {
    w.restore();
  }
});
