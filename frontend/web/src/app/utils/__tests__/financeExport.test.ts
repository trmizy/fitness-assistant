/**
 * CODE/UNIT — D15 xuất CSV cho kế toán và bảng quyền UI. Chạy: npx tsx --test src/app/utils/__tests__/financeExport.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { csvCell, recognizedSales, salesCsv, toCsv, withdrawalsCsv } from "../financeExport";

describe("financeExport", () => {
  it("escapes commas, quotes and newlines (RFC 4180)", () => {
    assert.equal(csvCell('a,b'), '"a,b"');
    assert.equal(csvCell('he said "hi"'), '"he said ""hi"""');
    assert.equal(csvCell("line1\nline2"), '"line1\nline2"');
    assert.equal(csvCell(null), "");
    assert.equal(csvCell(700000), "700000");
  });

  it("neutralises spreadsheet formula injection", () => {
    assert.equal(csvCell("=HYPERLINK(\"http://x\")").startsWith("\"'="), true);
    assert.equal(csvCell("+1+1"), "'+1+1");
    assert.equal(csvCell("@cmd"), "'@cmd");
    assert.equal(csvCell("-2"), "'-2");
  });

  it("sales CSV has no client identity column and uses CRLF rows", () => {
    const csv = salesCsv(
      [{ id: "m1", gymId: "g1", planId: "p1", status: "ACTIVE", priceAtPurchase: "700000.00", paymentTxnId: "T1" }],
      { gym: () => "Chi nhánh A", plan: () => "Gói tháng" },
    );
    const [header, row] = csv.split("\r\n");
    assert.equal(/khách|client/i.test(header), false);
    assert.ok(row.includes("700000") && row.includes("Chi nhánh A") && row.includes("T1"));
  });

  it("withdrawals CSV carries the masked payout text it was given, nothing more", () => {
    const csv = withdrawalsCsv([{ id: "w1", amount: "500000", status: "PAID", payoutInfo: "VCB •••••••9012", gymName: "A" }]);
    assert.ok(csv.includes("•••••••9012"));
    assert.equal(toCsv(["x"], []).length > 0, true);
  });

  it("recognised sales counts only paid cards (ACTIVE + EXPIRED)", () => {
    const mk = (status: string, p: number) => ({ id: status + p, gymId: "g", planId: "p", status, priceAtPurchase: p });
    const r = recognizedSales([mk("ACTIVE", 100), mk("EXPIRED", 50), mk("CANCELLED", 999), mk("PENDING_PAYMENT", 7)]);
    assert.deepEqual(r, { total: 150, count: 2 });
  });
});
