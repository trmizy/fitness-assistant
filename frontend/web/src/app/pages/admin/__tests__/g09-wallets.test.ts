/**
 * G-09 / G-10 — "Tài chính › Ví": API wire shape, kind / platform-wallet labels, URL state, query keys, links, read-only guard.
 * Evidence label: TEST FIXTURE (a fake HTTP client records calls; no request leaves the process; no backend, no dev/E2E stack).
 * Run: npx tsx --test src/app/pages/admin/__tests__/g09-wallets.test.ts (from frontend/web)
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  WALLETS_PATH,
  compactDetailParams,
  compactListParams,
  createWalletsApi,
  normalizeWalletDetail,
  normalizeWalletList,
  toDetailQuery,
  toListQuery,
  type WalletsHttpClient,
} from "../finance/wallets/walletsApi";
import {
  ENTRY_KIND_LABELS,
  PLATFORM_WALLET_LABEL,
  WALLET_ENTRY_KINDS,
  WALLET_OWNER_TYPES,
  entryKindLabel,
  platformWalletLabel,
  walletOwnerTitle,
  walletStatusLabel,
} from "../finance/wallets/walletLabels";
import {
  EMPTY_FILTERS,
  ENTRIES_PAGE_SIZE,
  MAX_ENTRIES_PAGE,
  MAX_OWNER_ID_LENGTH,
  MAX_PAGE,
  PAGE_SIZE,
  buildWalletsParams,
  pageCount,
  parseWalletsParams,
  transactionLink,
  walletLink,
} from "../finance/wallets/walletsUrlState";
import { WALLET_QUERY_OPTIONS, walletKeys } from "../finance/wallets/useWalletsData";
import { isMalformedResponse } from "../finance/transactions/transactionsApi";
import { formatMoneyExact } from "../adminFinanceOverview.utils";

const dir = dirname(fileURLToPath(import.meta.url));
const WALLET_ID = "0b0e6a64-2f5a-4c5e-9d1e-1234567890ab";
const TX_ID = "99999999-aaaa-bbbb-cccc-000000000000";

const wallet = (over: Record<string, unknown> = {}) => ({
  id: WALLET_ID,
  ownerType: "CLIENT",
  ownerId: "11111111-aaaa-bbbb-cccc-222222222222",
  availableBalance: "299999.80",
  pendingBalance: "0.10",
  lockedBalance: "5.50",
  holdbackBalance: "7.25",
  status: "ACTIVE",
  createdAt: "2026-11-01T10:00:00.000Z",
  updatedAt: "2026-11-02T10:00:00.000Z",
  ...over,
});
const entry = (over: Record<string, unknown> = {}) => ({
  id: "e1",
  transactionId: TX_ID,
  entryType: "DEBIT",
  bucket: "AVAILABLE",
  amount: "299999.80",
  balanceBefore: "299999.84",
  balanceAfter: "0.04",
  kind: "PT_CONTRACT",
  createdAt: "2026-11-01T10:00:07.000Z",
  ...over,
});

interface Call { url: string; params?: Record<string, unknown> }
function fakeClient(answer: unknown) {
  const calls: Call[] = [];
  const client: WalletsHttpClient = {
    async get(url, config) {
      calls.push({ url, params: config?.params });
      return { data: answer };
    },
  };
  return { calls, api: createWalletsApi(client) };
}

// ──────────────────────────────────────────────────────────────── API wire ──
describe("G-09 API client — wire shape", () => {
  it("list: GET /admin/payments/wallets with ONLY documented params, compacted (no empty values)", async () => {
    const { calls, api } = fakeClient({ total: 1, limit: 25, offset: 0, hasMore: false, items: [wallet()] });
    const res = await api.listWallets({ ownerType: "PT", ownerId: "", limit: 25, offset: 0 });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, "/admin/payments/wallets");
    assert.equal(WALLETS_PATH, "/admin/payments/wallets");
    assert.deepEqual(calls[0].params, { ownerType: "PT", limit: 25, offset: 0 });
    assert.equal(res.items.length, 1);
    assert.equal(res.total, 1);
    assert.equal(res.ignored, 0);
  });

  it("an undocumented param can never reach the wire (the server is .strict() → 400)", () => {
    const sneaky = { ownerId: "x", q: "no", page: 3, userId: "u" } as unknown as Parameters<typeof compactListParams>[0];
    assert.deepEqual(Object.keys(compactListParams(sneaky)), ["ownerId"]);
    const sneakyDetail = { entriesLimit: 50, limit: 10, from: "2026-01-01" } as unknown as Parameters<typeof compactDetailParams>[0];
    assert.deepEqual(Object.keys(compactDetailParams(sneakyDetail)), ["entriesLimit"]);
  });

  it("filters → documented query: page 3 = offset 50; empty filters are omitted; platform owner id passes through exactly", () => {
    assert.deepEqual(toListQuery({ ...EMPTY_FILTERS, page: 3 }), { limit: 25, offset: 50 });
    assert.deepEqual(toListQuery({ ownerType: "PLATFORM", ownerId: "ESCROW", page: 1 }), { limit: 25, offset: 0, ownerType: "PLATFORM", ownerId: "ESCROW" });
    assert.deepEqual(toListQuery({ ownerType: null, ownerId: "", page: 0 }), { limit: 25, offset: 0 });
    assert.deepEqual(toDetailQuery(1), { entriesLimit: 50, entriesOffset: 0 });
    assert.deepEqual(toDetailQuery(4), { entriesLimit: 50, entriesOffset: 150 });
  });

  it("detail: GET /admin/payments/wallets/:id with the entries paging params; the id is URL-encoded", async () => {
    const { calls, api } = fakeClient({ wallet: wallet(), entries: { total: 1, limit: 50, offset: 0, hasMore: false, items: [entry()] } });
    const res = await api.getWallet(WALLET_ID, toDetailQuery(2));
    assert.equal(calls[0].url, `/admin/payments/wallets/${WALLET_ID}`);
    assert.deepEqual(calls[0].params, { entriesLimit: 50, entriesOffset: 50 });
    assert.equal(res.wallet.id, WALLET_ID);
    assert.equal(res.entries.items.length, 1);
    assert.equal(res.ignoredEntries, 0);

    const odd = fakeClient({ wallet: wallet(), entries: { total: 0, limit: 50, offset: 0, hasMore: false, items: [] } });
    await odd.api.getWallet("a/b?c");
    assert.equal(odd.calls[0].url, "/admin/payments/wallets/a%2Fb%3Fc");
  });

  it("money stays a string exactly as the server sent it (trailing zero kept)", async () => {
    const { api } = fakeClient({ wallet: wallet(), entries: { total: 1, limit: 50, offset: 0, hasMore: false, items: [entry()] } });
    const res = await api.getWallet(WALLET_ID);
    assert.equal(res.wallet.availableBalance, "299999.80");
    assert.equal(res.entries.items[0].amount, "299999.80");
    assert.equal(res.entries.items[0].balanceAfter, "0.04");
    assert.match(formatMoneyExact(res.wallet.availableBalance), /^299\.999,80\s₫$/u);
  });

  it("unreadable rows are dropped and counted, readable ones are kept", () => {
    const list = normalizeWalletList({ total: 3, items: [wallet(), { id: "" }, wallet({ id: "w2", availableBalance: 5 })] });
    assert.ok(list);
    assert.equal(list!.items.length, 1);
    assert.equal(list!.ignored, 2);
    const detail = normalizeWalletDetail({ wallet: wallet(), entries: { total: 2, items: [entry(), { id: "x" }] } });
    assert.ok(detail);
    assert.equal(detail!.entries.items.length, 1);
    assert.equal(detail!.ignoredEntries, 1);
  });

  it("a body that is not the documented shape is a FAILURE (malformed), never an empty list / empty ledger", async () => {
    for (const bad of [null, "x", [], {}, { items: [] }, { total: "3", items: [] }, { total: 1 }]) {
      assert.equal(normalizeWalletList(bad), null, JSON.stringify(bad));
      const { api } = fakeClient(bad);
      await assert.rejects(() => api.listWallets({}), (e) => isMalformedResponse(e));
    }
    for (const bad of [null, {}, { wallet: wallet() }, { wallet: wallet(), entries: {} }, { wallet: wallet(), entries: { total: 0 } }, { wallet: { id: "w" }, entries: { total: 0, items: [] } }]) {
      assert.equal(normalizeWalletDetail(bad), null, JSON.stringify(bad));
      const { api } = fakeClient(bad);
      await assert.rejects(() => api.getWallet(WALLET_ID), (e) => isMalformedResponse(e));
    }
  });

  it("a network error propagates (the screen shows a failure + retry, not an empty list)", async () => {
    const client: WalletsHttpClient = { async get() { throw Object.assign(new Error("Network Error"), { code: "ERR_NETWORK" }); } };
    await assert.rejects(() => createWalletsApi(client).listWallets({}), /Network Error/);
  });
});

// ───────────────────────────────────────────────── kind / platform labels ──
describe("G-10 kind labels and platform wallet names", () => {
  const RAW = /^[A-Z][A-Z0-9]*(_[A-Z0-9]+)+$|^[A-Z]{4,}$/;

  it("every documented kind has a Vietnamese label that is not the enum", () => {
    for (const k of WALLET_ENTRY_KINDS) {
      const label = entryKindLabel(k);
      assert.ok(label.length > 0 && !RAW.test(label), `${k} → ${label}`);
    }
    assert.equal(entryKindLabel("REFUND"), "Hoàn tiền");
    assert.equal(entryKindLabel("WALLET_TOPUP"), "Nạp ví");
    assert.equal(entryKindLabel("WITHDRAWAL"), "Rút tiền");
    assert.equal(entryKindLabel("PT_CONTRACT"), "Hợp đồng PT");
    assert.equal(entryKindLabel("OTHER"), "Khác");
  });

  it("an unknown / missing kind falls back to a neutral word, never the raw value", () => {
    for (const v of ["BRAND_NEW_KIND", "", null, undefined, "toString", "__proto__"]) assert.equal(entryKindLabel(v as string), "Khác");
    assert.equal(walletStatusLabel("MYSTERY"), "Chưa rõ");
    assert.equal(walletStatusLabel("FROZEN"), "Bị đóng băng");
    assert.equal(Object.keys(ENTRY_KIND_LABELS).length, WALLET_ENTRY_KINDS.length);
  });

  it("platform wallets are named by what they are for; ESCROW / REVENUE are never printed as titles", () => {
    assert.equal(PLATFORM_WALLET_LABEL.ESCROW, "Ví giữ hộ (tiền chưa chi cho đối tác)");
    assert.equal(PLATFORM_WALLET_LABEL.REVENUE, "Ví doanh thu nền tảng");
    assert.equal(walletOwnerTitle("PLATFORM", "ESCROW"), "Ví giữ hộ (tiền chưa chi cho đối tác)");
    assert.equal(walletOwnerTitle("PLATFORM", "REVENUE"), "Ví doanh thu nền tảng");
    assert.equal(walletOwnerTitle("PLATFORM", "SOMETHING"), "Ví nội bộ");
    assert.equal(platformWalletLabel("constructor"), "Ví nội bộ");
    assert.equal(walletOwnerTitle("CLIENT", "u1"), "Khách hàng");
    assert.equal(walletOwnerTitle("PT", "u1"), "Huấn luyện viên");
    assert.equal(walletOwnerTitle("GYM", "u1"), "Phòng gym");
    for (const t of WALLET_OWNER_TYPES) assert.ok(!RAW.test(walletOwnerTitle(t, "ESCROW")), t);
  });

  it("the transaction drawer reuses the shared platform label (single source) instead of its own copy", () => {
    const drawer = readFileSync(join(dir, "..", "finance", "transactions", "TransactionDrawer.tsx"), "utf8");
    assert.ok(!/const PLATFORM_WALLET_LABEL/.test(drawer), "the local copy must be gone");
    assert.match(drawer, /platformWalletLabel\(/);
    assert.match(drawer, /from "\.\.\/wallets\/walletLabels"/);
  });
});

// ──────────────────────────────────────────────────────────────── URL state ──
describe("G-09 URL state", () => {
  it("round-trips ownerType, ownerId, page, id and the entries page", () => {
    const sp = buildWalletsParams({ filters: { ownerType: "PLATFORM", ownerId: "ESCROW", page: 3 }, id: WALLET_ID, entriesPage: 2 });
    assert.equal(sp.toString(), `ownerType=PLATFORM&ownerId=ESCROW&page=3&id=${WALLET_ID}&ep=2`);
    const back = parseWalletsParams(sp);
    assert.deepEqual(back, { filters: { ownerType: "PLATFORM", ownerId: "ESCROW", page: 3 }, id: WALLET_ID, entriesPage: 2 });
  });

  it("defaults are omitted from the URL", () => {
    assert.equal(buildWalletsParams({}).toString(), "");
    assert.equal(buildWalletsParams({ filters: { page: 1, ownerId: "   " } }).toString(), "");
    assert.equal(buildWalletsParams({ id: WALLET_ID, entriesPage: 1 }).toString(), `id=${WALLET_ID}`);
  });

  it("the entries page is dropped when no drawer is open", () => {
    assert.equal(buildWalletsParams({ entriesPage: 4 }).toString(), "");
    assert.equal(parseWalletsParams(new URLSearchParams("ep=4")).entriesPage, 1);
  });

  it("stale / hostile values fall back to 'not set' instead of throwing", () => {
    const p = parseWalletsParams(new URLSearchParams("ownerType=ADMIN&ownerId=&page=-3&id=not-a-uuid&ep=x"));
    assert.deepEqual(p, { filters: { ownerType: null, ownerId: "", page: 1 }, id: null, entriesPage: 1 });
    assert.equal(parseWalletsParams(new URLSearchParams("ownerType=pt")).filters.ownerType, null, "case-sensitive enum");
    assert.equal(parseWalletsParams(new URLSearchParams("page=99999999")).filters.page, MAX_PAGE);
    assert.equal(parseWalletsParams(new URLSearchParams(`id=${WALLET_ID}&ep=99999999`)).entriesPage, MAX_ENTRIES_PAGE);
    assert.equal(parseWalletsParams(new URLSearchParams(`page=1.5`)).filters.page, 1);
    assert.equal(parseWalletsParams(new URLSearchParams(`id=${encodeURIComponent("ESCROW")}`)).id, null, "a platform owner id is not a wallet id");
  });

  it("ownerId is trimmed and capped at the server limit (128)", () => {
    const long = "x".repeat(300);
    assert.equal(parseWalletsParams(new URLSearchParams(`ownerId=${long}`)).filters.ownerId.length, MAX_OWNER_ID_LENGTH);
    assert.equal(parseWalletsParams(new URLSearchParams("ownerId=%20%20abc%20")).filters.ownerId, "abc");
  });

  it("page sizes and page count match the server limits", () => {
    assert.equal(PAGE_SIZE, 25);
    assert.equal(ENTRIES_PAGE_SIZE, 50);
    assert.equal(pageCount(0), 1);
    assert.equal(pageCount(26), 2);
    assert.equal(pageCount(101, ENTRIES_PAGE_SIZE), 3);
    assert.equal(MAX_PAGE, 4001);
    assert.equal(MAX_ENTRIES_PAGE, 2001);
  });

  it("links: wallet ← transaction drawer, transaction ← wallet drawer", () => {
    assert.equal(walletLink(WALLET_ID), `/admin/finance/wallets?id=${WALLET_ID}`);
    assert.equal(transactionLink(TX_ID), `/admin/finance/transactions?id=${TX_ID}`);
    assert.equal(parseWalletsParams(new URLSearchParams(walletLink(WALLET_ID).split("?")[1])).id, WALLET_ID);
  });
});

// ───────────────────────────────────────────────── account isolation + no poll ──
describe("G-09 query keys and options", () => {
  it("every key starts with ['admin','finance-wallets', userId] and carries the query", () => {
    const k = walletKeys("user-1");
    assert.deepEqual([...k.list({ limit: 25, offset: 0 })].slice(0, 3), ["admin", "finance-wallets", "user-1"]);
    assert.deepEqual([...k.detail(WALLET_ID, { entriesLimit: 50, entriesOffset: 0 })].slice(0, 5), ["admin", "finance-wallets", "user-1", "detail", WALLET_ID]);
    assert.notDeepEqual(walletKeys("user-1").list({ offset: 0 }), walletKeys("user-2").list({ offset: 0 }));
    assert.notDeepEqual(k.detail(WALLET_ID, { entriesOffset: 0 }), k.detail(WALLET_ID, { entriesOffset: 50 }));
  });
  it("a key without an owner cannot exist", () => {
    assert.throws(() => walletKeys(""));
  });
  it("no polling, no refetch on focus/reconnect, no retry", () => {
    assert.equal(WALLET_QUERY_OPTIONS.refetchInterval, false);
    assert.equal(WALLET_QUERY_OPTIONS.refetchOnWindowFocus, false);
    assert.equal(WALLET_QUERY_OPTIONS.refetchOnReconnect, false);
    assert.equal(WALLET_QUERY_OPTIONS.retry, false);
  });
});

// ─────────────────────────────────────────────────────────── source guards ──
function sources(): [string, string][] {
  const folder = join(dir, "..", "finance", "wallets");
  return readdirSync(folder)
    .filter((f) => /\.(ts|tsx)$/.test(f))
    .map((f) => [f, readFileSync(join(folder, f), "utf8")] as [string, string]);
}

describe("G-09 source guard — the screen is read only", () => {
  it("has no write call: no post/put/patch/delete request, no useMutation", () => {
    const files = sources();
    assert.ok(files.length >= 9, "expected the module files");
    for (const [name, src] of files) {
      assert.ok(!/\.(post|put|patch|delete|request)\s*\(/.test(src), `${name}: write-capable call`);
      assert.ok(!/useMutation|mutateAsync|method:\s*["'](POST|PUT|PATCH|DELETE)/i.test(src), `${name}: mutation`);
    }
  });

  it("the API module's HTTP client type only exposes `get`, and calls it exactly twice (list + detail)", () => {
    const api = readFileSync(join(dir, "..", "finance", "wallets", "walletsApi.ts"), "utf8");
    const start = api.indexOf("export interface WalletsHttpClient");
    const iface = api.slice(start, api.indexOf("}", start) + 1);
    assert.match(iface, /get\(/);
    assert.ok(!/post|put|patch|delete|request/.test(iface));
    assert.equal((api.match(/client\.get\(/g) ?? []).length, 2);
  });

  it("never asks for or prints the raw ledger note / sensitive fields; money is formatted only via formatMoneyExact", () => {
    for (const [name, src] of sources()) {
      if (name === "walletsTypes.ts" || name === "walletsApi.ts" || name === "walletLabels.ts") {
        assert.ok(!/(?<![\w/ ])(description|extraData|idempotencyKey|requestFingerprint)\s*[:?]/.test(src), `${name}: sensitive field declared`);
        continue;
      }
      assert.ok(!/\.description\b|extraData|idempotencyKey|requestFingerprint|\.payload\b|\.result\b/.test(src), `${name}: sensitive field referenced`);
      assert.ok(!/Math\.(round|floor|ceil)\(/.test(src) || name === "walletsUrlState.ts", `${name} rounds`);
      assert.ok(!/parseFloat\(|\.toFixed\(/.test(src), `${name} formats numbers by hand`);
    }
  });

  it("no setInterval / refetchInterval polling in the module", () => {
    for (const [name, src] of sources()) {
      assert.ok(!/setInterval\(/.test(src), `${name}: setInterval`);
      assert.ok(!/refetchInterval:\s*[^f\s]/.test(src), `${name}: refetchInterval`);
    }
  });

  it("the drawer uses the shared dialog a11y hook, shows the 4 balances and links each entry to its transaction", () => {
    const drawer = readFileSync(join(dir, "..", "finance", "wallets", "WalletDrawer.tsx"), "utf8");
    assert.match(drawer, /useModalA11y\(/);
    assert.match(drawer, /role="dialog"/);
    assert.match(drawer, /aria-modal="true"/);
    assert.match(drawer, /aria-labelledby=\{titleId\}/);
    for (const f of ["availableBalance", "pendingBalance", "lockedBalance", "holdbackBalance"]) assert.ok(drawer.includes(`wallet.${f}`), f);
    assert.match(drawer, /transactionLink\(e\.transactionId\)/);
    assert.match(drawer, /entryKindLabel\(e\.kind\)/);
  });

  it("the transaction drawer's ledger wallet cell links to /admin/finance/wallets?id=<walletId>", () => {
    const drawer = readFileSync(join(dir, "..", "finance", "transactions", "TransactionDrawer.tsx"), "utf8");
    assert.match(drawer, /walletLink\(e\.walletId\)/);
  });

  it("the route is registered under the finance children and the nav + header know it", () => {
    const routes = readFileSync(join(dir, "..", "..", "..", "routes.tsx"), "utf8");
    assert.match(routes, /path: "wallets", Component: AdminWallets/);
    const nav = readFileSync(join(dir, "..", "..", "..", "components", "layout", "admin", "adminNav.ts"), "utf8");
    assert.match(nav, /id: "finance-wallets", label: "Ví"/);
    const header = readFileSync(join(dir, "..", "reconciliation", "financeHeader.ts"), "utf8");
    assert.match(header, /wallets: "Ví"/);
    assert.match(header, /wallets: \[\["admin", "finance-wallets"\]\]/);
  });
});
