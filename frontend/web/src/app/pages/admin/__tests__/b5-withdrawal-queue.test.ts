/**
 * B5 — phần thuần của hàng đợi rút tiền: chip `?status=`, lọc theo chip, tổng tiền CÙNG trạng thái, quy tắc "≥100",
 * tuổi yêu cầu, "dữ liệu đã cũ".
 *
 * Chạy: npx tsx --test src/app/pages/admin/__tests__/b5-withdrawal-queue.test.ts (từ frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  WITHDRAWAL_API_LIMIT,
  centsToVnd,
  countText,
  formatAge,
  normalizeQueue,
  parseStatusParam,
  rowsFor,
  shortId,
  staleMinutes,
  sumAmounts,
  summarize,
  toCents,
} from "../withdrawals/withdrawalQueue";

const row = (n: number, status: "PENDING" | "APPROVED", amount: string, createdAt = "2026-10-25T03:00:00Z") => ({
  id: `00000000-0000-4000-8000-${String(n).padStart(12, "0")}`,
  ownerType: "PT",
  ownerId: `bbbbbbbb-0000-4000-8000-${String(n).padStart(12, "0")}`,
  amount,
  status,
  payoutInfo: "VCB 001",
  createdAt,
});

describe("parseStatusParam", () => {
  it("defaults to PENDING and accepts APPROVED (case-insensitive)", () => {
    assert.equal(parseStatusParam(null), "PENDING");
    assert.equal(parseStatusParam(undefined), "PENDING");
    assert.equal(parseStatusParam(""), "PENDING");
    assert.equal(parseStatusParam("PENDING"), "PENDING");
    assert.equal(parseStatusParam("APPROVED"), "APPROVED");
    assert.equal(parseStatusParam("approved"), "APPROVED");
  });
  it("falls back to PENDING for the chips that need G-08 and for junk", () => {
    for (const v of ["PAID", "REJECTED", "ALL", "<script>", "PENDING,APPROVED"]) assert.equal(parseStatusParam(v), "PENDING");
  });
});

describe("normalizeQueue + rowsFor (chip filtering)", () => {
  const data = [
    row(1, "PENDING", "1000000"),
    row(2, "APPROVED", "5000000.00"),
    row(3, "PENDING", "250000"),
    row(4, "APPROVED", "700000"),
    row(5, "PENDING", "50000", "2026-10-20T03:00:00Z"),
  ];
  it("each chip shows only its own status, oldest first", () => {
    const q = normalizeQueue(data);
    assert.equal(q.rows.length, 5);
    const pending = rowsFor(q.rows, "PENDING");
    assert.deepEqual(pending.map((r) => r.amount), ["50000", "1000000", "250000"]);
    const approved = rowsFor(q.rows, "APPROVED");
    assert.deepEqual(approved.map((r) => r.amount), ["5000000.00", "700000"]);
    assert.ok(pending.every((r) => r.status === "PENDING") && approved.every((r) => r.status === "APPROVED"));
  });
  it("drops rows the screen cannot act on (PAID / REJECTED / no id / not an object) and counts them", () => {
    const q = normalizeQueue([row(1, "PENDING", "1"), { ...row(2, "PENDING", "1"), status: "PAID" }, { ...row(3, "PENDING", "1"), status: "REJECTED" }, { status: "PENDING" }, null, "x"]);
    assert.equal(q.rows.length, 1);
    assert.equal(q.ignored, 5);
    assert.equal(q.rawCount, 6);
  });
  it("non-array answers are an empty queue, not a crash", () => {
    for (const bad of [undefined, null, {}, "x", 5]) {
      const q = normalizeQueue(bad);
      assert.deepEqual(q.rows, []);
      assert.equal(q.truncated, false);
    }
  });
});

describe("sumAmounts — totals of the same status only, no float", () => {
  it("sums decimal strings exactly", () => {
    assert.equal(sumAmounts([{ amount: "1500000" }, { amount: "1500000.00" }, { amount: "0.5" }]).cents, 300000050n);
    assert.equal(centsToVnd(sumAmounts([{ amount: "100000" }, { amount: "200000" }]).cents), 300000);
    assert.equal(centsToVnd(sumAmounts([]).cents), 0);
  });
  it("0.1 + 0.2 style float noise cannot happen", () => {
    assert.equal(sumAmounts([{ amount: "0.10" }, { amount: "0.20" }]).cents, 30n);
  });
  it("one unreadable amount makes the total unknown (never a partial sum shown as the total)", () => {
    const s = sumAmounts([{ amount: "1000" }, { amount: "abc" }, { amount: "" }, { amount: "-5" }]);
    assert.equal(s.cents, null);
    assert.equal(s.invalid, 3);
    assert.equal(centsToVnd(s.cents), null);
  });
  it("toCents truncates beyond 2 decimals and rejects junk", () => {
    assert.equal(toCents("12.345"), 1234n);
    assert.equal(toCents("12.5"), 1250n);
    assert.equal(toCents("1e6"), null);
    assert.equal(toCents("1,000"), null);
  });
  it("summarize: each chip's total uses only that status", () => {
    const q = normalizeQueue([row(1, "PENDING", "1000000"), row(2, "APPROVED", "5000000"), row(3, "PENDING", "250000")]);
    const s = summarize(q);
    assert.equal(s.PENDING.count, 2);
    assert.equal(centsToVnd(s.PENDING.total.cents), 1250000);
    assert.equal(s.APPROVED.count, 1);
    assert.equal(centsToVnd(s.APPROVED.total.cents), 5000000);
  });
  it("summarize: oldest = earliest createdAt of the chip", () => {
    const q = normalizeQueue([row(1, "PENDING", "1", "2026-10-25T03:00:00Z"), row(2, "PENDING", "1", "2026-10-22T03:00:00Z"), row(3, "APPROVED", "1", "2026-10-01T00:00:00Z")]);
    const s = summarize(q);
    assert.equal(s.PENDING.oldest, "2026-10-22T03:00:00Z");
    assert.equal(s.APPROVED.oldest, "2026-10-01T00:00:00Z");
    assert.equal(summarize(normalizeQueue([])).PENDING.oldest, null);
  });
});

describe("the ≥100 rule (API cap)", () => {
  const many = (n: number) => Array.from({ length: n }, (_, i) => row(i + 1, i % 2 ? "APPROVED" : "PENDING", "1000"));
  it("exactly 100 rows = truncated; 99 = exact", () => {
    assert.equal(WITHDRAWAL_API_LIMIT, 100);
    assert.equal(normalizeQueue(many(100)).truncated, true);
    assert.equal(normalizeQueue(many(99)).truncated, false);
    assert.equal(normalizeQueue(many(101)).truncated, true);
    assert.equal(normalizeQueue(many(0)).truncated, false);
  });
  it("the cap is on what the server sent, not on what the screen can show", () => {
    const data = [...many(98), { ...row(999, "PENDING", "1"), status: "PAID" }, { ...row(998, "PENDING", "1"), status: "REJECTED" }];
    const q = normalizeQueue(data);
    assert.equal(q.rows.length, 98);
    assert.equal(q.truncated, true);
  });
  it("counts become lower bounds (≥N) only when truncated", () => {
    const t = summarize(normalizeQueue(many(100)));
    assert.equal(t.PENDING.lowerBound, true);
    assert.equal(countText(t.PENDING.count, t.PENDING.lowerBound), "≥50");
    const e = summarize(normalizeQueue(many(99)));
    assert.equal(e.PENDING.lowerBound, false);
    assert.equal(countText(e.PENDING.count, e.PENDING.lowerBound), "50");
  });
});

describe("formatAge", () => {
  const T = Date.parse("2026-10-27T12:00:00Z");
  const ago = (ms: number) => new Date(T - ms).toISOString();
  const M = 60_000;
  const H = 60 * M;
  const D = 24 * H;
  it("minutes / hours / days in Vietnamese, zero parts omitted", () => {
    assert.equal(formatAge(ago(10_000), T), "vừa xong");
    assert.equal(formatAge(ago(5 * M), T), "5 phút");
    assert.equal(formatAge(ago(59 * M), T), "59 phút");
    assert.equal(formatAge(ago(5 * H + 30 * M), T), "5 giờ 30 phút");
    assert.equal(formatAge(ago(3 * H), T), "3 giờ");
    assert.equal(formatAge(ago(D + 2 * H), T), "1 ngày 2 giờ");
    assert.equal(formatAge(ago(2 * D), T), "2 ngày");
  });
  it("a bad or future date never shows NaN", () => {
    assert.equal(formatAge("", T), "—");
    assert.equal(formatAge("not-a-date", T), "—");
    assert.equal(formatAge(ago(-5 * M), T), "vừa xong");
  });
});

describe("staleMinutes (E-08) and misc", () => {
  const T = Date.parse("2026-10-27T12:00:00Z");
  it("silent under 3 minutes, N minutes after", () => {
    assert.equal(staleMinutes(T - 2 * 60_000, T), null);
    assert.equal(staleMinutes(T - 3 * 60_000, T), 3);
    assert.equal(staleMinutes(T - 7 * 60_000 - 10_000, T), 7);
    assert.equal(staleMinutes(0, T), null);
  });
  it("shortId", () => {
    assert.equal(shortId("aaaaaaaa-0000-4000-8000-000000000001"), "aaaaaaaa");
    assert.equal(shortId(""), "—");
  });
});
