/**
 * Cụm A1 — terminateContractMoney phải gửi compensatedSessions sang payment-service.
 *
 * Bằng chứng gốc: contract-payout.service.ts#terminateContractMoney gửi price, totalSessions,
 * usedSessions, rates, reason, alreadyReleased, parties — KHÔNG có compensatedSessions.
 * payment-service tính remaining chỉ trừ usedSessions, nên một buổi PT vắng đã được bồi
 * thường bằng tiền mặt vẫn bị tính là "còn quyền lợi" khi hợp đồng huỷ sau đó — giá trị buổi
 * đó bị trả hai lần.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "crypto";
import { contractRepository } from "../repositories/contract.repository";
import { paymentClient } from "../clients/payment.client";
import { prisma } from "../repositories/profile.repository";
import { terminateContractMoney } from "../services/contract-payout.service";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("terminateContractMoney gửi compensatedSessions của hợp đồng sang payment-service", async () => {
  const contractId = randomUUID();
  const contract = {
    id: contractId,
    paymentTransactionId: "txn-1",
    price: { toString: () => "1200000" } as any,
    totalSessions: 12,
    usedSessions: 0,
    compensatedSessions: 1,
    platformRate: { toString: () => "0.10" } as any,
    ptRate: { toString: () => "0.90" } as any,
    gymRate: { toString: () => "0" } as any,
    ptUserId: "pt-1",
    clientUserId: "client-1",
    gymId: null,
    releasedToPt: { toString: () => "0" } as any,
    releasedToGym: { toString: () => "0" } as any,
    releasedToPlatform: { toString: () => "0" } as any,
    notes: null,
  };

  const calls: any[] = [];
  const restoreFind = patch(contractRepository, "findById", async () => contract as any);
  const restoreTerminate = patch(paymentClient, "terminate", async (body: any) => {
    calls.push(body);
    return { refund: "990000.00" };
  });
  const restoreUpdate = patch(prisma.contract, "update", async () => ({}) as any);

  try {
    await terminateContractMoney(contractId, "CLIENT_CANCELLED");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].compensatedSessions, 1, "compensatedSessions của hợp đồng phải có mặt trong payload gửi sang payment-service");
    assert.equal(calls[0].usedSessions, 0);
    assert.equal(calls[0].totalSessions, 12);
  } finally {
    restoreFind();
    restoreTerminate();
    restoreUpdate();
  }
});

test("hợp đồng chưa từng bị PT vắng buổi (compensatedSessions=0) vẫn gửi đúng giá trị 0, không phải undefined", async () => {
  const contractId = randomUUID();
  const contract = {
    id: contractId,
    paymentTransactionId: "txn-2",
    price: { toString: () => "1000000" } as any,
    totalSessions: 10,
    usedSessions: 3,
    compensatedSessions: 0,
    platformRate: { toString: () => "0.10" } as any,
    ptRate: { toString: () => "0.90" } as any,
    gymRate: { toString: () => "0" } as any,
    ptUserId: "pt-2",
    clientUserId: "client-2",
    gymId: null,
    releasedToPt: { toString: () => "270000" } as any,
    releasedToGym: { toString: () => "0" } as any,
    releasedToPlatform: { toString: () => "30000" } as any,
    notes: null,
  };

  const calls: any[] = [];
  const restoreFind = patch(contractRepository, "findById", async () => contract as any);
  const restoreTerminate = patch(paymentClient, "terminate", async (body: any) => {
    calls.push(body);
    return { refund: "630000.00" };
  });
  const restoreUpdate = patch(prisma.contract, "update", async () => ({}) as any);

  try {
    await terminateContractMoney(contractId, "CLIENT_CANCELLED");
    assert.equal(calls[0].compensatedSessions, 0);
  } finally {
    restoreFind();
    restoreTerminate();
    restoreUpdate();
  }
});
