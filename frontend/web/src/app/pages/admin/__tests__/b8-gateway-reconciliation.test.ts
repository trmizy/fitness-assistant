/**
 * B8 — "Tài chính › Đối soát › Đối chiếu cổng ↔ Gymini" (level L2): API wire shape, normaliser, labels, exact money, URL range, query key, read-only guard.
 * Evidence label: TEST FIXTURE (a fake HTTP client records calls; no request leaves the process; no backend, no dev/E2E stack).
 * Run: npx tsx --test src/app/pages/admin/__tests__/b8-gateway-reconciliation.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  EMPTY_TEXT,
  GATEWAY_RECON_PATH,
  L2_BANNER_TEXT,
  MAX_RANGE_DAYS,
  CATEGORY_TEXT,
  categoryTitle,
  categoryTotal,
  defaultRange,
  isReportClean,
  itemProviderText,
  itemStatusText,
  normalizeGatewayItem,
  normalizeGatewayReport,
  orderedCategories,
  parseDay,
  parseRange,
  rangeDays,
  rangeProblem,
  toGatewayQuery,
  transactionLink,
  withRange,
} from "../reconciliation/gateway/gatewayReconciliationModel";
import {
  createGatewayReconciliationApi,
  isMalformedGatewayReport,
  type GatewayHttpClient,
} from "../reconciliation/gateway/gatewayReconciliationApi";
import { GATEWAY_QUERY_OPTIONS, gatewayReconKeys } from "../reconciliation/gateway/useGatewayReconciliation";
import { RECON_VIEWS, RECON_VIEW_LABEL, RECON_VIEW_LEVEL, parseReconView, switchReconView } from "../reconciliation/reconciliationView";
import { formatMoneyExact } from "../adminFinanceOverview.utils";

const dir = dirname(fileURLToPath(import.meta.url));
const read = (rel: string) => readFileSync(join(dir, "..", rel), "utf8");
const TXN = "0b0e6a64-2f5a-4c5e-9d1e-1234567890ab";
const EVT = "9c1e6a64-2f5a-4c5e-9d1e-1234567890cd";

// ─────────────────────────────────────────────────────────────── fixtures ──
const item = (over: Record<string, unknown> = {}) => ({
  transactionId: TXN,
  webhookEventId: EVT,
  provider: "PAYOS",
  providerTransactionId: "ref-123",
  transactionStatus: "PAID",
  amount: "100000.00",
  reportedAmount: "90000.00",
  createdAt: "2026-11-05T03:00:00.000Z",
  note: "Số tiền PayOS báo về khác số tiền của giao dịch.",
  ...over,
});
const category = (code: string, severity: string, items: unknown[] = [], truncated = false) => ({ code, label: `nhãn ${code}`, severity, items, truncated });
const report = (over: Record<string, unknown> = {}) => ({
  scope: "L2",
  from: "2026-10-11T00:00:00.000Z",
  to: "2026-11-10T00:00:00.000Z",
  generatedAt: "2026-11-10T01:00:00.000Z",
  counts: {
    webhookEventsInRange: 40,
    paidGatewayTransactionsInRange: 12,
    webhookUnprocessed: 0,
    webhookOrphan: 0,
    gatewaySuccessNotPaid: 0,
    reportedAmountMismatch: 1,
    paidWithoutGatewayEvent: 0,
    coveredByGatewayDiscrepancies: 2,
  },
  categories: [
    category("WEBHOOK_UNPROCESSED", "danger"),
    category("WEBHOOK_ORPHAN", "warning"),
    category("GATEWAY_SUCCESS_NOT_PAID", "danger"),
    category("REPORTED_AMOUNT_MISMATCH", "danger", [item()]),
    category("PAID_WITHOUT_GATEWAY_EVENT", "info"),
  ],
  ...over,
});

// ───────────────────────────────────────────────────────── API wire shape ──
describe("B8 API client: wire shape (fake client)", () => {
  it("sends GET /admin/payments/gateway-reconciliation with ONLY from/to (ISO, to exclusive) and nothing else", async () => {
    const calls: Array<{ url: string; params?: Record<string, string> }> = [];
    const client: GatewayHttpClient = {
      async get(url, config) {
        calls.push({ url, params: config?.params });
        return { data: report() };
      },
    };
    const out = await createGatewayReconciliationApi(client).getReport({ from: "2026-11-01", to: "2026-11-03" });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/admin/payments/gateway-reconciliation");
    assert.equal(GATEWAY_RECON_PATH, calls[0].url);
    assert.deepEqual(Object.keys(calls[0].params ?? {}).sort(), ["from", "to"]);
    const p = calls[0].params as { from: string; to: string };
    assert.ok(!Number.isNaN(Date.parse(p.from)) && !Number.isNaN(Date.parse(p.to)));
    // the inclusive last day 11-03 becomes "to" = the START of 11-04 (exclusive), exactly 3 days after "from"
    assert.equal(Date.parse(p.to) - Date.parse(p.from), 3 * 24 * 3600e3);
    assert.equal(out.scope, "L2");
    assert.equal(out.categories.length, 5);
  });

  it("a 2xx body that is not the documented report is a FAILURE (malformed), never an empty report", async () => {
    for (const data of [null, "ok", {}, { scope: "L3", categories: [], counts: {} }, { scope: "L2", categories: "x", counts: {} }, { ...report(), counts: null }, { ...report(), categories: [{ code: "X", items: "no" }] }]) {
      const api = createGatewayReconciliationApi({ get: async () => ({ data }) });
      await assert.rejects(api.getReport({ from: "2026-11-01", to: "2026-11-03" }), (e) => isMalformedGatewayReport(e));
    }
  });

  it("a transport error is rethrown untouched (the screen turns it into an 'unknown figures' message)", async () => {
    const boom = Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" });
    const api = createGatewayReconciliationApi({ get: async () => { throw boom; } });
    await assert.rejects(api.getReport({ from: "2026-11-01", to: "2026-11-03" }), (e) => e === boom && !isMalformedGatewayReport(e));
  });
});

// ──────────────────────────────────────────────────────────── normaliser ──
describe("B8 normaliser", () => {
  it("keeps money as the exact decimal string and never touches it", () => {
    const r = normalizeGatewayReport(report({ categories: [category("REPORTED_AMOUNT_MISMATCH", "danger", [item({ amount: "299999.84", reportedAmount: "300000.00" })])] }));
    assert.ok(r);
    const it0 = r.categories[0].items[0];
    assert.equal(it0.amount, "299999.84");
    assert.equal(it0.reportedAmount, "300000.00");
    // exact display: no rounding of the fraction
    assert.match(formatMoneyExact(it0.amount), /^299\.999,84\s?₫$/);
    assert.match(formatMoneyExact(it0.reportedAmount), /^300\.000\s?₫$/);
    assert.equal(formatMoneyExact(null), "—");
  });

  it("drops (and counts) items that point at nothing or lack required fields; an unknown severity becomes info", () => {
    const r = normalizeGatewayReport(
      report({
        categories: [
          category("WEBHOOK_ORPHAN", "bogus", [
            item({ transactionId: null, webhookEventId: EVT, amount: null }),
            item({ transactionId: null, webhookEventId: null }),
            item({ note: 5 }),
            "junk",
          ]),
        ],
      }),
    );
    assert.ok(r);
    assert.equal(r.categories[0].items.length, 1);
    assert.equal(r.categories[0].items[0].transactionId, null);
    assert.equal(r.categories[0].items[0].amount, null);
    assert.equal(r.ignored, 3);
    assert.equal(r.categories[0].severity, "info");
  });

  it("normalizeGatewayItem requires provider, createdAt and note", () => {
    assert.equal(normalizeGatewayItem(item({ provider: undefined })), null);
    assert.equal(normalizeGatewayItem(item({ createdAt: undefined })), null);
    assert.ok(normalizeGatewayItem(item()));
  });

  it("counts: missing/garbage numbers are 0, not NaN", () => {
    const r = normalizeGatewayReport(report({ counts: { webhookOrphan: "x", webhookUnprocessed: -1, reportedAmountMismatch: 3 } }));
    assert.ok(r);
    assert.equal(r.counts.webhookOrphan, 0);
    assert.equal(r.counts.webhookUnprocessed, 0);
    assert.equal(r.counts.reportedAmountMismatch, 3);
    assert.equal(r.counts.coveredByGatewayDiscrepancies, 0);
  });
});

// ──────────────────────────────────────────────────── labels / no raw enum ──
describe("B8 labels", () => {
  it("every known category has a Vietnamese title + rule and no raw enum in them", () => {
    for (const [code, t] of Object.entries(CATEGORY_TEXT)) {
      assert.ok(t.title.length > 5 && t.rule.length > 20, code);
      for (const text of [t.title, t.rule]) assert.doesNotMatch(text, /\b[A-Z]{3,}(_[A-Z]+)+\b/, `${code}: raw enum in "${text}"`);
    }
  });

  it("an unknown category uses the server label, else a neutral Vietnamese fallback — never the raw code", () => {
    assert.equal(categoryTitle({ code: "NEW_THING", label: "Nhóm mới" }), "Nhóm mới");
    assert.equal(categoryTitle({ code: "NEW_THING", label: "" }), "Nhóm đối chiếu khác");
    assert.equal(categoryTitle({ code: "WEBHOOK_ORPHAN", label: "ignored" }), CATEGORY_TEXT.WEBHOOK_ORPHAN.title);
  });

  it("provider and status are Vietnamese with a neutral fallback", () => {
    const i = normalizeGatewayItem(item({ provider: "ZALOPAY", transactionStatus: "PENDING" }))!;
    assert.equal(itemProviderText(i), "ZaloPay");
    assert.equal(itemStatusText(i), "Chờ thanh toán");
    const odd = normalizeGatewayItem(item({ provider: "NEWPAY", transactionStatus: "WEIRD" }))!;
    assert.equal(itemProviderText(odd), "Khác");
    assert.equal(itemStatusText(odd), "Chưa rõ");
    assert.equal(itemStatusText(normalizeGatewayItem(item({ transactionStatus: null }))!), "—");
  });

  it("the L2 banner says exactly what Ngài decided; the empty state text is the agreed one", () => {
    assert.equal(
      L2_BANNER_TEXT,
      "Dựa trên dữ liệu cổng gửi về và Gymini đã lưu; chưa phải đối soát độc lập với file quyết toán của cổng.",
    );
    assert.equal(EMPTY_TEXT, "Không phát hiện lệch trong khoảng thời gian này (mức L2)");
  });

  it("transactionLink points at the Giao dịch screen's drawer", () => {
    assert.equal(transactionLink(TXN), `/admin/finance/transactions?id=${TXN}`);
  });
});

// ─────────────────────────────────────────────────── display model / empty ──
describe("B8 display model", () => {
  it("clean report = every category empty and every count zero; any count > 0 (even with a capped/empty list) is not clean", () => {
    const clean = normalizeGatewayReport(report({ counts: { ...report().counts, reportedAmountMismatch: 0 }, categories: report().categories.map((c) => ({ ...c, items: [] })) }))!;
    assert.equal(isReportClean(clean), true);
    assert.equal(isReportClean(normalizeGatewayReport(report())!), false);
    const countOnly = normalizeGatewayReport(report({ categories: report().categories.map((c) => ({ ...c, items: [] })) }))!;
    assert.equal(isReportClean(countOnly), false, "the count says 1 even though the list is empty: not clean");
  });

  it("categoryTotal uses the server count (a 100-row list can stand for more), never less than what is listed", () => {
    const r = normalizeGatewayReport(
      report({
        counts: { ...report().counts, webhookOrphan: 250 },
        categories: [category("WEBHOOK_ORPHAN", "warning", Array.from({ length: 100 }, (_, n) => item({ webhookEventId: `e${n}`, transactionId: null })), true)],
      }),
    )!;
    assert.equal(categoryTotal(r.categories[0], r.counts), 250);
    assert.equal(r.categories[0].truncated, true);
    assert.equal(categoryTotal({ ...r.categories[0], code: "UNKNOWN" }, r.counts), 100);
  });

  it("cards are ordered by urgency (danger, warning, info) keeping the server order inside a level", () => {
    const r = normalizeGatewayReport(report())!;
    assert.deepEqual(orderedCategories(r).map((c) => c.code), [
      "WEBHOOK_UNPROCESSED",
      "GATEWAY_SUCCESS_NOT_PAID",
      "REPORTED_AMOUNT_MISMATCH",
      "WEBHOOK_ORPHAN",
      "PAID_WITHOUT_GATEWAY_EVENT",
    ]);
  });
});

// ───────────────────────────────────────────────────────── range + URL ──
describe("B8 day range in the URL", () => {
  const now = new Date(2026, 10, 10, 15, 30); // 10 Nov 2026 local

  it("default = the last 30 local days ending today; no params = not explicit", () => {
    assert.deepEqual(defaultRange(now), { from: "2026-10-12", to: "2026-11-10" });
    assert.equal(rangeDays(defaultRange(now)), 30);
    const r = parseRange(new URLSearchParams(""), now);
    assert.deepEqual({ from: r.from, to: r.to, explicit: r.explicit }, { from: "2026-10-12", to: "2026-11-10", explicit: false });
  });

  it("an explicit range is read; a hostile or half-given one falls back per side, never throws", () => {
    assert.deepEqual(parseRange(new URLSearchParams("from=2026-11-01&to=2026-11-05"), now), { from: "2026-11-01", to: "2026-11-05", explicit: true });
    assert.equal(parseRange(new URLSearchParams("from=nope&to=2026-13-40"), now).explicit, false);
    const onlyFrom = parseRange(new URLSearchParams("from=2026-11-01"), now);
    assert.deepEqual({ from: onlyFrom.from, to: onlyFrom.to }, { from: "2026-11-01", to: "2026-11-10" });
    const onlyTo = parseRange(new URLSearchParams("to=2026-11-05"), now);
    assert.equal(onlyTo.to, "2026-11-05");
    assert.equal(rangeDays(onlyTo), 30);
    assert.equal(parseDay("2026-02-30"), null);
    assert.equal(parseDay("2026-02-28"), "2026-02-28");
  });

  it("withRange keeps other params, omits the default and writes a custom range", () => {
    const prev = new URLSearchParams("view=gateway&x=1&from=2026-01-01&to=2026-01-02");
    const custom = withRange(prev, { from: "2026-11-01", to: "2026-11-05" }, now);
    assert.equal(custom.get("view"), "gateway");
    assert.equal(custom.get("x"), "1");
    assert.equal(custom.get("from"), "2026-11-01");
    assert.equal(custom.get("to"), "2026-11-05");
    const reset = withRange(prev, null, now);
    assert.equal(reset.get("from"), null);
    assert.equal(reset.get("view"), "gateway");
    assert.equal(withRange(prev, defaultRange(now), now).get("from"), null, "the default range is not written");
  });

  it("range problems: to before from, and more than 92 days — the request is not sent for those", () => {
    assert.equal(rangeProblem({ from: "2026-11-05", to: "2026-11-01" }), "ORDER");
    assert.equal(rangeProblem({ from: "2026-08-11", to: "2026-11-10" }), null); // exactly 92 days inclusive
    assert.equal(rangeDays({ from: "2026-08-11", to: "2026-11-10" }), MAX_RANGE_DAYS);
    assert.equal(rangeProblem({ from: "2026-08-10", to: "2026-11-10" }), "TOO_LONG");
    assert.equal(rangeProblem({ from: "2026-11-01", to: "2026-11-01" }), null);
  });

  it("toGatewayQuery: from inclusive, to exclusive (start of the next day)", () => {
    const q = toGatewayQuery({ from: "2026-11-01", to: "2026-11-01" });
    assert.equal(Date.parse(q.to) - Date.parse(q.from), 24 * 3600e3);
  });
});

// ───────────────────────────────────────────── chip registry + cache keys ──
describe("B8 chip + cache isolation", () => {
  it("the gateway chip exists as L2, is deep-linkable, and switching chips drops the day range", () => {
    assert.ok(RECON_VIEWS.includes("gateway"));
    assert.equal(RECON_VIEW_LEVEL.gateway, "L2");
    assert.equal(RECON_VIEW_LABEL.gateway, "Đối chiếu cổng ↔ Gymini");
    assert.equal(parseReconView("gateway"), "gateway");
    const next = switchReconView(new URLSearchParams("view=gateway&from=2026-11-01&to=2026-11-05"), "balance");
    assert.equal(next.get("view"), "balance");
    assert.equal(next.get("from"), null);
    assert.equal(next.get("to"), null);
  });

  it("the query key carries the signed-in user id under the Tài chính prefix; two users never share a key; no polling", () => {
    const a = gatewayReconKeys("admin-1").report({ from: "2026-11-01", to: "2026-11-05" });
    const b = gatewayReconKeys("admin-2").report({ from: "2026-11-01", to: "2026-11-05" });
    assert.deepEqual(a.slice(0, 3), ["admin", "finance", "gateway-reconciliation"]);
    assert.ok(a.includes("admin-1") && !a.includes("admin-2"));
    assert.notDeepEqual(a, b);
    assert.throws(() => gatewayReconKeys(""));
    assert.equal(GATEWAY_QUERY_OPTIONS.refetchInterval, false);
    assert.equal(GATEWAY_QUERY_OPTIONS.refetchOnWindowFocus, false);
    assert.equal(GATEWAY_QUERY_OPTIONS.retry, false);
  });
});

// ───────────────────────────────────────────────────────── source guards ──
describe("B8 source guards", () => {
  const strip = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
  const files = [
    "reconciliation/gateway/gatewayReconciliationModel.ts",
    "reconciliation/gateway/gatewayReconciliationApi.ts",
    "reconciliation/gateway/useGatewayReconciliation.ts",
    "reconciliation/gateway/GatewayReconciliationView.tsx",
  ];

  it("read only: no write verb, no mutation hook, no 'mark as reconciled' control", () => {
    for (const f of files) {
      const code = strip(read(f));
      assert.doesNotMatch(code, /\b(api|client|axios)\.(post|put|patch|delete|request)\(|useMutation|Idempotency-Key|Đánh dấu đã đối soát|Mark as reconciled/i, f);
    }
  });

  it("money: no Number() / parseFloat / sum / formatVND anywhere in the gateway files; the view uses formatMoneyExact", () => {
    for (const f of files) {
      const code = strip(read(f));
      assert.doesNotMatch(code, /\bNumber\(|parseFloat|formatVND|\.reduce\(|sumCents|addAmounts/, f);
    }
    assert.match(read("reconciliation/gateway/GatewayReconciliationView.tsx"), /formatMoneyExact/);
  });

  it("the view never renders a raw enum field: provider/status go through the label helpers, the payload is never requested", () => {
    const view = strip(read("reconciliation/gateway/GatewayReconciliationView.tsx"));
    assert.doesNotMatch(view, />\s*\{i\.(provider|transactionStatus)\}|\.payload/);
    assert.match(view, /itemProviderText/);
    assert.match(view, /TxnStatusPill/);
  });

  it("no polling: no refetchInterval value other than false", () => {
    const hook = strip(read("reconciliation/gateway/useGatewayReconciliation.ts"));
    assert.doesNotMatch(hook, /refetchInterval:(?!\s*false)/);
  });

  it("the panel renders the gateway view and the old disabled L3 chip is gone", () => {
    const panel = read("AdminReconciliationPanel.tsx");
    assert.match(panel, /GatewayReconciliationView/);
    assert.doesNotMatch(panel, /recon-chip-gateway-disabled|aria-disabled/);
  });
});
