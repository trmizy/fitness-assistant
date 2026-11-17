/**
 * PAY-02 (partner retest 2026-11-17): VNPay's sandbox answered ResponseCode 00 for the package
 * "Trực tiếp 4 buổi (địa điểm riêng)" but our return handler showed status=invalid and the money was never recorded.
 * VNPay signs its return/IPN with PHP-style urlencode (( ) ! ' * -> %28 %29 %21 %27 %2A); we recomputed the hash with
 * encodeURIComponent (leaves them literal). Verification now accepts either encoding. Pure unit test: no DB, no network.
 */
import test from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";

process.env.VNPAY_HASH_SECRET = "unit-test-secret-not-real";
process.env.VNPAY_TMN_CODE = "UNITTMN1";
process.env.VNPAY_SIMULATE = "false";

const hmac = (s: string) => crypto.createHmac("sha512", process.env.VNPAY_HASH_SECRET!).update(Buffer.from(s, "utf-8")).digest("hex");

/** What VNPay's side does: sorted keys, PHP urlencode on key and value, hash over `k=v&k=v`. */
function phpUrlencode(s: string): string {
  return encodeURIComponent(s).replace(/[!'()*]/g, (c) => "%" + c.charCodeAt(0).toString(16).toUpperCase()).replace(/%20/g, "+");
}
function vnpaySignedReturn(params: Record<string, string>, enc: (s: string) => string): Buffer {
  const query = Object.keys(params).sort().map((k) => `${enc(k)}=${enc(params[k])}`).join("&");
  return Buffer.from(`${query}&vnp_SecureHash=${hmac(query)}`, "utf-8");
}

const base = {
  vnp_Amount: "50000000",
  vnp_BankCode: "NCB",
  vnp_OrderInfo: "Trực tiếp 4 buổi (địa điểm riêng)",
  vnp_ResponseCode: "00",
  vnp_TmnCode: "UNITTMN1",
  vnp_TransactionNo: "14000001",
  vnp_TransactionStatus: "00",
  vnp_TxnRef: "txn-abc-123",
};

async function provider() {
  const mod = await import("../providers/vnpay.provider");
  return new mod.VNPayProvider();
}

test("encodeUrlencode encodes ( ) ! ' * and spaces like PHP urlencode", async () => {
  const { encodeUrlencode } = await import("../providers/vnpay.provider");
  assert.equal(encodeUrlencode("a (b) c!'*"), "a+%28b%29+c%21%27%2A");
  assert.equal(encodeUrlencode("Trực"), "Tr%E1%BB%B1c");
});

test("buildSignedQuery default encoding is unchanged (what the checkout URL already sends)", async () => {
  const { buildSignedQuery } = await import("../providers/vnpay.provider");
  const { query } = buildSignedQuery({ vnp_OrderInfo: "x (y)", vnp_Amount: "100" });
  assert.equal(query, "vnp_Amount=100&vnp_OrderInfo=x+(y)");
  assert.equal(buildSignedQuery({ vnp_OrderInfo: "x (y)" }, "urlencode").query, "vnp_OrderInfo=x+%28y%29");
});

test("PAY-02: a return signed with PHP urlencode and brackets in OrderInfo is VALID and PAID", async () => {
  const r = (await provider()).verifyWebhookSignature(vnpaySignedReturn(base, phpUrlencode));
  assert.equal(r.valid, true);
  if (r.valid) {
    assert.equal(r.normalized?.status, "PAID");
    assert.equal(r.normalized?.providerTransactionId, "txn-abc-123");
    assert.equal(r.normalized?.paidAmountVnd, "500000");
  }
});

test("a return signed with encodeURIComponent (legacy recipe) still verifies", async () => {
  const legacy = (s: string) => encodeURIComponent(s).replace(/%20/g, "+");
  assert.equal((await provider()).verifyWebhookSignature(vnpaySignedReturn(base, legacy)).valid, true);
});

test("an OrderInfo without special characters verifies (both recipes produce the same string)", async () => {
  const plain = { ...base, vnp_OrderInfo: "Goi 4 buoi" };
  assert.equal((await provider()).verifyWebhookSignature(vnpaySignedReturn(plain, phpUrlencode)).valid, true);
});

test("tampering still fails: changed amount, changed OrderInfo, wrong secret, missing hash", async () => {
  const p = await provider();
  const good = vnpaySignedReturn(base, phpUrlencode).toString("utf-8");
  const amount = good.replace("vnp_Amount=50000000", "vnp_Amount=100");
  assert.deepEqual(p.verifyWebhookSignature(Buffer.from(amount)), { valid: false, reason: "BAD_SIGNATURE" });
  const info = good.replace("%28", "%5B");
  assert.deepEqual(p.verifyWebhookSignature(Buffer.from(info)), { valid: false, reason: "BAD_SIGNATURE" });
  const stripped = good.replace(/&vnp_SecureHash=.*/, "");
  assert.deepEqual(p.verifyWebhookSignature(Buffer.from(stripped)), { valid: false, reason: "BAD_SIGNATURE" });
  const wrong = good.replace(/vnp_SecureHash=.*/, "vnp_SecureHash=" + "0".repeat(128));
  assert.deepEqual(p.verifyWebhookSignature(Buffer.from(wrong)), { valid: false, reason: "BAD_SIGNATURE" });
});

test("a valid signature for another merchant code is still refused", async () => {
  const other = { ...base, vnp_TmnCode: "OTHER" };
  assert.deepEqual((await provider()).verifyWebhookSignature(vnpaySignedReturn(other, phpUrlencode)), { valid: false, reason: "MERCHANT_MISMATCH" });
});
