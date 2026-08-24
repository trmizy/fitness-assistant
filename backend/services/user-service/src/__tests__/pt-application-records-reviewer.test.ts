import test from "node:test";
import assert from "node:assert/strict";
import { ptApplicationService } from "../services/pt_application.service";
import { ptApplicationRepository } from "../repositories/pt_application.repository";

/**
 * Money-flow plan 5.5 — resolving the flagged gap at pt_application.service.ts's
 * adminReviewAction: reviewedAt/approvedAt were recorded, but WHO reviewed/approved/rejected
 * an application was never persisted anywhere — an audit-trail gap explicitly flagged during
 * this session as worth prioritizing if feasible. Schema gained `reviewedByUserId`
 * (migration), and adminReviewAction now takes the acting admin's own id as an explicit
 * parameter (never trusted from the request body — same reasoning contract prices and
 * withdrawal ownerIds never come from the body either) and records it on every review action,
 * not just approval.
 *
 * No real DB — ptApplicationRepository is monkey-patched per test.
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("rejecting an application records which admin rejected it", async () => {
  const updateCalls: any[] = [];
  const restoreFind = patch(ptApplicationRepository, "findById", async () => ({
    id: "app-1",
    userProfile: { userId: "pt-candidate-1" },
  }));
  const restoreUpdate = patch(ptApplicationRepository, "updateStatus", async (id: string, status: string, extra: any) => {
    updateCalls.push({ id, status, extra });
    return { id, status, ...extra };
  });

  try {
    await ptApplicationService.adminReviewAction(
      "app-1",
      "REJECT",
      { rejectionReason: "Chứng chỉ không hợp lệ" },
      "admin-42",
    );
    assert.equal(updateCalls.length, 1);
    assert.equal(updateCalls[0].extra.reviewedByUserId, "admin-42");
    assert.equal(updateCalls[0].extra.rejectionReason, "Chứng chỉ không hợp lệ");
  } finally {
    restoreFind();
    restoreUpdate();
  }
});

test("requesting more info records which admin asked for it", async () => {
  const updateCalls: any[] = [];
  const restoreFind = patch(ptApplicationRepository, "findById", async () => ({
    id: "app-2",
    userProfile: { userId: "pt-candidate-2" },
  }));
  const restoreUpdate = patch(ptApplicationRepository, "updateStatus", async (id: string, status: string, extra: any) => {
    updateCalls.push({ id, status, extra });
    return { id, status, ...extra };
  });

  try {
    await ptApplicationService.adminReviewAction(
      "app-2",
      "REQUEST_INFO",
      { adminNote: "Cần ảnh chứng chỉ rõ hơn" },
      "admin-7",
    );
    assert.equal(updateCalls[0].extra.reviewedByUserId, "admin-7");
  } finally {
    restoreFind();
    restoreUpdate();
  }
});

test("two different admins acting on two different applications each get their own id recorded — not swapped or shared", async () => {
  const updateCalls: any[] = [];
  const restoreFind = patch(ptApplicationRepository, "findById", async () => ({
    id: "app-x",
    userProfile: { userId: "pt-candidate-x" },
  }));
  const restoreUpdate = patch(ptApplicationRepository, "updateStatus", async (id: string, _status: string, extra: any) => {
    updateCalls.push({ id, extra });
    return {};
  });

  try {
    await ptApplicationService.adminReviewAction("app-x", "REJECT", { rejectionReason: "r1" }, "admin-A");
    await ptApplicationService.adminReviewAction("app-x", "REJECT", { rejectionReason: "r2" }, "admin-B");
    assert.equal(updateCalls[0].extra.reviewedByUserId, "admin-A");
    assert.equal(updateCalls[1].extra.reviewedByUserId, "admin-B");
  } finally {
    restoreFind();
    restoreUpdate();
  }
});
