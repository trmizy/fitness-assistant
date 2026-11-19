/**
 * B7 — "Tài chính › Giao dịch": API wire shape, money journey model, exact money, no raw enums, URL state, query keys, read-only guard.
 * Evidence label: TEST FIXTURE (a fake HTTP client records calls; no request leaves the process; no backend, no dev/E2E stack).
 * Run: npx tsx --test src/app/pages/admin/__tests__/b7-transactions.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  TRANSACTIONS_PATH,
  compactListParams,
  createTransactionsApi,
  isMalformedResponse,
  normalizeTxnDetail,
  normalizeTxnList,
  toListQuery,
  type TransactionsHttpClient,
} from "../finance/transactions/transactionsApi";
import { buildMoneyJourney, shortId } from "../finance/transactions/moneyJourney";
import * as labels from "../finance/transactions/transactionsLabels";
import { PAYMENT_PROVIDERS, PAYMENT_PURPOSES, PAYMENT_STATUSES, type TxnDetailResponse, type TxnSummary } from "../finance/transactions/transactionsTypes";
import {
  EMPTY_FILTERS,
  MAX_PAGE,
  PAGE_SIZE,
  buildTransactionsParams,
  pageCount,
  parseTransactionsParams,
} from "../finance/transactions/transactionsUrlState";
import { txnKeys, TXN_QUERY_OPTIONS } from "../finance/transactions/useTransactionsData";
import { formatMoneyExact } from "../adminFinanceOverview.utils";

const dir = dirname(fileURLToPath(import.meta.url));
const UUID = "0b0e6a64-2f5a-4c5e-9d1e-1234567890ab";

// ─────────────────────────────────────────────────────────────── fixtures ──
const tx = (over: Partial<TxnSummary> = {}): TxnSummary => ({
  id: UUID,
  purpose: "PT_CONTRACT",
  status: "PAID",
  provider: "VNPAY",
  amount: "299999.84",
  currency: "VND",
  payerId: "11111111-aaaa-bbbb-cccc-222222222222",
  gymId: null,
  ptId: "33333333-aaaa-bbbb-cccc-444444444444",
  ptContractId: "55555555-aaaa-bbbb-cccc-666666666666",
  membershipId: null,
  providerTransactionId: "VNP-777",
  paymentMethod: null,
  activationStatus: "ACTIVATED",
  refundOfTransactionId: null,
  createdAt: "2026-11-01T10:00:00.000Z",
  paidAt: "2026-11-01T10:00:06.000Z",
  failedAt: null,
  refundedAt: null,
  ...over,
});

const detailFixture = (): TxnDetailResponse => ({
  transaction: tx({ refundedAt: "2026-11-02T08:00:05.000Z" }),
  refundOf: null,
  refunds: [tx({ id: "99999999-aaaa-bbbb-cccc-000000000000", purpose: "REFUND", status: "PAID", amount: "100000.00", createdAt: "2026-11-02T08:00:00.000Z", refundOfTransactionId: UUID })],
  // Deliberately NOT in time order: the journey must sort them.
  ledgerEntries: [
    { id: "le2", walletId: "w2", walletOwnerType: "PLATFORM", walletOwnerId: "pl-1", entryType: "CREDIT", bucket: "AVAILABLE", amount: "30000.00", balanceBefore: "0.00", balanceAfter: "30000.00", description: "raw english desc", createdAt: "2026-11-01T10:00:08.000Z" },
    { id: "le1", walletId: "w1", walletOwnerType: "CLIENT", walletOwnerId: "cl-1", entryType: "DEBIT", bucket: "HOLDBACK", amount: "299999.84", balanceBefore: "300000.00", balanceAfter: "0.16", description: null, createdAt: "2026-11-01T10:00:07.000Z" },
  ],
  ledgerOperations: [{ id: "op1", key: "SESSION_RELEASE:abc", kind: "RELEASE_SESSION", createdAt: "2026-11-01T10:00:07.000Z" }],
  commissions: [{ id: "cm1", partnerType: "PT", partnerId: "p1", grossAmount: "299999.84", platformFeeAmount: "29999.98", partnerPayoutAmount: "269999.86", commissionRate: "0.1000", status: "SETTLED", settledAt: "2026-11-03T00:00:00.000Z", createdAt: "2026-11-01T10:00:09.000Z" }],
  obligations: [{ id: "ob1", status: "OPEN", kind: "NO_SHOW", party: "CLIENT", contractRef: null, owed: "50000.00", paid: "0.00", unpaid: "50000.00", verifiedPaid: "0.00", createdAt: "2026-11-01T12:00:00.000Z", resolvedAt: null }],
  holdbackReviews: [{ id: "hb1", status: "OPEN", kind: "OPEN_OBLIGATION", reserve: "20000.00", verifiedAmount: null, releasedToPt: null, reviewBy: "2026-12-01T00:00:00.000Z", createdAt: "2026-11-01T12:00:01.000Z", decidedAt: null }],
  webhookEvents: [
    { id: "wh1", provider: "VNPAY", providerEventId: "evt-1", processedAt: "2026-11-01T10:00:05.000Z", retryCount: 2, createdAt: "2026-11-01T10:00:04.000Z" },
    { id: "wh2", provider: "VNPAY", providerEventId: "evt-2", processedAt: null, retryCount: 0, createdAt: "2026-11-01T10:00:30.000Z" },
  ],
});

interface Call { url: string; params?: Record<string, unknown> }
function fakeClient(answer: unknown) {
  const calls: Call[] = [];
  const client: TransactionsHttpClient = {
    async get(url, config) {
      calls.push({ url, params: config?.params });
      return { data: answer };
    },
  };
  return { calls, api: createTransactionsApi(client) };
}

const DOCUMENTED = ["q", "status", "provider", "purpose", "from", "to", "limit", "offset"];

// ──────────────────────────────────────────────────────────────── API wire ──
describe("B7 API client — wire shape", () => {
  it("list: GET /admin/payments/transactions with ONLY documented params, compacted", async () => {
    const { calls, api } = fakeClient({ total: 1, limit: 25, offset: 0, hasMore: false, items: [tx()] });
    const res = await api.listTransactions({ q: UUID, status: "PAID", provider: "", purpose: undefined, limit: 25, offset: 0 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/admin/payments/transactions");
    assert.equal(TRANSACTIONS_PATH, "/admin/payments/transactions");
    assert.deepEqual(calls[0].params, { q: UUID, status: "PAID", limit: 25, offset: 0 });
    assert.equal(res.items.length, 1);
    assert.equal(res.total, 1);
  });

  it("an undocumented param can never reach the wire (the server is .strict() → 400)", () => {
    const sneaky = { q: "x", extraData: "no", metadata: "no", page: 3, userId: "u" } as unknown as Parameters<typeof compactListParams>[0];
    const out = compactListParams(sneaky);
    assert.deepEqual(Object.keys(out), ["q"]);
    for (const k of Object.keys(out)) assert.ok(DOCUMENTED.includes(k));
  });

  it("filters → query: page is 1-based (offset = (page-1)*25), limit 25, `to` is EXCLUSIVE (next local midnight)", () => {
    const q = toListQuery({ ...EMPTY_FILTERS, page: 3, status: "FAILED", provider: "ZALOPAY", purpose: "WALLET_TOPUP", q: "abc", from: "2026-11-05", to: "2026-11-05" });
    assert.equal(q.limit, 25);
    assert.equal(q.offset, 50);
    assert.equal(q.status, "FAILED");
    assert.equal(q.provider, "ZALOPAY");
    assert.equal(q.purpose, "WALLET_TOPUP");
    assert.equal(q.q, "abc");
    // Same inclusive day on both ends → a 24 h window [from, to). The server needs from < to.
    assert.ok(Date.parse(q.from!) < Date.parse(q.to!));
    assert.equal(Date.parse(q.to!) - Date.parse(q.from!), 24 * 60 * 60 * 1000);
    // Empty filters send only paging.
    assert.deepEqual(compactListParams(toListQuery(EMPTY_FILTERS)), { limit: 25, offset: 0 });
    assert.equal(PAGE_SIZE, 25);
  });

  it("detail: GET /admin/payments/transactions/:id and no params", async () => {
    const { calls, api } = fakeClient(detailFixture());
    const d = await api.getTransaction(UUID);
    assert.equal(calls[0].url, `/admin/payments/transactions/${UUID}`);
    assert.equal(calls[0].params, undefined);
    assert.equal(d.transaction.id, UUID);
    assert.equal(d.webhookEvents.length, 2);
  });

  it("a 2xx body that is not the documented shape is a FAILURE (never an empty list / zero)", async () => {
    for (const bad of [null, "ok", {}, { items: "x", total: 1 }, { items: [], total: "0" }]) {
      await assert.rejects(fakeClient(bad).api.listTransactions({}), (e) => isMalformedResponse(e));
    }
    await assert.rejects(fakeClient({ refunds: [] }).api.getTransaction(UUID), (e) => isMalformedResponse(e));
    assert.equal(normalizeTxnList({ items: [], total: 0 })?.items.length, 0);
  });

  it("unreadable rows are dropped and counted, readable ones are kept", () => {
    const list = normalizeTxnList({ total: 3, items: [tx(), { id: "x" }, null] });
    assert.equal(list?.items.length, 1);
    assert.equal(list?.ignored, 2);
  });

  it("detail: missing arrays become empty; missing transaction is a failure", () => {
    const d = normalizeTxnDetail({ transaction: tx() });
    assert.deepEqual([d?.refunds, d?.ledgerEntries, d?.webhookEvents, d?.refundOf], [[], [], [], null]);
    assert.equal(normalizeTxnDetail({ transaction: { id: "x" } }), null);
  });

  it("an HTTP error from the client propagates (not swallowed into an empty result)", async () => {
    const client: TransactionsHttpClient = { async get() { throw Object.assign(new Error("boom"), { response: { status: 500 } }); } };
    await assert.rejects(createTransactionsApi(client).listTransactions({}));
  });
});

// ─────────────────────────────────────────────────────── money journey model ──
describe("B7 buildMoneyJourney", () => {
  const events = buildMoneyJourney(detailFixture());

  it("is one chronological list (non-decreasing time) that merges every source", () => {
    const times = events.map((e) => Date.parse(e.at));
    assert.deepEqual(times, [...times].sort((a, b) => a - b));
    const kinds = new Set(events.map((e) => e.kind));
    for (const k of ["created", "webhook", "paid", "ledger-operation", "ledger-entry", "commission", "commission-settled", "obligation", "holdback", "refund", "refunded"]) {
      assert.ok(kinds.has(k as never), `missing ${k}`);
    }
  });

  it("orders cause before effect: created → webhook → paid → ledger operation → ledger entries (by time) → ... → refund → refunded", () => {
    const seq = events.map((e) => e.key);
    const idx = (k: string) => seq.indexOf(k);
    assert.equal(seq[0], `created:${UUID}`);
    assert.ok(idx("webhook:wh1") < idx(`paid:${UUID}`));
    assert.ok(idx(`paid:${UUID}`) < idx("ledger-operation:op1"));
    assert.ok(idx("ledger-operation:op1") < idx("ledger-entry:le1"), "same instant: operation before its entries");
    assert.ok(idx("ledger-entry:le1") < idx("ledger-entry:le2"), "entries sorted by time, not by response order");
    assert.ok(idx("ledger-entry:le2") < idx("commission:cm1"));
    assert.ok(idx("obligation:ob1") < idx("holdback:hb1"));
    assert.ok(idx("holdback:hb1") < idx("refund:99999999-aaaa-bbbb-cccc-000000000000"));
    assert.equal(seq[seq.length - 1], "commission-settled:cm1");
    assert.ok(idx(`refunded:${UUID}`) < idx("commission-settled:cm1"), "settled commission is dated 03/11, after the 02/11 refund");
  });

  it("titles are Vietnamese and say what happened", () => {
    const title = (key: string) => events.find((e) => e.key === key)?.title;
    assert.equal(title(`created:${UUID}`), "Tạo giao dịch: Hợp đồng PT");
    assert.equal(title("webhook:wh1"), "Cổng VNPay gọi về");
    assert.equal(title("ledger-operation:op1"), "Giải phóng tiền một buổi tập");
    assert.equal(title("ledger-entry:le1"), "Trừ ví Khách hàng · Tạm giữ của PT");
    assert.equal(title("ledger-entry:le2"), "Cộng ví Nền tảng · Khả dụng");
    assert.equal(title("obligation:ob1"), "Ghi nhận nghĩa vụ chưa trả: PT vắng mặt — chưa đền đủ");
    assert.equal(title("holdback:hb1"), "Giữ lại tiền của PT: Còn nghĩa vụ chưa trả");
  });

  it("webhook steps carry only time / provider / processed / retry", () => {
    const w1 = events.find((e) => e.key === "webhook:wh1")!;
    const w2 = events.find((e) => e.key === "webhook:wh2")!;
    assert.equal(w1.detail, "Đã xử lý. Cổng đã gửi lại 2 lần.");
    assert.equal(w1.at, "2026-11-01T10:00:05.000Z");
    assert.equal(w2.detail, "Chưa xử lý.");
    assert.equal(w2.at, "2026-11-01T10:00:30.000Z", "unprocessed → placed at its arrival time");
    assert.equal(w2.amount, null);
  });

  it("refund steps point at the refund / the original transaction so the drawer can open it", () => {
    assert.equal(events.find((e) => e.kind === "refund")?.linkTransactionId, "99999999-aaaa-bbbb-cccc-000000000000");
    const asRefund = detailFixture();
    asRefund.refundOf = tx({ id: "88888888-aaaa-bbbb-cccc-000000000000" });
    asRefund.refunds = [];
    assert.equal(buildMoneyJourney(asRefund).find((e) => e.kind === "refund-of")?.linkTransactionId, "88888888-aaaa-bbbb-cccc-000000000000");
  });

  it("amounts stay exact decimal strings (never a number, never rounded)", () => {
    assert.equal(events.find((e) => e.key === `created:${UUID}`)?.amount, "299999.84");
    assert.equal(events.find((e) => e.key === "ledger-entry:le1")?.amount, "299999.84");
    assert.equal(events.find((e) => e.key === "commission:cm1")?.amount, "29999.98");
    for (const e of events) assert.ok(e.amount === null || typeof e.amount === "string");
  });

  it("an event without a readable time is left out; an empty detail still yields the creation step", () => {
    const d = detailFixture();
    d.ledgerEntries[0].createdAt = "not-a-date";
    assert.ok(!buildMoneyJourney(d).some((e) => e.key === "ledger-entry:le2"));
    const bare = buildMoneyJourney({ ...detailFixture(), refunds: [], ledgerEntries: [], ledgerOperations: [], commissions: [], obligations: [], holdbackReviews: [], webhookEvents: [], transaction: tx({ paidAt: null }) });
    assert.deepEqual(bare.map((e) => e.kind), ["created"]);
  });

  it("is a pure function: same input → same output, input not mutated", () => {
    const d = detailFixture();
    const before = JSON.stringify(d);
    assert.deepEqual(buildMoneyJourney(d), buildMoneyJourney(d));
    assert.equal(JSON.stringify(d), before);
  });
});

// ───────────────────────────────────────────────────────────────────── money ──
describe("B7 money is shown exactly", () => {
  it('"299999.84" → "299.999,84 ₫" (no rounding), whole amounts have no decimals', () => {
    assert.match(formatMoneyExact("299999.84"), /^299\.999,84\s₫$/u);
    assert.match(formatMoneyExact("300000.00"), /^300\.000\s₫$/u);
  });
  it('missing / unreadable money is "—", never "0 ₫"', () => {
    for (const v of [null, undefined, "", "abc", "12,5"]) {
      assert.equal(formatMoneyExact(v), "—");
      assert.ok(!/^0\s?₫/.test(formatMoneyExact(v)));
    }
  });
  it("the screen formats money only through formatMoneyExact (no Number()/toFixed/Math.round on amounts)", () => {
    for (const [name, src] of sources()) {
      if (name.endsWith("transactionsUrlState.ts")) continue; // page arithmetic only (no money there)
      assert.ok(!/Math\.(round|floor|ceil)\(/.test(src), `${name} rounds`);
      assert.ok(!/parseFloat\(|\.toFixed\(/.test(src), `${name} formats numbers by hand`);
    }
    const drawer = readFileSync(join(dir, "..", "finance", "transactions", "TransactionDrawer.tsx"), "utf8");
    assert.ok(drawer.includes("formatMoneyExact(detail.transaction.amount)"));
  });
});

// ───────────────────────────────────────────────────────────── no raw enums ──
describe("B7 labels never print a raw enum", () => {
  const RAW = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[A-Z]{4,}$/;
  it("every known value has a Vietnamese label that is not the enum", () => {
    const groups: [readonly string[], (v: string) => string][] = [
      [PAYMENT_STATUSES, labels.statusLabel],
      [PAYMENT_PROVIDERS, labels.providerLabel],
      [PAYMENT_PURPOSES, labels.purposeLabel],
      [["NOT_APPLICABLE", "PENDING", "ACTIVATED", "ACTIVATION_FAILED"], labels.activationLabel],
      [["CLIENT", "PT", "GYM", "PLATFORM"], labels.ownerLabel],
      [["DEBIT", "CREDIT"], labels.entryTypeLabel],
      [["PENDING", "AVAILABLE", "LOCKED", "HOLDBACK"], labels.bucketLabel],
      [["RELEASE_SESSION", "NO_SHOW", "LATE_ARRIVAL", "TERMINATE", "RESOLVE_UNRESOLVED"], labels.ledgerOperationLabel],
      [["PENDING", "SETTLED", "CANCELLED"], labels.commissionStatusLabel],
      [["NO_SHOW", "LATE_ARRIVAL", "REFUND_SHORT", "OVER_RELEASED", "APPEAL_AWARD"], labels.obligationKindLabel],
      [["OPEN", "UNDER_REVIEW", "PAID_VERIFIED", "PAID_VIA_LEDGER", "WAIVED"], labels.obligationStatusLabel],
      [["OPEN_OBLIGATION", "UNSECURED_DISPUTE", "UNCOMPUTABLE"], labels.holdbackKindLabel],
      [["OPEN", "SETTLED_VERIFIED", "SETTLED_PARTIAL", "NOT_VERIFIED", "RELEASED_AUTO"], labels.holdbackStatusLabel],
    ];
    for (const [values, fn] of groups) {
      for (const v of values) {
        const text = fn(v);
        assert.ok(text.length > 0 && text !== v && !RAW.test(text), `${fn.name}(${v}) = ${text}`);
      }
    }
  });

  it("an unknown / missing / prototype-key value gets the neutral fallback, not the raw value", () => {
    for (const v of ["SOMETHING_NEW", "", null, undefined, "constructor", "__proto__", "toString"]) {
      assert.equal(labels.providerLabel(v), "Khác");
      assert.equal(labels.purposeLabel(v), "Khác");
      assert.equal(labels.entryTypeLabel(v), "Khác");
      assert.equal(labels.bucketLabel(v), "Khác");
      assert.equal(labels.statusLabel(v), "Chưa rõ");
      assert.equal(labels.statusTone(v), "neutral");
    }
  });

  it("journey titles/details of an unknown-enum transaction contain no raw enum token", () => {
    const d = detailFixture();
    d.transaction = tx({ purpose: "BRAND_NEW_PURPOSE", provider: "NEW_PROVIDER", status: "WEIRD_STATUS" });
    d.ledgerEntries[0].walletOwnerType = "NEW_OWNER";
    d.ledgerEntries[0].bucket = "NEW_BUCKET";
    d.ledgerOperations[0].kind = "NEW_KIND";
    d.obligations[0].kind = "NEW_OB";
    d.obligations[0].status = "NEW_ST";
    d.holdbackReviews[0].kind = "NEW_HB";
    d.holdbackReviews[0].status = "NEW_HS";
    d.webhookEvents[0].provider = "NEW_PROVIDER";
    for (const e of buildMoneyJourney(d)) {
      const text = `${e.title} ${e.detail ?? ""}`;
      assert.ok(!/\b[A-Z][A-Z0-9]*_[A-Z0-9_]+\b/.test(text), `raw enum in: ${text}`);
    }
  });

  it("the journey never prints a ledger description (free text, may be raw) or an idempotency key", () => {
    const text = JSON.stringify(buildMoneyJourney(detailFixture()));
    assert.ok(!text.includes("raw english desc"));
    assert.ok(!text.includes("SESSION_RELEASE:abc"));
    assert.ok(!text.includes("evt-1"), "providerEventId is not shown");
  });

  it("ids are shown as 8 characters (short id), never the whole uuid", () => {
    assert.equal(shortId(UUID), "0b0e6a64");
    assert.equal(shortId("abc"), "abc");
    assert.equal(shortId(null), "—");
  });
});

// ──────────────────────────────────────────────────────────────── URL state ──
describe("B7 URL state", () => {
  const parse = (qs: string) => parseTransactionsParams(new URLSearchParams(qs));

  it("parses q, status, provider, purpose, from, to, page and id", () => {
    const s = parse(`?q=%20abc%20&status=PAID&provider=VNPAY&purpose=PT_CONTRACT&from=2026-11-01&to=2026-11-30&page=3&id=${UUID}`);
    assert.deepEqual(s.filters, { q: "abc", status: "PAID", provider: "VNPAY", purpose: "PT_CONTRACT", from: "2026-11-01", to: "2026-11-30", page: 3 });
    assert.equal(s.id, UUID);
  });

  it("is total: hostile / stale values fall back to 'not set' instead of throwing", () => {
    const s = parse("?status=NOPE&provider=vnpay&purpose=%27%3B--&from=2026-13-40&to=yesterday&page=-4&id=../../etc");
    assert.deepEqual(s.filters, EMPTY_FILTERS);
    assert.equal(s.id, null);
    assert.equal(parse("?page=abc").filters.page, 1);
    assert.equal(parse("?page=1.5").filters.page, 1);
    assert.equal(parse("?page=99999999").filters.page, MAX_PAGE);
    assert.equal(parse("?from=2026-02-30").filters.from, null, "30/02 is not a day");
    assert.equal(parse(`?q=${"x".repeat(300)}`).filters.q.length, 100);
  });

  it("a range that ends before it starts drops the end (the server would answer 400)", () => {
    const s = parse("?from=2026-11-10&to=2026-11-01");
    assert.equal(s.filters.from, "2026-11-10");
    assert.equal(s.filters.to, null);
  });

  it("builds the URL with defaults omitted and round-trips", () => {
    assert.equal(buildTransactionsParams({}).toString(), "");
    assert.equal(buildTransactionsParams({ filters: { page: 1 } }).toString(), "");
    const state = { filters: { ...EMPTY_FILTERS, q: "abc", status: "FAILED", provider: "PAYOS", purpose: "REFUND", from: "2026-11-01", to: "2026-11-02", page: 2 }, id: UUID };
    const qs = buildTransactionsParams(state);
    assert.deepEqual(parseTransactionsParams(qs), state);
    assert.deepEqual([...qs.keys()].sort(), ["from", "id", "page", "provider", "purpose", "q", "status", "to"]);
  });

  it("page count is at least 1 and uses 25 per page", () => {
    assert.equal(pageCount(0), 1);
    assert.equal(pageCount(25), 1);
    assert.equal(pageCount(26), 2);
    assert.equal(pageCount(101), 5);
    assert.equal(MAX_PAGE, 4001);
  });
});

// ───────────────────────────────────────────────── account isolation + no poll ──
describe("B7 query keys and options", () => {
  it("every key starts with ['admin','finance-transactions', userId] and carries the query", () => {
    const k = txnKeys("user-1");
    assert.deepEqual([...k.list({ limit: 25, offset: 0 })].slice(0, 3), ["admin", "finance-transactions", "user-1"]);
    assert.deepEqual([...k.detail(UUID)], ["admin", "finance-transactions", "user-1", "detail", UUID]);
    assert.notDeepEqual(txnKeys("user-1").list({ offset: 0 }), txnKeys("user-2").list({ offset: 0 }));
    assert.notDeepEqual(k.list({ offset: 0 }), k.list({ offset: 25 }));
  });
  it("a key without an owner cannot exist", () => {
    assert.throws(() => txnKeys(""));
  });
  it("no polling, no refetch on focus/reconnect, no retry", () => {
    assert.equal(TXN_QUERY_OPTIONS.refetchInterval, false);
    assert.equal(TXN_QUERY_OPTIONS.refetchOnWindowFocus, false);
    assert.equal(TXN_QUERY_OPTIONS.refetchOnReconnect, false);
    assert.equal(TXN_QUERY_OPTIONS.retry, false);
  });
});

// ─────────────────────────────────────────────────────────── source guards ──
function sources(): [string, string][] {
  const root = join(dir, "..");
  const folder = join(root, "finance", "transactions");
  const files = readdirSync(folder).filter((f) => /\.(ts|tsx)$/.test(f)).map((f) => join(folder, f));
  files.push(join(root, "AdminTransactions.tsx"));
  return files.map((f) => [f.replace(/\\/g, "/").split("/").slice(-2).join("/"), readFileSync(f, "utf8")]);
}

describe("B7 source guard — the screen is read only", () => {
  it("has no write call: no post/put/patch/delete request, no useMutation", () => {
    const files = sources();
    assert.ok(files.length >= 8, "expected the module files");
    for (const [name, src] of files) {
      assert.ok(!/\.(post|put|patch|delete|request)\s*\(/.test(src), `${name}: write-capable call`);
      assert.ok(!/useMutation|mutateAsync|method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(src), `${name}: mutation`);
    }
  });

  it("the API module's HTTP client type only exposes `get`", () => {
    const api = readFileSync(join(dir, "..", "finance", "transactions", "transactionsApi.ts"), "utf8");
    const iface = api.slice(api.indexOf("export interface TransactionsHttpClient"), api.indexOf("}", api.indexOf("export interface TransactionsHttpClient")) + 1);
    assert.match(iface, /get\(/);
    assert.ok(!/post|put|patch|delete|request/.test(iface));
    assert.equal((api.match(/client\.get\(/g) ?? []).length, 2, "exactly the list and the detail read");
  });

  it("never asks for or prints sensitive fields", () => {
    for (const [name, src] of sources()) {
      if (name === "transactions/transactionsApi.ts" || name === "transactions/transactionsTypes.ts") {
        // The types/api may only mention them in comments that say they are NEVER present.
        assert.ok(!/(?<![\w/ ])(extraData|idempotencyKey|requestFingerprint|redirectUrl)\s*[:?]/.test(src), `${name}: sensitive field declared`);
        continue;
      }
      assert.ok(!/extraData|idempotencyKey|requestFingerprint|redirectUrl|\.payload\b|\.result\b/.test(src), `${name}: sensitive field referenced`);
    }
  });

  it("no setInterval / refetchInterval polling in the module", () => {
    for (const [name, src] of sources()) {
      assert.ok(!/setInterval\(/.test(src), `${name}: setInterval`);
      assert.ok(!/refetchInterval:\s*[^f\s]/.test(src), `${name}: refetchInterval`);
    }
  });

  it("the drawer uses the shared dialog a11y hook (Esc, focus trap, focus return)", () => {
    const drawer = readFileSync(join(dir, "..", "finance", "transactions", "TransactionDrawer.tsx"), "utf8");
    assert.match(drawer, /useModalA11y\(/);
    assert.match(drawer, /role="dialog"/);
    assert.match(drawer, /aria-modal="true"/);
    assert.match(drawer, /aria-labelledby=\{titleId\}/);
  });

  it("the route is registered under the finance children and the nav links to it", () => {
    const routes = readFileSync(join(dir, "..", "..", "..", "routes.tsx"), "utf8");
    assert.match(routes, /path: "transactions", Component: AdminTransactions/);
    const nav = readFileSync(join(dir, "..", "..", "..", "components", "layout", "admin", "adminNav.ts"), "utf8");
    assert.match(nav, /id: "finance-transactions", label: "Giao dịch"/);
  });
});
