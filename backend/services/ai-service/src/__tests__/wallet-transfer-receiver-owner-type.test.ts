/**
 * Cụm C1 — paymentClient.walletTransfer luôn gửi receiverOwnerType: "CLIENT", kể cả khi
 * receiver là một PT bán hàng (TrainingPackage hoặc Personalized Service).
 *
 * Hậu quả: payment-service ghi có tiền vào một ví loại CLIENT gắn với userId của PT đó —
 * KHÔNG PHẢI ví PT thật của họ. `GET /me/pt-wallet` và `POST /me/withdrawals` (route dùng
 * `ownerType = role === 'PT' ? 'PT' : 'CLIENT'`) đều đọc/rút từ ví loại PT — số tiền bán hàng
 * này vô hình và không rút được, kẹt vĩnh viễn trong một ví "client" không ai từng thấy.
 *
 * payerOwnerType luôn đúng là "CLIENT" — người mua LUÔN trả từ ví cá nhân/khách hàng của họ
 * bất kể vai trò khác (đã xác nhận qua comment "GET /me/wallet — always the CLIENT (buyer)
 * wallet, regardless of the user's other roles" ở payment-service/wallet.routes.ts). Chỉ
 * receiverOwnerType sai.
 */
import test from "node:test";
import assert from "node:assert/strict";
import axios from "axios";
import { paymentClient } from "../clients/payment.client";

function patch<T extends object, K extends keyof T>(obj: T, key: K, impl: unknown): () => void {
  const original = obj[key];
  obj[key] = impl as T[K];
  return () => {
    obj[key] = original;
  };
}

test("walletTransfer gửi receiverOwnerType: 'PT' — người bán luôn là một PT đã duyệt", async () => {
  let capturedBody: any;
  const restore = patch(axios, "post", async (_url: string, body: any) => {
    capturedBody = body;
    return { data: { data: { status: "PAID", transactionId: "txn-1" } } };
  });

  try {
    await paymentClient.walletTransfer({
      payerOwnerId: "buyer-1",
      receiverOwnerId: "pt-seller-1",
      amount: 100000,
      relatedEntityId: "order-1",
      idempotencyKey: "key-1",
      initiatedBy: "buyer-1",
      purpose: "PERSONALIZED_SERVICE_PURCHASE",
      relatedEntityType: "PERSONALIZED_SERVICE_PURCHASE",
    });
  } finally {
    restore();
  }

  assert.equal(capturedBody.payerOwnerType, "CLIENT", "người mua luôn trả từ ví CLIENT của họ — không đổi");
  assert.equal(capturedBody.receiverOwnerType, "PT", "người bán là PT — tiền phải vào đúng ví PT, không phải ví CLIENT");
});
