/**
 * G-08 — withdrawal history ("Đã chuyển" / "Từ chối"): API wire shape, row mapping, URL parsing, query keys, read-only guard.
 * Evidence label: TEST FIXTURE (a fake HTTP client records calls; no request leaves the process; no backend, no dev/E2E stack).
 * Run: npx tsx --test src/app/pages/admin/__tests__/g08-withdrawal-history.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  HISTORY_MAX_PAGE,
  HISTORY_PAGE_SIZE,
  HISTORY_ROOT,
  WITHDRAWAL_HISTORY_PATH,
  createWithdrawalHistoryApi,
  historyKey,
  historyPageCount,
  normalizeHistory,
  parseHistoryPage,
  parseHistoryTab,
  toHistoryQuery,
  toHistoryRowView,
  type WithdrawalHistoryHttpClient,
  type WithdrawalHistoryItem,
} from "../withdrawals/withdrawalHistory";

const dir = dirname(fileURLToPath(import.meta.url));
const src = (rel: string) => readFileSync(join(dir, "..", rel), "utf8");

const OWNER = "bbbbbbbb-0000-4000-8000-000000000001";
const REQ = "aaaaaaaa-0000-4000-8000-000000000002";
const ADMIN = "cccccccc-0000-4000-8000-000000000003";

const paid = (over: Record<string, unknown> = {}) => ({
  id: REQ,
  walletId: "w1",
  ownerType: "PT",
  ownerId: OWNER,
  amount: "299999.80",
  status: "PAID",
  bankReference: "VCB-TXN-001",
  rejectionReason: null,
  approvedBy: ADMIN,
  reviewedAt: "2026-11-01T01:00:00.000Z",
  paidAt: "2026-11-01T02:00:00.000Z",
  createdAt: "2026-10-31T00:00:00.000Z",
  walletAvailableNow: "1234567.89",
  ...over,
});
const rejected = (over: Record<string, unknown> = {}) =>
  paid({ id: "r-1", status: "REJECTED", bankReference: null, rejectionReason: "Sai thông tin", paidAt: null, ownerType: "GYM", ...over });

const body = (items: unknown[], extra: Record<string, unknown> = {}) => ({ total: items.length, limit: 25, offset: 0, hasMore: false, items, ...extra });

function fakeClient(response: unknown) {
  const calls: Array<{ url: string; params?: Record<string, string | number> }> = [];
  const client: WithdrawalHistoryHttpClient = {
    async get(url, config) {
      calls.push({ url, params: config?.params });
      return { data: response };
    },
  };
  return { client, calls };
}

describe("API wire shape", () => {
  it("calls GET /admin/payments/withdrawal-history with only status, limit, offset", async () => {
    const { client, calls } = fakeClient(body([paid()]));
    const page = await createWithdrawalHistoryApi(client).listHistory(toHistoryQuery("PAID", 3));
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/admin/payments/withdrawal-history");
    assert.equal(WITHDRAWAL_HISTORY_PATH, "/admin/payments/withdrawal-history");
    assert.deepEqual(calls[0].params, { status: "PAID", limit: 25, offset: 50 });
    assert.equal(page.items.length, 1);
    assert.equal(page.total, 1);
  });

  it("page 1 → offset 0; the last reachable page stays within the server's offset ≤ 100000", () => {
    assert.deepEqual(toHistoryQuery("REJECTED", 1), { status: "REJECTED", limit: 25, offset: 0 });
    assert.deepEqual(toHistoryQuery("PAID", 0), { status: "PAID", limit: 25, offset: 0 });
    assert.ok(toHistoryQuery("PAID", HISTORY_MAX_PAGE).offset <= 100000);
  });

  it("a body that is not the documented list is a FAILURE (throws), never an empty list", async () => {
    for (const bad of [null, "x", [], {}, { items: "no", total: 1 }, { items: [], total: "1" }, { total: 0 }]) {
      const { client } = fakeClient(bad);
      await assert.rejects(() => createWithdrawalHistoryApi(client).listHistory(toHistoryQuery("PAID", 1)), (e: any) => e?.malformed === true);
    }
  });

  it("keeps the paging fields and drops unreadable rows or rows of another status, counting them", () => {
    const page = normalizeHistory(
      body([paid(), { status: "PAID" }, null, paid({ id: "x", amount: 5 }), paid({ id: "p2", status: "PENDING" }), paid({ id: "p3" })], {
        total: 61,
        offset: 25,
        hasMore: true,
      }),
      "PAID",
    )!;
    assert.deepEqual(page.items.map((i) => i.id), [REQ, "p3"]);
    assert.equal(page.ignored, 4);
    assert.equal(page.total, 61);
    assert.equal(page.offset, 25);
    assert.equal(page.hasMore, true);
  });

  it("never carries payoutInfo even if a server sent it", () => {
    const page = normalizeHistory(body([paid({ payoutInfo: "STK 0123 SECRET" })]), "PAID")!;
    assert.ok(!JSON.stringify(page).includes("SECRET"));
    assert.ok(!("payoutInfo" in page.items[0]));
  });

  it("an empty page is a valid answer (total 0)", () => {
    const page = normalizeHistory(body([]), "REJECTED")!;
    assert.equal(page.total, 0);
    assert.deepEqual(page.items, []);
  });
});

describe("row mapping", () => {
  const item = (r: unknown) => normalizeHistory(body([r]), (r as { status: "PAID" | "REJECTED" }).status)!.items[0] as WithdrawalHistoryItem;

  it("PAID: exact amount, owner label + short id, bank reference, paid time, 'mã …' for another admin", () => {
    const v = toHistoryRowView(item(paid()), "someone-else");
    assert.match(v.amountText, /^299\.999,80\s₫$/); // exact, 2 decimals, never rounded
    assert.equal(v.ownerLabel, "Huấn luyện viên");
    assert.equal(v.ownerShortId, "bbbbbbbb");
    assert.equal(v.shortId, "aaaaaaaa");
    assert.equal(v.approvedByText, "mã cccccccc");
    assert.equal(v.whenLabel, "Chuyển lúc");
    assert.equal(v.whenIso, "2026-11-01T02:00:00.000Z");
    assert.equal(v.noteLabel, "Mã tham chiếu ngân hàng");
    assert.equal(v.noteText, "VCB-TXN-001");
  });

  it("the current admin is shown as 'bạn'", () => {
    assert.equal(toHistoryRowView(item(paid()), ADMIN).approvedByText, "bạn");
  });

  it("REJECTED: reason instead of bank reference, reviewedAt as the time, Vietnamese owner label", () => {
    const v = toHistoryRowView(item(rejected()), null);
    assert.equal(v.ownerLabel, "Phòng gym");
    assert.equal(v.whenLabel, "Từ chối lúc");
    assert.equal(v.whenIso, "2026-11-01T01:00:00.000Z");
    assert.equal(v.noteLabel, "Lý do từ chối");
    assert.equal(v.noteText, "Sai thông tin");
  });

  it("missing values show '—', never 0 or an empty string; an unknown owner type has no raw enum", () => {
    const v = toHistoryRowView(item(paid({ approvedBy: null, bankReference: null, paidAt: null, reviewedAt: null, walletAvailableNow: null, ownerType: "WEIRD" })), ADMIN);
    assert.equal(v.approvedByText, "—");
    assert.equal(v.noteText, "—");
    assert.equal(v.whenText, "—");
    assert.equal(v.whenIso, null);
    assert.equal(v.walletAvailableText, "—");
    assert.equal(v.ownerLabel, "Khác");
  });

  it("whole-dong and large amounts are not rounded or truncated", () => {
    assert.equal(toHistoryRowView(item(paid({ amount: "5000000.00" })), null).amountText.replace(/\s/g, " "), "5.000.000 ₫");
    assert.match(toHistoryRowView(item(paid({ amount: "100000.01" })), null).amountText, /100\.000,01/);
  });
});

describe("URL parsing", () => {
  it("?status=PAID|REJECTED opens a history tab (case-insensitive); queue chips and junk do not", () => {
    assert.equal(parseHistoryTab("PAID"), "PAID");
    assert.equal(parseHistoryTab("rejected"), "REJECTED");
    for (const v of [null, undefined, "", "PENDING", "APPROVED", "ALL", "<script>", "PAID,REJECTED"]) assert.equal(parseHistoryTab(v as never), null);
  });

  it("?page= is a 1-based integer clamped to the reachable range; junk → 1", () => {
    assert.equal(parseHistoryPage(null), 1);
    assert.equal(parseHistoryPage("3"), 3);
    for (const v of ["0", "-1", "1.5", "abc", ""]) assert.equal(parseHistoryPage(v), 1);
    assert.equal(parseHistoryPage("99999999"), HISTORY_MAX_PAGE);
  });

  it("page count is at least 1", () => {
    assert.equal(historyPageCount(0), 1);
    assert.equal(historyPageCount(25), 1);
    assert.equal(historyPageCount(26), 2);
    assert.equal(HISTORY_PAGE_SIZE, 25);
  });
});

describe("query keys (user isolation, shared refresh prefix)", () => {
  it("are user-scoped and start with the queue's prefix so the header refresh reaches them", () => {
    const a = historyKey("u1", toHistoryQuery("PAID", 1));
    const b = historyKey("u2", toHistoryQuery("PAID", 1));
    assert.notDeepEqual(a, b);
    assert.deepEqual(a.slice(0, 2), ["admin", "pending-withdrawals"]);
    assert.deepEqual([...HISTORY_ROOT], ["admin", "pending-withdrawals", "history"]);
    assert.equal(a[3], "u1");
    assert.equal(a[4], "PAID"); // the hook's placeholderData compares this index
    assert.throws(() => historyKey("", toHistoryQuery("PAID", 1)));
  });
});

describe("source guards", () => {
  it("history client is read only (get only) and sends no payout fields", () => {
    const text = src("withdrawals/withdrawalHistory.ts");
    assert.ok(!/\.(post|put|patch|delete)\(/.test(text));
    assert.ok(!/payoutInfo/.test(text.replace(/\/\*[\s\S]*?\*\/|\/\/.*$/gm, "")));
  });

  it("the page no longer says the history needs an API, and the panel has the required copy", () => {
    const page = src("AdminWithdrawals.tsx");
    assert.ok(!/G-08\)|cần API/.test(page));
    assert.ok(!page.includes("chip-disabled"));
    const panel = src("withdrawals/WithdrawalHistoryPanel.tsx");
    assert.ok(panel.includes("Chưa có yêu cầu nào ở trạng thái này."));
    assert.ok(panel.includes("Thử lại"));
    assert.ok(panel.includes("admin-withdrawal-history-error"));
  });

  it("the history hook is user-scoped, never polls and never retries on its own", () => {
    const hook = src("withdrawals/useWithdrawalHistory.ts");
    assert.match(hook, /refetchInterval: false/);
    assert.match(hook, /retry: false/);
    assert.match(hook, /user\?\.id/);
  });
});
