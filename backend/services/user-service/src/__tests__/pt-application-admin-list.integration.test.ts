/**
 * Admin PT-application list (B01 / B02) and idempotent approval (B08).
 *
 * B01  GET /pt-applications/admin answered 500 for the unfiltered list and for status=APPROVED on the partner's
 *      seeded database. Root cause (BACKEND INTEGRATION below reproduces it): the list embeds the trainer's whole
 *      `userProfile` row, which carries `ptLockSeq` - a BIGINT that Prisma returns as a JS BigInt - and
 *      `res.json` cannot serialize a BigInt. Only trainers that were ever locked have it set, hence "some APPROVED rows".
 * B02  an invalid ?status (NEEDS_INFO, lowercase, empty, repeated) must be a 400 with a code, not a Prisma 500.
 * B08  approving an application that is already APPROVED has no side effects.
 *
 * Evidence label: BACKEND INTEGRATION against an isolated *_test database, e.g.
 *   DATABASE_URL=postgresql://gymcoach_test:gymcoach_test_password@localhost:55433/gymcoach_user_test ./node_modules/.bin/tsx --test src/__tests__/pt-application-admin-list.integration.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma } from "../repositories/profile.repository";
import { ptApplicationRepository } from "../repositories/pt_application.repository";
import { profileRepository } from "../repositories/profile.repository";
import { ptApplicationService } from "../services/pt_application.service";
import { ptApplicationController } from "../controllers/pt_application.controller";
import { notificationService } from "../services/notification.service";
import { authServiceClient } from "../clients/auth-service.client";
import { skip } from "./test-db-guard";

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
      // Exactly what express does with the body: this is where a BigInt blew up.
      JSON.stringify(body);
      return this;
    },
  };
  return res;
}

const created: { profileIds: string[] } = { profileIds: [] };

async function makeApplication(opts: { status: "APPROVED" | "REJECTED" | "SUBMITTED"; locked?: boolean }) {
  const userId = randomUUID();
  const profile = await prisma.userProfile.create({
    data: {
      userId,
      isPT: opts.status === "APPROVED",
      firstName: "Seed",
      lastName: opts.locked ? "Locked" : "Open",
      email: `${userId}@seed.test`,
      ...(opts.locked ? { ptLockSeq: BigInt(7) } : {}),
    },
  });
  created.profileIds.push(profile.id);
  const app = await prisma.pTApplication.create({
    data: {
      userProfileId: profile.id,
      status: opts.status,
      submittedAt: new Date(),
      certificates: { create: [{ certificateName: "ACE", issuingOrganization: "ACE", isCurrentlyValid: true }] },
      media: { create: [{ groupType: "PORTFOLIO", fileUrl: "/uploads/pt-applications/x.png" }] },
    },
  });
  return { userId, profile, app };
}

test.after(async () => {
  if (skip) return;
  await prisma.pTApplication.deleteMany({ where: { userProfileId: { in: created.profileIds } } });
  await prisma.userProfile.deleteMany({ where: { id: { in: created.profileIds } } });
});

test("B01 root cause: the raw repository row of a once-locked trainer cannot be JSON-serialized", { skip }, async () => {
  const { app } = await makeApplication({ status: "APPROVED", locked: true });
  const rows = await ptApplicationRepository.findAll({ status: "APPROVED" as any });
  const row = rows.find((r) => r.id === app.id);
  assert.ok(row, "the seeded application is in the repository result");
  assert.equal(typeof (row as any).userProfile.ptLockSeq, "bigint");
  assert.throws(() => JSON.stringify(rows), /BigInt/);
});

test("B01: listApplications (unfiltered and APPROVED) serializes even when a trainer was once locked", { skip }, async () => {
  const locked = await makeApplication({ status: "APPROVED", locked: true });
  const open = await makeApplication({ status: "APPROVED" });
  const restoreAuth = patch(authServiceClient, "internalGet", async () => ({ data: {} }));
  try {
    for (const filters of [{}, { status: "APPROVED" }]) {
      const list = await ptApplicationService.listApplications(filters);
      const json = JSON.stringify(list); // must not throw
      assert.ok(list.some((a: any) => a.id === locked.app.id), "the locked trainer's application is listed");
      assert.ok(list.some((a: any) => a.id === open.app.id), "an ordinary application is listed");
      const lockedRow = list.find((a: any) => a.id === locked.app.id);
      assert.equal("ptLockSeq" in lockedRow.userProfile, false, "internal lock sequence is not exposed");
      assert.equal(lockedRow.userProfile.userId, locked.userId, "the rest of the profile is kept");
      assert.ok(json.length > 0);
    }
  } finally {
    restoreAuth();
  }
});

test("B01 (controller): GET /admin answers 200 with a serializable body for a locked trainer's application", { skip }, async () => {
  await makeApplication({ status: "APPROVED", locked: true });
  const restoreAuth = patch(authServiceClient, "internalGet", async () => ({ data: {} }));
  const res = fakeRes();
  try {
    await ptApplicationController.listApplications({ query: { status: "APPROVED" } } as any, res);
  } finally {
    restoreAuth();
  }
  assert.equal(res.statusCode, 200);
  assert.ok(Array.isArray(res.body) && res.body.length > 0);
});

test("B01 resilience: one row that cannot be prepared does not fail the whole list", async () => {
  const good = { id: "a-good", userProfile: { userId: "u1", firstName: "A", email: "a@x" }, certificates: [], media: [] };
  // A document URL field of the wrong type makes signing throw for this row only.
  const bad = { id: "a-bad", userProfile: { userId: "u2", firstName: "B", email: "b@x", ptLockSeq: BigInt(3) }, certificates: [{ certificateFileUrl: 42 }], media: [] };
  const restore = patch(ptApplicationRepository, "findAll", async () => [good, bad]);
  try {
    const list = await ptApplicationService.listApplications({});
    assert.equal(list.length, 2);
    JSON.stringify(list);
  } finally {
    restore();
  }
});

test("B02: an invalid ?status is a 400 with a Vietnamese message and a machine code, never a 500", async () => {
  for (const bad of ["NEEDS_INFO", "approved", "", ["APPROVED", "REJECTED"], "APPROVED "]) {
    let listCalled = false;
    const restore = patch(ptApplicationService, "listApplications", async () => {
      listCalled = true;
      return [];
    });
    const res = fakeRes();
    try {
      await ptApplicationController.listApplications({ query: { status: bad } } as any, res);
    } finally {
      restore();
    }
    assert.equal(res.statusCode, 400, `status=${JSON.stringify(bad)}`);
    assert.equal(res.body.code, "INVALID_STATUS_FILTER");
    assert.match(res.body.error, /Trạng thái lọc không hợp lệ/);
    assert.match(res.body.error, /NEEDS_MORE_INFO/, "lists the valid values");
    assert.equal(listCalled, false, "nothing is queried for a bad filter");
  }
});

test("B02: a valid status and no status at all still reach the list", async () => {
  for (const query of [{}, { status: "APPROVED" }, { status: "NEEDS_MORE_INFO" }, { search: "x" }]) {
    const restore = patch(ptApplicationService, "listApplications", async () => []);
    const res = fakeRes();
    try {
      await ptApplicationController.listApplications({ query } as any, res);
    } finally {
      restore();
    }
    assert.equal(res.statusCode, 200, JSON.stringify(query));
  }
});

function approvalHarness(status: string) {
  const calls: string[] = [];
  const app = { id: "app-b08", status, userProfile: { userId: "pt-b08", firstName: "A", email: "a@x" }, certificates: [], media: [] };
  const restores = [
    patch(ptApplicationRepository, "findById", async () => app),
    patch(ptApplicationRepository, "updateStatus", async () => {
      calls.push("updateStatus");
      return app;
    }),
    patch(notificationService, "create", async () => {
      calls.push("notification");
      return {} as any;
    }),
    patch(authServiceClient, "internalPatch", async () => {
      calls.push("roleSync");
      return { data: {} };
    }),
    patch(authServiceClient, "internalGet", async () => ({ data: {} })),
    patch(profileRepository, "setIsPT", async () => {
      calls.push("setIsPT");
    }),
  ];
  return { calls, restore: () => restores.forEach((r) => r()) };
}

test("B08: approving an already APPROVED application changes nothing and notifies nobody", async () => {
  const h = approvalHarness("APPROVED");
  try {
    const result: any = await ptApplicationService.adminReviewAction("app-b08", "APPROVE", {}, "admin-1");
    assert.equal(result.id, "app-b08");
    assert.equal(result.status, "APPROVED");
  } finally {
    h.restore();
  }
  assert.deepEqual(h.calls, [], "no role sync, no profile write, no status write, no notification");
});

test("B08: a REJECTED application can still be re-approved (the deliberate reconsider path) and runs in full", async () => {
  const h = approvalHarness("REJECTED");
  try {
    await ptApplicationService.adminReviewAction("app-b08", "APPROVE", {}, "admin-1");
  } finally {
    h.restore();
  }
  assert.ok(h.calls.includes("roleSync"));
  assert.ok(h.calls.includes("setIsPT"));
  assert.ok(h.calls.includes("updateStatus"));
  assert.ok(h.calls.includes("notification"));
});
