/**
 * Phase 12 cụm B — gói hội viên của thương hiệu (WB-04), ví chi nhánh (GY-04) và hợp tác huấn
 * luyện viên nhìn từ ghế chủ gym (GY-06).
 *
 * Chạy: npx tsx --test src/features/__tests__/gymOwnerClusterB.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  EMPTY_PLAN_FORM,
  canRespondAsGym,
  collabRows,
  collabsForGym,
  gymCollabStatus,
  openWithdrawals,
  ownedPlans,
  planFormError,
  planLimitText,
  planPayload,
  planStatus,
  saleWindow,
  savedPayoutLine,
  sortCollabsForOwner,
  withdrawalRows,
} from "../gymOwner/gymOwner";
import { canRespondAs, canTerminateCollab, collabStatusFor } from "../collaboration/collaboration";
import { collabStatus, canRespondToCollab } from "../pt/pt";
import { withdrawableCeiling } from "../wallet/wallet";

describe("gói hội viên của thương hiệu", () => {
  it("đọc mọi kiểu bọc và bỏ dòng không có id", () => {
    const rows = [{ id: "p1" }, { id: "p2" }, { nope: true }];
    assert.equal(ownedPlans(rows).length, 2);
    assert.equal(ownedPlans({ data: rows }).length, 2);
    assert.equal(ownedPlans(null).length, 0);
  });

  it("nhãn trạng thái và mô tả hạn mức nói rõ là dùng chung mọi chi nhánh", () => {
    assert.equal(planStatus("ACTIVE").label, "Đang bán");
    assert.equal(planStatus("INACTIVE").label, "Đã ngừng");
    assert.equal(planStatus("WHAT").label, "WHAT");
    assert.match(planLimitText({ id: "p", durationDays: 30, visitLimit: 12 }), /dùng chung mọi chi nhánh/);
    assert.match(planLimitText({ id: "p", durationDays: 30 }), /không giới hạn lượt/);
  });

  it("cửa sổ mở bán khớp với việc khách có thấy gói hay không", () => {
    const now = new Date("2026-09-26T00:00:00Z");
    assert.equal(saleWindow({ id: "p" }, now), null, "không đặt lịch thì không có nhãn");
    assert.equal(saleWindow({ id: "p", saleStartAt: "2026-10-01" }, now)?.tone, "info");
    assert.match(saleWindow({ id: "p", saleStartAt: "2026-10-01" }, now)!.text, /Mở bán từ/);
    assert.equal(saleWindow({ id: "p", saleEndAt: "2026-09-01" }, now)?.text, "Đã hết hạn bán");
    assert.equal(saleWindow({ id: "p", saleStartAt: "2026-09-01", saleEndAt: "2026-12-31" }, now)?.tone, "success");
  });

  it("biểu mẫu chặn đúng những gì máy chủ sẽ từ chối", () => {
    const ok = { ...EMPTY_PLAN_FORM, name: "Gói tháng", price: "500000" };
    assert.equal(planFormError(ok), null);
    assert.ok(planFormError({ ...ok, name: "  " }));
    assert.ok(planFormError({ ...ok, price: "0" }));
    assert.ok(planFormError({ ...ok, price: "abc" }));
    assert.ok(planFormError({ ...ok, durationDays: "0" }));
    assert.ok(planFormError({ ...ok, durationDays: "1.5" }));
    assert.ok(planFormError({ ...ok, visitLimit: "-2" }));
    assert.ok(planFormError({ ...ok, saleStartAt: "01/10/2026" }), "ngày sai định dạng");
    assert.ok(
      planFormError({ ...ok, saleStartAt: "2026-12-01", saleEndAt: "2026-10-01" }),
      "kết thúc trước bắt đầu",
    );
    assert.equal(planFormError({ ...ok, saleStartAt: "2026-10-01", saleEndAt: "2026-12-31" }), null);
  });

  it("payload bỏ những trường để trống, không gửi chuỗi rỗng", () => {
    const bare = planPayload({ ...EMPTY_PLAN_FORM, name: " Gói tháng ", price: "500000" });
    assert.deepEqual(bare, { name: "Gói tháng", price: 500000, durationDays: 30 });
    const full = planPayload({
      name: "Khuyến mãi",
      price: "300000",
      durationDays: "60",
      visitLimit: "12",
      saleStartAt: "2026-10-01",
      saleEndAt: "2026-12-31",
    });
    assert.equal(full.visitLimit, 12);
    assert.equal(full.saleStartAt, "2026-10-01");
  });
});

describe("ví chi nhánh", () => {
  it("trần rút trừ yêu cầu PENDING, KHÔNG trừ lần hai với yêu cầu đã APPROVED", () => {
    const wallet = { availableBalance: "1000000" };
    const rows = [
      { id: "w1", amount: "200000", status: "PENDING" },
      { id: "w2", amount: "300000", status: "APPROVED" },
      { id: "w3", amount: "500000", status: "PAID" },
      { id: "w4", amount: "100000", status: "REJECTED" },
    ];
    // APPROVED đã rời availableBalance sang lockedBalance rồi — trừ nữa là trừ hai lần.
    assert.equal(withdrawableCeiling(wallet, rows), 800000);
  });

  it("trần không bao giờ âm, và ví rỗng thì bằng 0", () => {
    assert.equal(withdrawableCeiling({ availableBalance: "100" }, [{ id: "w", amount: "500", status: "PENDING" }]), 0);
    assert.equal(withdrawableCeiling(null, []), 0);
    assert.equal(withdrawableCeiling({ availableBalance: "abc" }, []), 0);
  });

  it("chỉ PENDING và APPROVED là yêu cầu còn treo", () => {
    const rows = withdrawalRows([
      { id: "a", status: "PENDING" },
      { id: "b", status: "APPROVED" },
      { id: "c", status: "PAID" },
      { id: "d", status: "REJECTED" },
      { noId: true },
    ]);
    assert.equal(rows.length, 4);
    assert.deepEqual(openWithdrawals(rows).map((w) => w.id), ["a", "b"]);
  });

  it("tài khoản nhận tiền đã lưu được ghép lại, thiếu số tài khoản thì coi như chưa có", () => {
    assert.equal(
      savedPayoutLine({ payout: { bankName: "MB", accountNumber: "123", accountHolder: "Jane" } }),
      "MB — 123 — Jane",
    );
    assert.equal(savedPayoutLine({ payout: { bankName: "MB" } }), "");
    assert.equal(savedPayoutLine(null), "");
  });
});

describe("hợp tác: hai ghế, một bảng trạng thái", () => {
  const gymOffered = { id: "c1", status: "PENDING", proposedBy: "GYM" };
  const ptOffered = { id: "c2", status: "COUNTERED", proposedBy: "PT" };

  it("cùng một dòng, hai phía đọc ngược nhau — và không bao giờ cùng nói 'bạn cần trả lời'", () => {
    assert.equal(collabStatusFor(gymOffered, "PT").label, "Bạn cần trả lời");
    assert.equal(collabStatusFor(gymOffered, "GYM").label, "Chờ huấn luyện viên trả lời");
    assert.equal(collabStatusFor(ptOffered, "GYM").label, "Bạn cần trả lời");
    // Màn chủ gym gọi qua `gymCollabStatus`, phải ra đúng cùng một nhãn.
    assert.equal(gymCollabStatus(ptOffered).label, "Bạn cần trả lời");
    assert.equal(gymCollabStatus(gymOffered).label, "Chờ huấn luyện viên trả lời");
    assert.equal(collabStatusFor(ptOffered, "PT").label, "Chờ phòng gym trả lời");
  });

  it("chỉ bên KHÔNG ra giá mới trả lời được — đúng luật 409 của máy chủ", () => {
    assert.equal(canRespondAs(gymOffered, "PT"), true);
    assert.equal(canRespondAs(gymOffered, "GYM"), false);
    assert.equal(canRespondAsGym(ptOffered), true);
    assert.equal(canRespondAsGym(gymOffered), false);
    // Đã chốt hoặc đã đóng thì không còn gì để trả lời.
    for (const s of ["ACCEPTED", "REJECTED", "EXPIRED", "TERMINATED"]) {
      assert.equal(canRespondAs({ status: s, proposedBy: "PT" }, "GYM"), false, s);
    }
  });

  it("màn Phase 11 của huấn luyện viên vẫn cho đúng kết quả cũ sau khi tách module", () => {
    assert.equal(collabStatus(gymOffered).label, collabStatusFor(gymOffered, "PT").label);
    assert.equal(canRespondToCollab(gymOffered), canRespondAs(gymOffered, "PT"));
  });

  it("chỉ hợp tác đang chạy mới chấm dứt được", () => {
    assert.equal(canTerminateCollab({ status: "ACCEPTED" }), true);
    assert.equal(canTerminateCollab({ status: "PENDING" }), false);
    assert.equal(canTerminateCollab(null), false);
  });

  it("một đề nghị thuộc về một chi nhánh, không phải cả thương hiệu", () => {
    const rows = collabRows([
      { id: "a", gymId: "g1" },
      { id: "b", gymId: "g2" },
      { noId: true },
    ]);
    assert.equal(rows.length, 2);
    assert.deepEqual(collabsForGym(rows, "g1").map((c) => c.id), ["a"]);
  });

  it("việc cần mình trả lời xếp lên trước, phần đã đóng xuống cuối", () => {
    const sorted = sortCollabsForOwner([
      { id: "closed", status: "REJECTED" },
      { id: "running", status: "ACCEPTED" },
      { id: "mine", status: "PENDING", proposedBy: "PT" },
      { id: "theirs", status: "PENDING", proposedBy: "GYM" },
    ]);
    assert.deepEqual(sorted.map((c) => c.id), ["mine", "theirs", "running", "closed"]);
  });
});
