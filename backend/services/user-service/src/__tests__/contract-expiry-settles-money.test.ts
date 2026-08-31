/**
 * Cụm A3 — hợp đồng quá hạn (endDate đã qua) phải đi qua terminateContractMoney, không chỉ
 * flip status.
 *
 * Bằng chứng gốc: contractService.expireContracts() gọi thẳng
 * contractRepository.updateStatus(c.id, ContractStatus.EXPIRED) — không có bất kỳ lời gọi
 * tiền nào. Tiền còn trong ngăn chờ của ba bên (cho các buổi chưa dùng) bị kẹt vĩnh viễn: PT
 * không bao giờ nhận được phần của mình, khách không bao giờ được hoàn (dù chính sách đã
 * chốt là hết hạn tự nhiên = không hoàn — §A3 quyết định), nhưng escrow vẫn giữ số tiền đó
 * mà chẳng ai "sở hữu" nó theo đúng bất biến đối soát.
 *
 * Chính sách đã chốt với người dùng: hết hạn tự nhiên LUÔN dùng reason 'EXPIRED' (hoàn 0đ) —
 * buổi PT-gây-ra (no-show) đã được bồi thường ngay lúc xảy ra qua compensateNoShow, không đợi
 * tới lúc hợp đồng hết hạn.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { Prisma } from "../generated/prisma";
import { contractService } from "../services/contract.service";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function fixtureExpiredContract(id: string) {
  return {
    id,
    paymentTransactionId: `txn-${id}`,
    price: new Prisma.Decimal("1000000"),
    totalSessions: 10,
    usedSessions: 4,
    compensatedSessions: 1,
    platformRate: new Prisma.Decimal("0.10"),
    ptRate: new Prisma.Decimal("0.90"),
    gymRate: new Prisma.Decimal("0"),
    ptUserId: "pt-1",
    clientUserId: "client-1",
    gymId: null,
    releasedToPt: new Prisma.Decimal("360000"),
    releasedToGym: new Prisma.Decimal("0"),
    releasedToPlatform: new Prisma.Decimal("40000"),
    notes: null,
  };
}

test("expireContracts gọi terminateContractMoney(id, 'EXPIRED') cho mỗi hợp đồng quá hạn — không chỉ flip status", async () => {
  const contractId = randomUUID();
  const contract = fixtureExpiredContract(contractId);

  const terminateCalls: any[] = [];
  const restoreFindExpired = patch(contractRepository, "findExpiredContracts", async () => [contract] as any);
  const restoreFindById = patch(contractRepository, "findById", async () => contract as any);
  const restoreTerminate = patch(paymentClient, "terminate", async (body: any) => {
    terminateCalls.push(body);
    return { refund: "0.00" };
  });
  const restoreUpdate = patch(prisma.contract, "update", async () => ({}) as any);
  // Guards against the OLD behaviour so a regression is caught even if someone re-adds it
  // alongside the fix instead of in place of it.
  const restoreUpdateStatus = patch(contractRepository, "updateStatus", async () => {
    throw new Error("updateStatus should not be called directly anymore — terminateContractMoney owns the status transition");
  });

  try {
    const count = await contractService.expireContracts();

    assert.equal(count, 1);
    assert.equal(terminateCalls.length, 1, "phải đi qua paymentClient.terminate — đường dùng chung với mọi chấm dứt hợp đồng khác");
    assert.equal(terminateCalls[0].reason, "EXPIRED");
    assert.equal(terminateCalls[0].idempotencyKey, `CONTRACT_TERMINATE:${contractId}`);
    assert.equal(terminateCalls[0].compensatedSessions, 1, "phải mang theo compensatedSessions (cụm A1) — không tính lại thiếu");
  } finally {
    restoreFindExpired();
    restoreFindById();
    restoreTerminate();
    restoreUpdate();
    restoreUpdateStatus();
  }
});

test("một hợp đồng quá hạn lỗi không chặn các hợp đồng khác trong cùng lượt quét", async () => {
  const okId = randomUUID();
  const brokenId = randomUUID();
  const ok = fixtureExpiredContract(okId);
  const broken = fixtureExpiredContract(brokenId);

  const terminateCalls: any[] = [];
  const restoreFindExpired = patch(contractRepository, "findExpiredContracts", async () => [broken, ok] as any);
  const restoreFindById = patch(contractRepository, "findById", async (id: string) => (id === brokenId ? broken : ok) as any);
  const restoreTerminate = patch(paymentClient, "terminate", async (body: any) => {
    if (body.transactionId === broken.paymentTransactionId) {
      throw new Error("payment-service unreachable");
    }
    terminateCalls.push(body);
    return { refund: "0.00" };
  });
  const restoreUpdate = patch(prisma.contract, "update", async () => ({}) as any);

  try {
    const count = await contractService.expireContracts();
    assert.equal(count, 1, "chỉ hợp đồng thành công được tính, hợp đồng lỗi không làm dừng cả lượt quét");
    assert.equal(terminateCalls.length, 1);
    assert.equal(terminateCalls[0].transactionId, ok.paymentTransactionId);
  } finally {
    restoreFindExpired();
    restoreFindById();
    restoreTerminate();
    restoreUpdate();
  }
});
