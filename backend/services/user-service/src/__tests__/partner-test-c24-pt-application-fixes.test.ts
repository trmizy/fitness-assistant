/**
 * Partner-test 24/10 fixes in the PT application flow: C1-06 (review of an unknown id -> 404), C1-08 (phone format),
 * C1-10 (optional pagination, backward compatible), C4-02 (re-approval clears the rejection reason), C4-03 (draft
 * for an account with no profile creates it on demand).
 *
 * Mostly TEST FIXTURE (repository/service boundaries stubbed); the pagination block is BACKEND INTEGRATION and only
 * runs against an isolated *_test database (guard below).
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { prisma, profileRepository } from "../repositories/profile.repository";
import { ptApplicationRepository } from "../repositories/pt_application.repository";
import { ptApplicationService } from "../services/pt_application.service";
import { ptApplicationController } from "../controllers/pt_application.controller";
import { notificationService } from "../services/notification.service";
import { authServiceClient } from "../clients/auth-service.client";
import { isValidPhoneNumber } from "../utils/phone.util";
import { ptApplicationReviewNotice } from "../utils/ptApplicationNotice.util";
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
    headers: {} as Record<string, string>,
    status(code: number) {
      this.statusCode = code;
      return this;
    },
    json(body: unknown) {
      this.body = body;
      return this;
    },
    setHeader(name: string, value: string) {
      this.headers[name] = value;
    },
  };
  return res;
}

// ── C1-06 ──────────────────────────────────────────────────────────────────────

test("C1-06: reviewing an application that does not exist is 404 PT_APPLICATION_NOT_FOUND (was 400)", async () => {
  const restore = patch(ptApplicationRepository, "findById", async () => null);
  try {
    await assert.rejects(
      ptApplicationService.adminReviewAction("nope", "APPROVE", {}, "admin-1"),
      (e: any) => e.status === 404 && e.code === "PT_APPLICATION_NOT_FOUND" && /Không tìm thấy/.test(e.message),
    );
    const res = fakeRes();
    await ptApplicationController.reviewAction(
      { params: { id: "nope", action: "APPROVE" }, body: {}, user: { id: "admin-1" } } as any,
      res,
    );
    assert.equal(res.statusCode, 404);
    assert.equal(res.body.code, "PT_APPLICATION_NOT_FOUND");
  } finally {
    restore();
  }
});

test("C1-06: an unknown review action on an existing application stays a 400", async () => {
  const restore = patch(ptApplicationRepository, "findById", async () => ({
    id: "a1",
    status: "SUBMITTED",
    userProfile: { userId: "u1" },
  }));
  try {
    const res = fakeRes();
    await ptApplicationController.reviewAction(
      { params: { id: "a1", action: "EXPLODE" }, body: {}, user: { id: "admin-1" } } as any,
      res,
    );
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "INVALID_REVIEW_ACTION");
  } finally {
    restore();
  }
});

// ── C1-08 ──────────────────────────────────────────────────────────────────────

test("C1-08: phone helper accepts normal Vietnamese / international formats and rejects junk", () => {
  for (const ok of ["0901234567", "090 123 4567", "+84 901 234 567", "(028) 3822-1234", "090.123.4567"]) {
    assert.equal(isValidPhoneNumber(ok), true, ok);
  }
  for (const bad of ["abc", "", "123", "+++-----", "0901234567abc", "09012345678901234567890", "12 34 56 7", 123456789, null]) {
    assert.equal(isValidPhoneNumber(bad as any), false, String(bad));
  }
});

function draftHarness(opts: { profile: any | null }) {
  const calls: Record<string, any[]> = { upsertProfile: [], upsertDraft: [] };
  const restores = [
    patch(profileRepository, "findByUserId", async () => opts.profile),
    patch(profileRepository, "upsert", async (userId: string, data: any) => {
      calls.upsertProfile.push([userId, data]);
      return { id: "profile-new", userId, isPT: false };
    }),
    patch(ptApplicationRepository, "findByUserId", async () => null),
    patch(ptApplicationRepository, "upsertDraft", async (profileId: string, data: any) => {
      calls.upsertDraft.push([profileId, data]);
      return { id: "draft-1", status: "DRAFT", ...data };
    }),
  ];
  return { calls, restore: () => restores.forEach((r) => r()) };
}

test("C1-08: saving a draft with phoneNumber 'abc' is refused 400 INVALID_PHONE_NUMBER and nothing is written", async () => {
  const h = draftHarness({ profile: { id: "p1", isPT: false } });
  try {
    const res = fakeRes();
    await ptApplicationController.saveDraft({ user: { id: "u1" }, body: { phoneNumber: "abc" } } as any, res);
    assert.equal(res.statusCode, 400);
    assert.equal(res.body.code, "INVALID_PHONE_NUMBER");
    assert.match(res.body.error, /Số điện thoại không hợp lệ/);
    assert.equal(h.calls.upsertDraft.length, 0);
  } finally {
    h.restore();
  }
});

test("C1-08: a valid phone, an empty phone and no phone at all are all saved", async () => {
  const h = draftHarness({ profile: { id: "p1", isPT: false } });
  try {
    for (const body of [{ phoneNumber: "0901234567" }, { phoneNumber: "" }, { professionalBio: "x" }]) {
      const res = fakeRes();
      await ptApplicationController.saveDraft({ user: { id: "u1" }, body } as any, res);
      assert.equal(res.statusCode, 200, JSON.stringify(body));
    }
    assert.equal(h.calls.upsertDraft.length, 3);
  } finally {
    h.restore();
  }
});

test("C1-08: submit also refuses a junk number that an older draft already stored", async () => {
  const restore = patch(ptApplicationRepository, "findByUserId", async () => ({
    id: "a1",
    status: "DRAFT",
    phoneNumber: "abc",
    nationalIdNumber: "x",
    currentAddress: "x",
    idCardFrontUrl: "x",
    idCardBackUrl: "x",
    portraitPhotoUrl: "x",
    yearsOfExperience: 2,
    serviceMode: "ONLINE",
    mainSpecialties: ["a"],
  }));
  try {
    await assert.rejects(ptApplicationService.submit("u1"), (e: any) => e.code === "INVALID_PHONE_NUMBER");
  } finally {
    restore();
  }
});

// ── C4-03 ──────────────────────────────────────────────────────────────────────

test("C4-03: a draft for an account with no UserProfile creates the minimal profile on demand and saves", async () => {
  const h = draftHarness({ profile: null });
  try {
    const res = fakeRes();
    await ptApplicationController.saveDraft({ user: { id: "brand-new" }, body: { professionalBio: "hi" } } as any, res);
    assert.equal(res.statusCode, 200);
    assert.deepEqual(h.calls.upsertProfile, [["brand-new", {}]], "empty upsert: no onboarding field is invented");
    assert.equal(h.calls.upsertDraft[0][0], "profile-new", "the draft hangs on the profile just created");
  } finally {
    h.restore();
  }
});

test("C4-03: an existing profile is not re-created", async () => {
  const h = draftHarness({ profile: { id: "p1", isPT: false } });
  try {
    await ptApplicationController.saveDraft({ user: { id: "u1" }, body: {} } as any, fakeRes());
    assert.equal(h.calls.upsertProfile.length, 0);
  } finally {
    h.restore();
  }
});

// ── C4-02 ──────────────────────────────────────────────────────────────────────

function approvalHarness(app: any) {
  const updates: any[] = [];
  const notes: any[] = [];
  const restores = [
    patch(ptApplicationRepository, "findById", async () => app),
    patch(ptApplicationRepository, "updateStatus", async (_id: string, status: string, extra: any) => {
      updates.push({ status, extra });
      return app;
    }),
    patch(notificationService, "create", async (n: any) => {
      notes.push(n);
      return {} as any;
    }),
    patch(authServiceClient, "internalPatch", async () => ({ data: {} })),
    patch(authServiceClient, "internalGet", async () => ({ data: {} })),
    patch(profileRepository, "setIsPT", async () => undefined),
    patch(profileRepository, "findByUserId", async () => ({ referralCode: "ABCD2345" })),
  ];
  return { updates, notes, restore: () => restores.forEach((r) => r()) };
}

test("C4-02: approving a previously REJECTED application clears rejectionReason on the row", async () => {
  const app = {
    id: "a1",
    status: "REJECTED",
    rejectionReason: "QA c24: thử từ chối",
    userProfile: { userId: "u1", firstName: "A", email: "a@x" },
    certificates: [],
    media: [],
  };
  const h = approvalHarness(app);
  try {
    await ptApplicationService.adminReviewAction("a1", "APPROVE", {}, "admin-1");
    assert.equal(h.updates.length, 1);
    assert.equal(h.updates[0].status, "APPROVED");
    assert.equal(h.updates[0].extra.rejectionReason, null);
    assert.equal(h.updates[0].extra.reviewedByUserId, "admin-1");
  } finally {
    h.restore();
  }
});

test("C4-02: approving an application that never had a rejection reason does not touch the field", async () => {
  const app = { id: "a2", status: "SUBMITTED", userProfile: { userId: "u2", firstName: "A", email: "a@x" }, certificates: [], media: [] };
  const h = approvalHarness(app);
  try {
    await ptApplicationService.adminReviewAction("a2", "APPROVE", {}, "admin-1");
    assert.equal("rejectionReason" in h.updates[0].extra, false);
  } finally {
    h.restore();
  }
});

test("C4-02: the rejection reason is kept in the applicant's rejection notification (history survives the clear)", async () => {
  const app = { id: "a3", status: "SUBMITTED", userProfile: { userId: "u3", firstName: "A", email: "a@x" }, certificates: [], media: [] };
  const h = approvalHarness(app);
  try {
    await ptApplicationService.adminReviewAction("a3", "REJECT", { rejectionReason: "Chứng chỉ mờ" }, "admin-1");
    assert.match(h.notes[0].text, /chưa được chấp nhận/);
    assert.match(h.notes[0].text, /Lý do: Chứng chỉ mờ/);
  } finally {
    h.restore();
  }
  assert.doesNotMatch(ptApplicationReviewNotice("REJECTED")!.text, /Lý do:/, "no detail -> text unchanged");
});

// ── C1-10 ──────────────────────────────────────────────────────────────────────

test("C1-10: without page/limit the controller returns the plain array, exactly as before, and sets no paging headers", async () => {
  let pagingSeen: unknown = "unset";
  const restores = [
    patch(ptApplicationService, "listApplications", async (_f: any, paging?: any) => {
      pagingSeen = paging;
      return [{ id: "a", userProfile: { firstName: "A" } }];
    }),
    patch(ptApplicationService, "countApplications", async () => {
      throw new Error("count must not run without paging");
    }),
  ];
  try {
    const res = fakeRes();
    await ptApplicationController.listApplications({ query: { status: "APPROVED" } } as any, res);
    assert.equal(res.statusCode, 200);
    assert.ok(Array.isArray(res.body));
    assert.equal(pagingSeen, undefined);
    assert.deepEqual(res.headers, {});
  } finally {
    restores.forEach((r) => r());
  }
});

test("C1-10: with page/limit the same array shape is returned, sliced, with X-Total-Count; defaults fill the missing one", async () => {
  const seen: any[] = [];
  const restores = [
    patch(ptApplicationService, "listApplications", async (_f: any, paging?: any) => {
      seen.push(paging);
      return [{ id: "a", userProfile: {} }];
    }),
    patch(ptApplicationService, "countApplications", async () => 66),
  ];
  try {
    const res = fakeRes();
    await ptApplicationController.listApplications({ query: { page: "2", limit: "25" } } as any, res);
    assert.ok(Array.isArray(res.body));
    assert.deepEqual(seen[0], { page: 2, limit: 25 });
    assert.equal(res.headers["X-Total-Count"], "66");
    assert.equal(res.headers["X-Page"], "2");
    assert.equal(res.headers["X-Limit"], "25");

    await ptApplicationController.listApplications({ query: { limit: "10" } } as any, fakeRes());
    await ptApplicationController.listApplications({ query: { page: "3" } } as any, fakeRes());
    assert.deepEqual(seen[1], { page: 1, limit: 10 });
    assert.deepEqual(seen[2], { page: 3, limit: 20 });
  } finally {
    restores.forEach((r) => r());
  }
});

test("C1-10: malformed or out-of-range page/limit is a 400 INVALID_PAGINATION, never silently ignored", async () => {
  const restore = patch(ptApplicationService, "listApplications", async () => {
    throw new Error("must not be queried");
  });
  try {
    for (const query of [{ page: "0" }, { page: "-1" }, { page: "x" }, { limit: "0" }, { limit: "201" }, { limit: "1.5" }, { page: ["1", "2"] }, { limit: "" }]) {
      const res = fakeRes();
      await ptApplicationController.listApplications({ query } as any, res);
      assert.equal(res.statusCode, 400, JSON.stringify(query));
      assert.equal(res.body.code, "INVALID_PAGINATION");
    }
  } finally {
    restore();
  }
});

test("C1-10 (BACKEND INTEGRATION): repository paging slices a stable order and countAll matches the filter", { skip }, async () => {
  const profileIds: string[] = [];
  const tag = randomUUID().slice(0, 8);
  try {
    for (let i = 0; i < 5; i++) {
      const profile = await prisma.userProfile.create({ data: { userId: randomUUID(), firstName: `Pg${tag}` } });
      profileIds.push(profile.id);
      await prisma.pTApplication.create({
        data: { userProfileId: profile.id, status: "SUBMITTED", submittedAt: new Date(Date.now() - i * 1000), professionalBio: `pg-${tag}` },
      });
    }
    const filters = { search: `pg-${tag}` };
    assert.equal(await ptApplicationRepository.countAll(filters), 5);
    const all = await ptApplicationRepository.findAll(filters);
    const p1 = await ptApplicationRepository.findAll(filters, { page: 1, limit: 2 });
    const p2 = await ptApplicationRepository.findAll(filters, { page: 2, limit: 2 });
    const p3 = await ptApplicationRepository.findAll(filters, { page: 3, limit: 2 });
    assert.deepEqual([p1.length, p2.length, p3.length], [2, 2, 1]);
    assert.deepEqual([...p1, ...p2, ...p3].map((a) => a.id), all.map((a) => a.id), "pages concatenate to the unpaged list");
  } finally {
    await prisma.pTApplication.deleteMany({ where: { userProfileId: { in: profileIds } } });
    await prisma.userProfile.deleteMany({ where: { id: { in: profileIds } } });
  }
});
