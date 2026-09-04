/**
 * Cụm A2 — pt-deactivation.service.ts không được có đường tính tiền riêng.
 *
 * Bằng chứng gốc: unwindContract() tự tính refund bằng computeProratedRefund() (bỏ qua
 * compensatedSessions, sai công thức so với contract-money.ts) rồi gọi thẳng
 * paymentClient.refund() với khoá idempotency `pt-deactivation-refund:<id>:${randomUUID()}` —
 * MỖI LẦN GỌI LÀ MỘT KHOÁ MỚI. auth-service's relay (pt-deactivation-relay.service.ts) tài
 * liệu hoá rõ ràng rằng gọi lại deactivatePT nhiều lần là AN TOÀN ("deactivatePT is itself
 * safe to call more than once") — với khoá ngẫu nhiên, giả định đó sai: gọi lại sẽ hoàn tiền
 * lần hai cho cùng một hợp đồng.
 *
 * Fix: unwindContract phải gọi terminateContractMoney(contractId, 'PT_BANNED') — đường dùng
 * chung với mọi luồng chấm dứt hợp đồng khác, dùng khoá ổn định `CONTRACT_TERMINATE:<id>`.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { Prisma } from "../generated/prisma";
import { ptDeactivationService } from "../services/pt-deactivation.service";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

function fixtureContract(id: string) {
  return {
    id,
    paymentTransactionId: `txn-${id}`,
    price: new Prisma.Decimal("1200000"),
    totalSessions: 12,
    usedSessions: 2,
    compensatedSessions: 1,
    platformRate: new Prisma.Decimal("0.10"),
    ptRate: new Prisma.Decimal("0.90"),
    gymRate: new Prisma.Decimal("0"),
    ptUserId: "pt-1",
    clientUserId: "client-1",
    gymId: null,
    releasedToPt: new Prisma.Decimal("0"),
    releasedToGym: new Prisma.Decimal("0"),
    releasedToPlatform: new Prisma.Decimal("0"),
    notes: null,
  };
}

test("unwindContract dùng terminateContractMoney (đường dùng chung), khoá idempotency ổn định CONTRACT_TERMINATE:<contractId>", async () => {
  const contractId = randomUUID();
  const contract = fixtureContract(contractId);

  const terminateCalls: any[] = [];
  const restoreFind = patch(contractRepository, "findById", async () => contract as any);
  const restoreTerminate = patch(paymentClient, "terminate", async (body: any) => {
    terminateCalls.push(body);
    return { refund: "0.00" };
  });
  const restoreUpdate = patch(prisma.contract, "update", async () => ({}) as any);
  const restoreSessionUpdateMany = patch(prisma.session, "updateMany", async () => ({ count: 0 }) as any);
  const restoreContractUpdate = patch(contractRepository, "update", async () => ({}) as any);

  try {
    await (ptDeactivationService as any).unwindContract(contract, "Tài khoản huấn luyện viên bị khoá");

    assert.equal(terminateCalls.length, 1, "phải gọi paymentClient.terminate — đường dùng chung với mọi chấm dứt hợp đồng khác");
    assert.equal(
      terminateCalls[0].idempotencyKey,
      `CONTRACT_TERMINATE:${contractId}`,
      "khoá idempotency phải ổn định theo contractId, không phải UUID ngẫu nhiên",
    );
  } finally {
    restoreFind();
    restoreTerminate();
    restoreUpdate();
    restoreSessionUpdateMany();
    restoreContractUpdate();
  }
});

test("gọi unwindContract hai lần liên tiếp cho cùng hợp đồng dùng đúng MỘT khoá idempotency — an toàn khi relay gọi lại", async () => {
  const contractId = randomUUID();
  const contract = fixtureContract(contractId);

  const terminateCalls: any[] = [];
  const restoreFind = patch(contractRepository, "findById", async () => contract as any);
  const restoreTerminate = patch(paymentClient, "terminate", async (body: any) => {
    terminateCalls.push(body);
    return { refund: "0.00" };
  });
  const restoreUpdate = patch(prisma.contract, "update", async () => ({}) as any);
  const restoreSessionUpdateMany = patch(prisma.session, "updateMany", async () => ({ count: 0 }) as any);
  const restoreContractUpdate = patch(contractRepository, "update", async () => ({}) as any);

  try {
    await (ptDeactivationService as any).unwindContract(contract, "Tài khoản huấn luyện viên bị khoá");
    await (ptDeactivationService as any).unwindContract(contract, "Tài khoản huấn luyện viên bị khoá");

    assert.equal(terminateCalls.length, 2);
    assert.equal(
      terminateCalls[0].idempotencyKey,
      terminateCalls[1].idempotencyKey,
      "hai lần gọi phải dùng CÙNG một khoá — payment-service mới có thể chặn hoàn tiền lần hai",
    );
  } finally {
    restoreFind();
    restoreTerminate();
    restoreUpdate();
    restoreSessionUpdateMany();
    restoreContractUpdate();
  }
});
