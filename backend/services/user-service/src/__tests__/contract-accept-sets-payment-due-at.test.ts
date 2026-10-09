/**
 * Khi e-sign tắt (REQUIRE_CONTRACT_ESIGN=false) PT chấp nhận → hợp đồng vào PENDING_PAYMENT
 * ngay, và phải mang `paymentDueAt` = bây giờ + 12 giờ trong CÙNG lần cập nhật nguyên tử đó.
 * Khi e-sign bật, bước chấp nhận chỉ tới PENDING_SIGNATURE — chưa có hạn (hạn đặt khi webhook
 * ký xong đưa hợp đồng vào PENDING_PAYMENT).
 *
 * TEST FIXTURE — stub repository / auth-service / PDF; env được đặt TRƯỚC khi nạp service vì
 * REQUIRE_CONTRACT_ESIGN là hằng số mức module.
 */
import test from "node:test";
import assert from "node:assert/strict";

async function runAccept(esign: "true" | "false") {
  process.env.REQUIRE_CONTRACT_ESIGN = esign;
  const { contractRepository } = await import("../repositories/contract.repository");
  const { authServiceClient } = await import("../clients/auth-service.client");
  const { eSignService } = await import("../services/esign.service");
  const { auditService } = await import("../services/audit.service");
  const { notificationService } = await import("../services/notification.service");
  const { contractService } = await import("../services/contract.service");

  let claim: any;
  const saved = {
    findById: contractRepository.findById,
    updateWhereStatus: contractRepository.updateWhereStatus,
    update: contractRepository.update,
    internalGet: authServiceClient.internalGet,
    send: eSignService.send,
    record: auditService.record,
    create: notificationService.create,
  };
  (contractRepository as any).findById = async () => ({
    id: "c1", ptUserId: "pt-1", clientUserId: "client-1", status: "PENDING_REVIEW", gymId: null,
    packageName: "P", totalSessions: 4, price: null, pricePerSession: null,
    createdAt: new Date(),
  });
  (contractRepository as any).updateWhereStatus = async (_id: string, _from: string, to: string, data: any) => {
    claim = { to, data };
    // count 0 -> acceptContract stops with 409 right here, BEFORE the PDF step (which would
    // write a file to disk). The claim data is all this test needs.
    return { count: 0 };
  };
  (contractRepository as any).update = async () => ({});
  (authServiceClient as any).internalGet = async () => ({ data: { user: { email: "x@example.com" } } });
  (eSignService as any).send = async () => ({ provider: "mock", requestId: "r1" });
  (auditService as any).record = async () => {};
  (notificationService as any).create = async () => ({});
  try {
    await assert.rejects(() => contractService.acceptContract("c1", "pt-1"), (e: any) => e.status === 409);
  } finally {
    Object.assign(contractRepository, { findById: saved.findById, updateWhereStatus: saved.updateWhereStatus, update: saved.update });
    (authServiceClient as any).internalGet = saved.internalGet;
    (eSignService as any).send = saved.send;
    (auditService as any).record = saved.record;
    (notificationService as any).create = saved.create;
  }
  return claim;
}

test("e-sign OFF: accept claims PENDING_PAYMENT and sets paymentDueAt ~ now + 12h in the same update", async () => {
  const before = Date.now();
  const claim = await runAccept("false");
  assert.equal(claim.to, "PENDING_PAYMENT");
  assert.ok(claim.data.paymentDueAt instanceof Date);
  const delta = claim.data.paymentDueAt.getTime() - before;
  assert.ok(Math.abs(delta - 12 * 3600 * 1000) < 5000, `expected ~12h, got ${delta}ms`);
});
