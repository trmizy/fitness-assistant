/**
 * CODE/UNIT — D15b helper tổng hoa hồng PT cho kế toán. Chạy: npx tsx --test src/app/utils/__tests__/ptCommission.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { commissionCsv, commissionRangeFor, monthLabel, normalizePtCommission } from "../ptCommission";

const raw = {
  from: "2026-05-01T00:00:00Z", to: "2026-10-22T00:00:00Z", branchCount: 2,
  totals: { expected: "30000.00", recorded: "20000.00", paid: "70000.00", clawedBack: "5000.00", referralCount: 3 },
  byMonth: [{ month: "2026-10", expected: "30000.00", recorded: "20000.00", paid: "70000.00", clawedBack: "5000.00", referralCount: 3, referrerPtUserId: "pt-secret", rate: "0.1234" }],
  definitions: { expected: "e", recorded: "r", paid: "p", clawedBack: "c", period: "m" },
  perPt: [{ ptUserId: "pt-secret", rate: 0.12 }],
};

describe("ptCommission", () => {
  it("normalizes to numbers and keeps ONLY totals — per-PT data / rates the server might send never reach the UI or CSV", () => {
    const s = normalizePtCommission(raw);
    assert.equal(s.totals.paid, 70000);
    assert.equal(s.byMonth[0].expected, 30000);
    assert.equal(JSON.stringify(s).includes("pt-secret"), false);
    assert.equal(JSON.stringify(s).includes("0.1234"), false);
    assert.equal(commissionCsv(s).includes("pt-secret"), false);
    assert.deepEqual(Object.keys(s).sort(), ["branchCount", "byMonth", "definitions", "from", "to", "totals"]);
  });

  it("is safe on garbage payloads", () => {
    const s = normalizePtCommission(undefined);
    assert.equal(s.totals.paid, 0);
    assert.deepEqual(s.byMonth, []);
    assert.equal(normalizePtCommission({ totals: { paid: "abc" } }).totals.paid, 0);
  });

  it("month label and presets use Vietnam calendar months", () => {
    assert.equal(monthLabel("2026-10"), "Tháng 10/2026");
    assert.equal(monthLabel("weird"), "weird");
    const now = new Date("2026-10-31T18:00:00Z"); // 01/11 01:00 giờ VN
    assert.equal(commissionRangeFor("THIS_MONTH", now).from, "2026-11-01");
    assert.equal(commissionRangeFor("LAST_3", now).from, "2026-09-01");
    assert.equal(commissionRangeFor("LAST_12", new Date("2026-10-21T05:00:00Z")).from, "2025-11-01");
  });

  it("CSV has a header, one row per month and a total row; no PT/rate column", () => {
    const rows = commissionCsv(normalizePtCommission(raw)).split("\r\n");
    assert.equal(rows.length, 3);
    assert.equal(/PT|tỷ lệ|rate/i.test(rows[0]), false);
    assert.ok(rows[2].startsWith("Tổng,30000,20000,70000,5000,3"));
  });
});
