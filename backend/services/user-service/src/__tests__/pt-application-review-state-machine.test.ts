import test from "node:test";
import assert from "node:assert/strict";
import {
  ptApplicationService,
  adminMayReview,
  MAX_PT_APPLICATION_REJECTIONS,
} from "../services/pt_application.service";
import { ptApplicationRepository } from "../repositories/pt_application.repository";
import { profileRepository } from "../repositories/profile.repository";
import { authServiceClient } from "../clients/auth-service.client";
import { notificationService } from "../services/notification.service";

/**
 * Q2 + Q1 (owner decisions 14/11/2026) - PT application state machine and the "3 rejections per account" limit.
 *
 * TEST FIXTURE: repositories and auth-service are monkey-patched, no database. Every allowed and every refused
 * (status x action) pair of the ADMIN review is asserted, together with "refused = 409 INVALID_APPLICATION_TRANSITION and
 * nothing written" and "allowed = exactly one status write".
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

type Harness = {
  writes: string[];
  audits: any[];
  roleSyncs: number;
  notices: number;
  restore: () => void;
};

function harness(app: any, opts: { rejections?: number } = {}): Harness {
  const h: Harness = { writes: [], audits: [], roleSyncs: 0, notices: 0, restore: () => undefined };
  const restores = [
    patch(ptApplicationRepository, "findById", async () => app),
    patch(ptApplicationRepository, "findByUserId", async () => app),
    patch(ptApplicationRepository, "countRejectionAudits", async () => opts.rejections ?? 0),
    patch(ptApplicationRepository, "recordRejectionAudit", async (a: any) => {
      h.audits.push(a);
      return {};
    }),
    patch(ptApplicationRepository, "updateStatus", async (_id: string, status: string) => {
      h.writes.push(status);
      return app;
    }),
    patch(ptApplicationRepository, "upsertDraft", async () => {
      h.writes.push("upsertDraft");
      return { id: app?.id, status: "DRAFT" };
    }),
    patch(notificationService, "create", async () => {
      h.notices++;
      return {} as any;
    }),
    patch(authServiceClient, "internalPatch", async () => {
      h.roleSyncs++;
      return { data: {} };
    }),
    patch(authServiceClient, "internalGet", async () => ({ data: {} })),
    patch(profileRepository, "setIsPT", async () => undefined),
    patch(profileRepository, "findByUserId", async () => ({ id: "p1", isPT: false, referralCode: "ABCD2345" })),
  ];
  h.restore = () => restores.forEach((r) => r());
  return h;
}

const appIn = (status: string) => ({
  id: "app-1",
  status,
  userProfile: { userId: "u-applicant", firstName: "A", email: "a@x" },
  certificates: [],
  media: [],
});

const PAYLOAD: Record<string, any> = {
  UNDER_REVIEW: {},
  NEEDS_MORE_INFO: { adminNote: "Cần bổ sung ảnh chứng chỉ" },
  APPROVED: {},
  REJECTED: { rejectionReason: "Chứng chỉ không hợp lệ" },
};
const ACTIONS = ["UNDER_REVIEW", "NEEDS_MORE_INFO", "APPROVED", "REJECTED"] as const;

// ── Q2: allowed transitions (SUBMITTED / UNDER_REVIEW -> any of the four) ───────────────────────────────────
for (const from of ["SUBMITTED", "UNDER_REVIEW"]) {
  for (const action of ACTIONS) {
    test(`Q2 allowed: admin ${from} -> ${action} writes exactly one status`, async () => {
      const h = harness(appIn(from));
      try {
        await ptApplicationService.adminReviewAction("app-1", action, PAYLOAD[action], "admin-1");
        assert.deepEqual(h.writes, [action]);
        assert.equal(h.audits.length, action === "REJECTED" ? 1 : 0, "a rejection (and only a rejection) is counted in the audit trail");
        assert.equal(h.roleSyncs, action === "APPROVED" ? 1 : 0);
      } finally {
        h.restore();
      }
    });
  }
}

test("Q2 allowed: APPROVED -> APPROVED stays an idempotent no-op (no write, no role sync, no notice)", async () => {
  const h = harness(appIn("APPROVED"));
  try {
    const res: any = await ptApplicationService.adminReviewAction("app-1", "APPROVE", {}, "admin-1");
    assert.equal(res.status, "APPROVED");
    assert.deepEqual(h.writes, []);
    assert.equal(h.roleSyncs, 0);
    assert.equal(h.notices, 0);
  } finally {
    h.restore();
  }
});

// ── Q2: refused transitions ────────────────────────────────────────────────────────────────────────────────
const REFUSED: Array<[string, (typeof ACTIONS)[number]]> = [];
for (const from of ["DRAFT", "NEEDS_MORE_INFO", "REJECTED"]) for (const a of ACTIONS) REFUSED.push([from, a]);
for (const a of ["UNDER_REVIEW", "NEEDS_MORE_INFO", "REJECTED"] as const) REFUSED.push(["APPROVED", a]);

for (const [from, action] of REFUSED) {
  test(`Q2 refused: admin ${from} -> ${action} is 409 INVALID_APPLICATION_TRANSITION and nothing is written`, async () => {
    const h = harness(appIn(from));
    try {
      await assert.rejects(
        () => ptApplicationService.adminReviewAction("app-1", action, PAYLOAD[action], "admin-1"),
        (e: any) => {
          assert.equal(e.status, 409);
          assert.equal(e.code, "INVALID_APPLICATION_TRANSITION");
          assert.match(e.message, /Không thể chuyển đơn/);
          return true;
        },
      );
      assert.deepEqual(h.writes, [], "no status write");
      assert.deepEqual(h.audits, [], "no rejection counted");
      assert.equal(h.roleSyncs, 0, "no role sync");
      assert.equal(h.notices, 0, "no notification");
    } finally {
      h.restore();
    }
  });
}

test("Q2: adminMayReview is exactly SUBMITTED and UNDER_REVIEW (the web page uses the same rule)", () => {
  const all = ["DRAFT", "SUBMITTED", "UNDER_REVIEW", "NEEDS_MORE_INFO", "APPROVED", "REJECTED"];
  assert.deepEqual(all.filter(adminMayReview), ["SUBMITTED", "UNDER_REVIEW"]);
});

// ── Q1: re-apply after a rejection, at most 3 rejections per account ───────────────────────────────────────
test("Q1: a REJECTED applicant with 1 rejection may save a new draft - the row reopens as DRAFT", async () => {
  const h = harness({ ...appIn("REJECTED"), rejectionReason: "x" }, { rejections: 1 });
  try {
    await ptApplicationService.saveDraft("u-applicant", { professionalBio: "bản mới" });
    assert.deepEqual(h.writes, ["upsertDraft", "DRAFT"]);
  } finally {
    h.restore();
  }
});

test("Q1: with 3 rejections saveDraft is 409 PT_APPLICATION_LIMIT_REACHED (Vietnamese) and nothing is written", async () => {
  const h = harness(appIn("REJECTED"), { rejections: MAX_PT_APPLICATION_REJECTIONS });
  try {
    await assert.rejects(
      () => ptApplicationService.saveDraft("u-applicant", { professionalBio: "x" }),
      (e: any) => e.status === 409 && e.code === "PT_APPLICATION_LIMIT_REACHED" && /Tài khoản đã bị từ chối 3 lần/.test(e.message),
    );
    assert.deepEqual(h.writes, []);
  } finally {
    h.restore();
  }
});

test("Q1: with 3 rejections submit is 409 PT_APPLICATION_LIMIT_REACHED as well", async () => {
  const h = harness(appIn("REJECTED"), { rejections: 3 });
  try {
    await assert.rejects(
      () => ptApplicationService.submit("u-applicant"),
      (e: any) => e.status === 409 && e.code === "PT_APPLICATION_LIMIT_REACHED",
    );
    assert.deepEqual(h.writes, []);
  } finally {
    h.restore();
  }
});

test("Q1: a legacy REJECTED row with no audit row counts as ONE rejection (2 attempts left), not zero", async () => {
  const h = harness(appIn("REJECTED"), { rejections: 0 });
  const restoreAvail = patch(await import("../services/availability.service").then((m) => m.availabilityService), "getAvailability", async () => []);
  try {
    const me: any = await ptApplicationService.getMe("u-applicant");
    assert.equal(me.rejectionCount, 1);
    assert.equal(me.maxRejections, 3);
    assert.equal(me.remainingAttempts, 2);
  } finally {
    restoreAvail();
    h.restore();
  }
});

test("Q1: getMe reports 0 attempts left after the 3rd rejection", async () => {
  const h = harness(appIn("REJECTED"), { rejections: 3 });
  const restoreAvail = patch(await import("../services/availability.service").then((m) => m.availabilityService), "getAvailability", async () => []);
  try {
    const me: any = await ptApplicationService.getMe("u-applicant");
    assert.equal(me.remainingAttempts, 0);
  } finally {
    restoreAvail();
    h.restore();
  }
});

test("Q1: an application that is still UNDER_REVIEW cannot be edited as a draft (unchanged rule)", async () => {
  const h = harness(appIn("UNDER_REVIEW"), { rejections: 0 });
  try {
    await assert.rejects(() => ptApplicationService.saveDraft("u-applicant", {}), /đang được xét duyệt/);
    assert.deepEqual(h.writes, []);
  } finally {
    h.restore();
  }
});
