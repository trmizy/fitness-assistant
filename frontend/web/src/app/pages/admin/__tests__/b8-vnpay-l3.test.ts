/**
 * B8 L3 — "Đối chiếu trực tiếp với VNPay": API wire shape, normaliser, grouping, labels, exact money, day range, query key, on-demand / read-only guards.
 * Evidence label: TEST FIXTURE (a fake HTTP client records calls; no request leaves the process; no backend, no dev/E2E stack).
 * Run: npx tsx --test src/app/pages/admin/__tests__/b8-vnpay-l3.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  L3_MAX_RANGE_DAYS,
  L3_NOT_CONFIGURED_TEXT,
  L3_PATH,
  L3_REQUEST_TIMEOUT_MS,
  L3_STATUS_NOTE,
  L3_TITLE,
  RESULT_LABEL,
  countChips,
  defaultL3Range,
  groupL3Items,
  isL3Clean,
  l3RangeProblem,
  l3TransactionLink,
  needsAttention,
  normalizeL3Item,
  normalizeL3Report,
  resultTone,
  toL3Query,
  vnpayStatusText,
} from "../reconciliation/gateway/vnpayL3Model";
import { createVnpayL3Api, type VnpayL3HttpClient } from "../reconciliation/gateway/vnpayL3Api";
import { L3_QUERY_OPTIONS, L3_ROOT, l3Keys } from "../reconciliation/gateway/useVnpayL3";
import { formatMoneyExact } from "../adminFinanceOverview.utils";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, "..", rel), "utf8");
const TXN = "0b0e6a64-2f5a-4c5e-9d1e-1234567890ab";

const item = (over: Record<string, unknown> = {}) => ({
  transactionId: TXN,
  providerTransactionId: "ref-123",
  gyminiStatus: "PAID",
  gyminiAmount: "100000.00",
  vnpayStatusCode: "00",
  vnpayAmount: "100000.00",
  result: "MATCHED",
  note: "Khớp.",
  ...over,
});
const counts = (over: Record<string, unknown> = {}) => ({ checked: 0, matched: 0, notFoundAtVnpay: 0, statusMismatch: 0, amountMismatch: 0, queryFailed: 0, ...over });
const report = (over: Record<string, unknown> = {}) => ({
  scope: "L3",
  provider: "VNPAY",
  from: "2026-11-04T00:00:00.000Z",
  to: "2026-11-11T00:00:00.000Z",
  generatedAt: "2026-11-11T05:00:00.000Z",
  counts: counts({ checked: 1, matched: 1 }),
  items: [item()],
  truncated: false,
  configured: true,
  ...over,
});

describe("L3 wire shape and normaliser", () => {
  it("reads the documented report; money stays a decimal string", () => {
    const r = normalizeL3Report(report());
    assert.ok(r);
    assert.equal(r.scope, "L3");
    assert.equal(r.items[0].gyminiAmount, "100000.00");
    assert.equal(r.items[0].vnpayAmount, "100000.00");
    assert.equal(r.configured, true);
    assert.equal(r.truncated, false);
    assert.equal(r.ignored, 0);
    assert.equal(formatMoneyExact(r.items[0].gyminiAmount), formatMoneyExact("100000.00"));
  });

  it("a body that is not the documented report is rejected (a load failure, never 'no discrepancy')", () => {
    for (const data of [null, "ok", {}, { ...report(), scope: "L2" }, { ...report(), provider: "MOMO" }, { ...report(), items: "x" }, { ...report(), counts: null }, { ...report(), configured: "yes" }, { ...report(), truncated: undefined }, { ...report(), generatedAt: 5 }]) {
      assert.equal(normalizeL3Report(data), null, JSON.stringify(data));
    }
  });

  it("configured:false with no items is a valid report", () => {
    const r = normalizeL3Report(report({ configured: false, items: [], counts: counts() }));
    assert.ok(r);
    assert.equal(r.configured, false);
    assert.equal(r.items.length, 0);
  });

  it("an unreadable item (no id, unknown result, wrong types) is dropped and counted, the rest is kept", () => {
    const r = normalizeL3Report(report({ items: [item(), item({ transactionId: "" }), item({ result: "SOMETHING_NEW" }), "x", item({ note: 1 })] }));
    assert.ok(r);
    assert.equal(r.items.length, 1);
    assert.equal(r.ignored, 4);
    assert.equal(normalizeL3Item(item({ vnpayStatusCode: "" }))?.vnpayStatusCode, null);
    assert.equal(normalizeL3Item(item({ vnpayAmount: null }))?.vnpayAmount, null);
  });

  it("garbage counts become 0, never NaN / negative", () => {
    const r = normalizeL3Report(report({ counts: { checked: "5", matched: -1, statusMismatch: NaN, queryFailed: 2 } }));
    assert.ok(r);
    assert.deepEqual(r.counts, counts({ queryFailed: 2 }));
  });
});

describe("L3 grouping: 'không hỏi được' is never a mismatch", () => {
  const rows = [
    item({ transactionId: "a", result: "MATCHED" }),
    item({ transactionId: "b", result: "STATUS_MISMATCH", vnpayStatusCode: "02" }),
    item({ transactionId: "c", result: "AMOUNT_MISMATCH", vnpayAmount: "90000.00" }),
    item({ transactionId: "d", result: "NOT_FOUND_AT_VNPAY", gyminiStatus: "PAID", vnpayStatusCode: null, vnpayAmount: null }),
    item({ transactionId: "e", result: "NOT_FOUND_AT_VNPAY", gyminiStatus: "PENDING", vnpayStatusCode: null, vnpayAmount: null }),
    item({ transactionId: "f", result: "QUERY_FAILED", vnpayStatusCode: null, vnpayAmount: null }),
  ];
  const r = normalizeL3Report(report({ items: rows, counts: counts({ checked: 6, matched: 1, statusMismatch: 1, amountMismatch: 1, notFoundAtVnpay: 2, queryFailed: 1 }) }));

  it("attention = mismatches + 'paid in Gymini, unknown to VNPay'; failed apart; a never-paid checkout unknown to VNPay is information only", () => {
    assert.ok(r);
    const g = groupL3Items(r);
    assert.deepEqual(g.attention.map((i) => i.transactionId), ["b", "c", "d"]);
    assert.deepEqual(g.failed.map((i) => i.transactionId), ["f"]);
    assert.deepEqual(g.notFoundNormal.map((i) => i.transactionId), ["e"]);
    assert.equal(needsAttention(r.items[5]), false);
    assert.equal(needsAttention(r.items[0]), false);
  });

  it("isL3Clean: only when configured, something was asked, no mismatch and no failed lookup", () => {
    const ok = normalizeL3Report(report());
    assert.ok(ok && isL3Clean(ok));
    assert.equal(isL3Clean(r as NonNullable<typeof r>), false);
    const failedOnly = normalizeL3Report(report({ items: [item({ result: "QUERY_FAILED" })], counts: counts({ checked: 1, queryFailed: 1 }) }));
    assert.ok(failedOnly);
    assert.equal(isL3Clean(failedOnly), false);
    const none = normalizeL3Report(report({ items: [], counts: counts() }));
    assert.ok(none);
    assert.equal(isL3Clean(none), false);
    const notConfigured = normalizeL3Report(report({ configured: false, items: [], counts: counts() }));
    assert.ok(notConfigured);
    assert.equal(isL3Clean(notConfigured), false);
    const normalNotFound = normalizeL3Report(report({ items: [item({ gyminiStatus: "PENDING", result: "NOT_FOUND_AT_VNPAY" })], counts: counts({ checked: 1, notFoundAtVnpay: 1 }) }));
    assert.ok(normalNotFound);
    assert.equal(isL3Clean(normalNotFound), true);
  });

  it("count chips: one per result, values from the server counts, 'không hỏi được' is its own chip", () => {
    const chips = countChips(counts({ checked: 6, matched: 1, statusMismatch: 1, amountMismatch: 1, notFoundAtVnpay: 2, queryFailed: 1 }));
    assert.deepEqual(chips.map((c) => [c.key, c.value]), [["checked", 6], ["matched", 1], ["statusMismatch", 1], ["amountMismatch", 1], ["notFoundAtVnpay", 2], ["queryFailed", 1]]);
    assert.equal(chips.find((c) => c.key === "queryFailed")?.label, "Không hỏi được");
  });
});

describe("L3 labels", () => {
  it("every result has a Vietnamese label and a tone; VNPay status codes map with a neutral fallback", () => {
    for (const k of ["MATCHED", "NOT_FOUND_AT_VNPAY", "STATUS_MISMATCH", "AMOUNT_MISMATCH", "QUERY_FAILED"] as const) {
      assert.match(RESULT_LABEL[k], /\p{L}/u);
      assert.ok(resultTone(k));
    }
    assert.equal(vnpayStatusText("00"), "Thành công");
    assert.equal(vnpayStatusText("42"), "Trạng thái khác");
    assert.equal(vnpayStatusText(null), "—");
    assert.equal(L3_NOT_CONFIGURED_TEXT, "Chưa cấu hình tài khoản VNPay ở môi trường này");
    assert.match(L3_TITLE, /VNPay \(L3\)/);
  });

  it("the L3 status line says L3 exists for VNPay only and no longer says BLOCKED", () => {
    assert.match(L3_STATUS_NOTE, /VNPay/);
    assert.match(L3_STATUS_NOTE, /ZaloPay/);
    assert.match(L3_STATUS_NOTE, /MoMo, PayOS đã ngừng dùng/);
    assert.doesNotMatch(L3_STATUS_NOTE, /ZaloPay, PayOS, MoMo/);
    assert.doesNotMatch(L3_STATUS_NOTE, /BLOCKED/);
  });

  it("the link goes to the transaction drawer", () => {
    assert.equal(l3TransactionLink(TXN), `/admin/finance/transactions?id=${TXN}`);
  });
});

describe("L3 day range and request", () => {
  it("default = the last 7 local days; max 31 days; to before from is refused", () => {
    const now = new Date(2026, 10, 11, 9, 30);
    assert.deepEqual(defaultL3Range(now), { from: "2026-11-05", to: "2026-11-11" });
    assert.equal(l3RangeProblem({ from: "2026-11-05", to: "2026-11-11" }), null);
    assert.equal(l3RangeProblem({ from: "2026-10-12", to: "2026-11-11" }), null); // 31 days inclusive
    assert.equal(l3RangeProblem({ from: "2026-10-11", to: "2026-11-11" }), "TOO_LONG"); // 32 days
    assert.equal(l3RangeProblem({ from: "2026-11-11", to: "2026-11-10" }), "ORDER");
    assert.equal(L3_MAX_RANGE_DAYS, 31);
  });

  it("toL3Query: from inclusive (local midnight), to exclusive (midnight of the day after), both ISO", () => {
    const q = toL3Query({ from: "2026-11-05", to: "2026-11-11" });
    assert.equal(q.from, new Date(2026, 10, 5).toISOString());
    assert.equal(q.to, new Date(2026, 10, 12).toISOString());
  });

  it("the client sends exactly GET /l3 with from/to and a long timeout, nothing else", async () => {
    const calls: Array<{ url: string; config?: { params?: Record<string, string>; timeout?: number } }> = [];
    const client: VnpayL3HttpClient = {
      async get(url, config) {
        calls.push({ url, config });
        return { data: report() };
      },
    };
    const api = createVnpayL3Api(client);
    const out = await api.getReport({ from: "2026-11-05", to: "2026-11-11" });
    assert.equal(out.scope, "L3");
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, L3_PATH);
    assert.equal(L3_PATH, "/admin/payments/gateway-reconciliation/l3");
    assert.deepEqual(Object.keys(calls[0].config?.params ?? {}).sort(), ["from", "to"]);
    assert.equal(calls[0].config?.timeout, L3_REQUEST_TIMEOUT_MS);
    assert.ok(L3_REQUEST_TIMEOUT_MS >= 100_000);
  });

  it("a malformed 2xx body is a failure flagged malformed, and a rejected request propagates", async () => {
    const bad = createVnpayL3Api({ get: async () => ({ data: { scope: "L2" } }) });
    await assert.rejects(bad.getReport({ from: "2026-11-05", to: "2026-11-11" }), (e: unknown) => (e as { malformed?: boolean }).malformed === true);
    const down = createVnpayL3Api({ get: async () => { throw Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }); } });
    await assert.rejects(down.getReport({ from: "2026-11-05", to: "2026-11-11" }), /Network Error/);
  });
});

describe("L3 query key and options: on demand, no polling, user scoped, outside the finance prefix", () => {
  it("key = ['admin','vnpay-l3', userId, from, to]; needs a user id; NOT under ['admin','finance'] (the header refresh must not re-ask VNPay)", () => {
    assert.deepEqual(l3Keys("u1").report({ from: "2026-11-05", to: "2026-11-11" }), ["admin", "vnpay-l3", "u1", "2026-11-05", "2026-11-11"]);
    assert.throws(() => l3Keys(""));
    assert.notDeepEqual([...L3_ROOT].slice(0, 2), ["admin", "finance"]);
    assert.notEqual(l3Keys("u1").all[1], "finance");
    assert.notDeepEqual(l3Keys("u1").all, l3Keys("u2").all);
  });

  it("no polling, no refetch on focus / reconnect, no retry", () => {
    assert.equal(L3_QUERY_OPTIONS.refetchInterval, false);
    assert.equal(L3_QUERY_OPTIONS.refetchOnWindowFocus, false);
    assert.equal(L3_QUERY_OPTIONS.refetchOnReconnect, false);
    assert.equal(L3_QUERY_OPTIONS.retry, false);
  });
});

describe("L3 source guards", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = [
    "reconciliation/gateway/vnpayL3Model.ts",
    "reconciliation/gateway/vnpayL3Api.ts",
    "reconciliation/gateway/useVnpayL3.ts",
    "reconciliation/gateway/VnpayL3Section.tsx",
  ];

  it("read only: no write verb, no mutation hook", () => {
    for (const f of files) {
      assert.doesNotMatch(strip(read(f)), /\b(api|client|axios)\.(post|put|patch|delete|request)\(|useMutation|Idempotency-Key/i, f);
    }
  });

  it("money: no Number() / parseFloat / sum; the section uses formatMoneyExact", () => {
    for (const f of files) assert.doesNotMatch(strip(read(f)), /\bNumber\(|parseFloat|formatVND|\.reduce\(|sumCents|addAmounts/, f);
    assert.match(read("reconciliation/gateway/VnpayL3Section.tsx"), /formatMoneyExact/);
  });

  it("on demand: the query is enabled only after a click (asked range), never polled", () => {
    const hook = strip(read("reconciliation/gateway/useVnpayL3.ts"));
    assert.match(hook, /enabled: !!keys && asked !== null/);
    assert.doesNotMatch(hook, /refetchInterval:(?!\s*false)/);
    assert.doesNotMatch(hook, /\["admin", "finance"/);
  });

  it("the section never prints a raw enum: result / status go through the label helpers", () => {
    const view = strip(read("reconciliation/gateway/VnpayL3Section.tsx"));
    assert.doesNotMatch(view, />\s*\{i\.(result|gyminiStatus|vnpayStatusCode)\}/);
    assert.match(view, /RESULT_LABEL/);
    assert.match(view, /TxnStatusPill/);
    assert.match(view, /Hỏi VNPay/);
    assert.match(view, /L3_NOT_CONFIGURED_TEXT/);
  });

  it("the gateway view keeps the L2 content, shows the L3 section and no longer says BLOCKED", () => {
    const view = strip(read("reconciliation/gateway/GatewayReconciliationView.tsx"));
    assert.match(view, /<VnpayL3Section \/>/);
    assert.match(view, /L2_BANNER_TEXT/);
    assert.match(view, /L3_STATUS_NOTE/);
    assert.doesNotMatch(view, /GATEWAY_CHIP_REASON|BLOCKED/);
  });
});
