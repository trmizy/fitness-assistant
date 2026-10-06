/**
 * Phase 14.1 — thanh toán qua cổng.
 *
 * Chạy: npx tsx --test src/features/__tests__/payments.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  checkoutErrorMessage,
  destinationFor,
  normalizeMethods,
  phaseFromSync,
  readCheckout,
  resultHref,
  txnIdFromReturnUrl,
} from "../payments/payments";
import { PENDING_CHECKOUT_TTL_MS, resumableTransaction } from "../payments/pendingCheckout";
import { redirectSystemPath } from "../../../app/+native-intent";

describe("normalizeMethods", () => {
  const live = {
    methods: [
      { provider: "VNPAY", label: "VNPay", description: "Thẻ ATM", configured: true, unavailableReason: null },
      { provider: "MOMO", label: "MoMo", description: "Ví", configured: false, unavailableReason: "Chưa cấu hình khoá" },
    ],
    defaultProvider: "VNPAY",
  };

  it("giữ nguyên danh sách server, kể cả cổng chưa cấu hình (hiện mờ kèm lý do)", () => {
    const { methods, defaultProvider } = normalizeMethods(live);
    assert.equal(methods.length, 2);
    assert.equal(methods[1].configured, false);
    assert.equal(methods[1].unavailableReason, "Chưa cấu hình khoá");
    assert.equal(defaultProvider, "VNPAY");
  });

  it("không chọn sẵn một cổng mà chính server nói không dùng được", () => {
    assert.equal(normalizeMethods({ ...live, defaultProvider: "MOMO" }).defaultProvider, null);
    assert.equal(normalizeMethods({ ...live, defaultProvider: "PAYPAL" }).defaultProvider, null);
  });

  it("chịu được dữ liệu hỏng", () => {
    assert.deepEqual(normalizeMethods(undefined), { methods: [], defaultProvider: null });
    assert.deepEqual(normalizeMethods({ methods: [null, { label: "không có provider" }] }).methods, []);
  });
});

describe("readCheckout", () => {
  it("đọc payment ở gốc (hợp đồng, đơn 1-1, trả gói đang chờ)", () => {
    const c = readCheckout({ payment: { redirectUrl: "https://sandbox.vnpayment.vn/x", transactionId: "t1", status: "PENDING" } });
    assert.deepEqual(c, { redirectUrl: "https://sandbox.vnpayment.vn/x", transactionId: "t1", failureReason: null, alreadyPaid: false });
  });

  it("đọc data.payment (mua gói hội viên trả nguyên body)", () => {
    assert.equal(readCheckout({ success: true, data: { payment: { redirectUrl: "u", transactionId: "t2" } } }).transactionId, "t2");
  });

  it("dùng qrCodeUrl khi cổng chỉ trả mã QR", () => {
    assert.equal(readCheckout({ payment: { qrCodeUrl: "q", transactionId: "t" } }).redirectUrl, "q");
  });

  it("server tự chốt PAID → alreadyPaid (vẫn qua màn kết quả hỏi lại)", () => {
    assert.equal(readCheckout({ payment: { status: "PAID", transactionId: "t" } }).alreadyPaid, true);
  });

  it("không có liên kết → giữ lý do lỗi của server", () => {
    const c = readCheckout({ payment: { redirectUrl: null, failureReason: "Cổng bận" } });
    assert.equal(c.redirectUrl, null);
    assert.equal(c.failureReason, "Cổng bận");
  });
});

describe("liên kết trả về từ cổng", () => {
  it("lấy txnId, bỏ qua status", () => {
    assert.equal(
      txnIdFromReturnUrl("fitnessassistant://client/payments/result?txnId=abc-123&status=success"),
      "abc-123",
    );
    assert.equal(txnIdFromReturnUrl("fitnessassistant://client/payments/result?status=success&txnId=a%2Fb"), "a/b");
    assert.equal(txnIdFromReturnUrl("fitnessassistant://client/payments/result?status=success"), null);
    assert.equal(txnIdFromReturnUrl(null), null);
  });

  it("resultHref mã hoá txnId", () => {
    assert.equal(resultHref("a b"), "/client/payments/result?txnId=a%20b");
    assert.equal(resultHref(null), "/client/payments/result");
  });

  it("+native-intent xoá status khỏi deep link, để link và app trỏ cùng một route", () => {
    for (const path of [
      "fitnessassistant://client/payments/result?txnId=t9&status=success",
      "/client/payments/result?txnId=t9&status=failed",
      "client/payments/result?status=invalid&txnId=t9",
    ]) {
      assert.equal(redirectSystemPath({ path, initial: false }), "/client/payments/result?txnId=t9");
    }
  });

  it("+native-intent để yên mọi liên kết khác", () => {
    for (const path of ["fitnessassistant://partner/verify#token=x", "/client/dashboard", "fitnessassistant://expo-development-client/?url=x"]) {
      assert.equal(redirectSystemPath({ path, initial: true }), path);
    }
  });
});

describe("màn kết quả", () => {
  it("chỉ PAID từ server mới là thành công", () => {
    assert.equal(phaseFromSync({ status: "PAID" }), "paid");
    assert.equal(phaseFromSync({ status: "FAILED" }), "failed");
    assert.equal(phaseFromSync({ status: "CANCELLED" }), "failed");
    assert.equal(phaseFromSync({ status: "PENDING" }), "pending");
    assert.equal(phaseFromSync({ status: "PROCESSING" }), "pending");
    assert.equal(phaseFromSync({ gatewayResult: "PAID" }), "pending", "chỉ tin status của giao dịch");
    assert.equal(phaseFromSync(null), "pending");
  });

  it("dẫn tới đúng chỗ theo loại giao dịch", () => {
    assert.equal(destinationFor({ relatedEntityType: "GYM_MEMBERSHIP" }).href, "/client/services?tab=memberships");
    assert.equal(destinationFor({ relatedEntityType: "PT_CONTRACT" }).href, "/client/services?tab=contracts");
    assert.equal(
      destinationFor({ relatedEntityType: "PERSONALIZED_SERVICE_PURCHASE", relatedEntityId: "o1" }).href,
      "/client/plans/orders/o1",
    );
    assert.equal(destinationFor({ relatedEntityType: "PERSONALIZED_SERVICE_PURCHASE" }).href, "/client/plans");
    assert.equal(destinationFor(null).href, "/client/dashboard");
  });
});

describe("checkoutErrorMessage", () => {
  const err = (data: unknown) => ({ response: { data } });
  it("dịch mã lỗi đã biết, giữ câu tiếng Việt của server, không lộ mã thô", () => {
    assert.match(checkoutErrorMessage(err({ error: "ALREADY_HAS_PENDING_MEMBERSHIP" })), /chờ thanh toán/);
    assert.match(checkoutErrorMessage(err({ error: "PROVIDER_NOT_CONFIGURED" })), /tạm ngưng/);
    assert.equal(checkoutErrorMessage(err({ error: "Gói này đã ngừng bán" })), "Gói này đã ngừng bán");
    assert.equal(
      checkoutErrorMessage(err({ error: "SOMETHING_INTERNAL" })),
      "Không tạo được giao dịch — thử lại hoặc chọn cổng khác.",
    );
    assert.match(checkoutErrorMessage(new Error("Network Error")), /mạng/);
  });
});

describe("resumableTransaction — app bị tắt giữa lúc thanh toán", () => {
  const now = 1_800_000_000_000;
  const rec = (over: Record<string, unknown> = {}) =>
    JSON.stringify({ transactionId: "t1", userId: "u1", startedAt: now - 60_000, ...over });

  it("đúng người, còn hạn → quay lại màn kết quả", () => {
    assert.equal(resumableTransaction(rec(), "u1", now), "t1");
  });

  it("tài khoản khác đăng nhập trên cùng máy → không thấy giao dịch của người trước", () => {
    assert.equal(resumableTransaction(rec(), "u2", now), null);
    assert.equal(resumableTransaction(rec(), null, now), null);
  });

  it("quá hạn cửa sổ thanh toán → bỏ", () => {
    assert.equal(resumableTransaction(rec({ startedAt: now - PENDING_CHECKOUT_TTL_MS - 1 }), "u1", now), null);
  });

  it("dữ liệu hỏng hoặc đồng hồ nhảy lùi → bỏ, không vỡ app", () => {
    assert.equal(resumableTransaction("{not json", "u1", now), null);
    assert.equal(resumableTransaction(rec({ transactionId: "" }), "u1", now), null);
    assert.equal(resumableTransaction(rec({ startedAt: now + 5 * 60_000 }), "u1", now), null);
    assert.equal(resumableTransaction(null, "u1", now), null);
  });
});
