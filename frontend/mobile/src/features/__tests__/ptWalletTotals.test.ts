/** N15M-05 — Chạy: npx tsx --test src/features/__tests__/ptWalletTotals.test.ts */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import { ptWalletNotWithdrawable } from "../ptWallet/ptWalletTotals";

describe("ptWalletNotWithdrawable", () => {
  it("1.449.000 chưa kiếm không còn gọi là 'tạm giữ' (đúng ca thiết bị thật)", () => {
    const r = ptWalletNotWithdrawable({ availableBalance: "0", pendingBalance: "1449000", holdbackBalance: "0", lockedBalance: "0" });
    assert.equal(r.total, 1449000);
    assert.deepEqual(r.parts, [{ key: "pending", label: "Chưa kiếm", amount: 1449000 }]);
  });
  it("tách đủ ba phần, bỏ phần 0, tổng khớp", () => {
    const r = ptWalletNotWithdrawable({ pendingBalance: 100, holdbackBalance: "50.5", lockedBalance: 20 });
    assert.deepEqual(r.parts.map((p) => p.label), ["Chưa kiếm", "Đang tạm giữ", "Đang xử lý rút tiền"]);
    assert.equal(r.total, 170.5);
  });
  it("ví chưa đọc được → 0, không vỡ", () => {
    assert.deepEqual(ptWalletNotWithdrawable(undefined), { total: 0, parts: [] });
  });
});
