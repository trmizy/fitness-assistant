import test from "node:test";
import assert from "node:assert/strict";
import { contractRepository } from "../repositories/contract.repository";
import { sessionRepository } from "../repositories/session.repository";
import { contractService } from "../services/contract.service";
import { bookingService } from "../services/booking.service";
import { contractController } from "../controllers/contract.controller";

/**
 * User-facing refusals of the contract / booking flows are Vietnamese, while the HTTP status and the machine
 * `code` stay as they were (TEST FIXTURE: repositories stubbed at their boundary).
 */

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

const NO_ENGLISH = /Cancellation reason|Contract not found|Not authorized|Session not found|Cannot |is required/;

test("PATCH /contracts/:id/cancel without a reason: 400 with a Vietnamese message", async () => {
  await assert.rejects(contractService.cancelContract("c1", "u1", "   "), (e: any) => {
    assert.equal(e.status, 400);
    assert.equal(e.message, "Cần nhập lý do huỷ");
    return true;
  });
});

test("cancel controller passes the Vietnamese message and status through", async () => {
  let status = 0;
  let body: any;
  const res: any = {
    status(c: number) {
      status = c;
      return this;
    },
    json(b: unknown) {
      body = b;
      return this;
    },
  };
  await contractController.cancelContract({ headers: { "x-user-id": "u1" }, params: { id: "c1" }, body: { reason: "" } } as any, res);
  assert.equal(status, 400);
  assert.equal(body.error, "Cần nhập lý do huỷ");
});

test("contract lookups: not found -> 404 and wrong party -> 403, both Vietnamese", async () => {
  const restoreNone = patch(contractRepository, "findById", async () => null);
  try {
    await assert.rejects(contractService.cancelContract("c1", "u1", "x"), (e: any) => e.status === 404 && e.message === "Không tìm thấy hợp đồng");
  } finally {
    restoreNone();
  }
  const restoreOther = patch(contractRepository, "findById", async () => ({ id: "c1", ptUserId: "p", clientUserId: "c", status: "PENDING_PAYMENT" }));
  try {
    await assert.rejects(
      contractService.cancelContract("c1", "stranger", "x"),
      (e: any) => e.status === 403 && e.message === "Bạn không có quyền thực hiện thao tác này",
    );
  } finally {
    restoreOther();
  }
});

test("booking: missing reason / unknown session / wrong party are Vietnamese with the same statuses", async () => {
  await assert.rejects(bookingService.cancelSession("s1", "u1", ""), (e: any) => e.status === 400 && e.message === "Cần nhập lý do huỷ");
  await assert.rejects(bookingService.disputeSession("s1", "u1", ""), (e: any) => e.status === 400 && e.message === "Cần nhập lý do khiếu nại");
  const restore = patch(sessionRepository, "findById", async () => null);
  try {
    await assert.rejects(bookingService.cancelSession("s1", "u1", "x"), (e: any) => e.status === 404 && e.message === "Không tìm thấy buổi tập");
  } finally {
    restore();
  }
  const restoreOther = patch(sessionRepository, "findById", async () => ({ id: "s1", clientUserId: "c", ptUserId: "p", contractId: "k", status: "CONFIRMED" }));
  try {
    await assert.rejects(bookingService.cancelSession("s1", "stranger", "x"), (e: any) => {
      assert.equal(e.status, 403);
      assert.doesNotMatch(e.message, NO_ENGLISH);
      return true;
    });
  } finally {
    restoreOther();
  }
});
