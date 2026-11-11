/**
 * G-09 / G-10 — typed READ client of the wallet explorer (payment-service, via the gateway):
 *   GET /admin/payments/wallets        wallet list (ownerType, exact ownerId, paging)
 *   GET /admin/payments/wallets/:id    one wallet + a page of its ledger entries
 * Only the documented query params are ever sent, compacted. There is NO write call here and none may be added: this
 * screen is read only (guarded by a source test).
 */
import { api } from "../../../../services/api";
import { malformedResponse } from "../transactions/transactionsApi";
import { ENTRIES_PAGE_SIZE, PAGE_SIZE, type WalletFilters } from "./walletsUrlState";
import type { WalletDetailResponse, WalletDto, WalletEntriesPage, WalletEntryDto, WalletListResponse } from "./walletsTypes";

/** The slice of axios this module needs — a fake in tests. Read only: `get` and nothing else. */
export interface WalletsHttpClient {
  get(url: string, config?: { params?: Record<string, string | number> }): Promise<{ data: unknown }>;
}

export const WALLETS_PATH = "/admin/payments/wallets";

export interface ListWalletsQuery {
  ownerType?: string;
  ownerId?: string;
  limit?: number;
  offset?: number;
}

export interface WalletDetailQuery {
  entriesLimit?: number;
  entriesOffset?: number;
}

/** UI filters (page 1-based) → documented query (offset). */
export function toListQuery(filters: WalletFilters): ListWalletsQuery {
  const query: ListWalletsQuery = { limit: PAGE_SIZE, offset: (Math.max(1, filters.page) - 1) * PAGE_SIZE };
  if (filters.ownerType) query.ownerType = filters.ownerType;
  if (filters.ownerId) query.ownerId = filters.ownerId;
  return query;
}

/** Drawer entries page (1-based) → documented detail query. */
export function toDetailQuery(entriesPage: number): WalletDetailQuery {
  return { entriesLimit: ENTRIES_PAGE_SIZE, entriesOffset: (Math.max(1, entriesPage) - 1) * ENTRIES_PAGE_SIZE };
}

function compact(query: object, documented: readonly string[]): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  const source = query as Record<string, unknown>;
  for (const key of documented) {
    const v = source[key];
    if (typeof v === "number" || (typeof v === "string" && v !== "")) out[key] = v;
  }
  return out;
}

/** Drops everything that is not a documented param or has no value. */
export const compactListParams = (query: ListWalletsQuery) => compact(query, ["ownerType", "ownerId", "limit", "offset"]);
export const compactDetailParams = (query: WalletDetailQuery) => compact(query, ["entriesLimit", "entriesOffset"]);

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const isStr = (v: unknown): v is string => typeof v === "string";

/** A row that cannot be shown safely (no id / unreadable balance) is not a wallet. */
export function isWalletDto(v: unknown): v is WalletDto {
  return (
    isRecord(v) &&
    isStr(v.id) && v.id !== "" &&
    isStr(v.ownerType) && isStr(v.ownerId) &&
    isStr(v.availableBalance) && isStr(v.pendingBalance) && isStr(v.lockedBalance) && isStr(v.holdbackBalance) &&
    isStr(v.createdAt)
  );
}

export function isWalletEntryDto(v: unknown): v is WalletEntryDto {
  return isRecord(v) && isStr(v.id) && v.id !== "" && isStr(v.transactionId) && isStr(v.amount) && isStr(v.balanceBefore) && isStr(v.balanceAfter) && isStr(v.createdAt);
}

const num = (v: unknown, fallback: number) => (typeof v === "number" && Number.isFinite(v) ? v : fallback);

export interface NormalizedWalletList extends WalletListResponse {
  /** Rows of the response that were unreadable and therefore not shown. */
  ignored: number;
}

/** `null` = the body is not the documented list (the caller treats it as a load FAILURE, never as an empty list). */
export function normalizeWalletList(raw: unknown): NormalizedWalletList | null {
  if (!isRecord(raw) || !Array.isArray(raw.items) || typeof raw.total !== "number" || !Number.isFinite(raw.total)) return null;
  const items = raw.items.filter(isWalletDto);
  return { total: raw.total, limit: num(raw.limit, PAGE_SIZE), offset: num(raw.offset, 0), hasMore: raw.hasMore === true, items, ignored: raw.items.length - items.length };
}

export interface NormalizedWalletDetail extends WalletDetailResponse {
  /** Entry rows of the response that were unreadable and therefore not shown. */
  ignoredEntries: number;
}

/** `null` = not the documented detail (a missing wallet or a missing entries page is a failure, never "no entries"). */
export function normalizeWalletDetail(raw: unknown): NormalizedWalletDetail | null {
  if (!isRecord(raw) || !isWalletDto(raw.wallet) || !isRecord(raw.entries) || !Array.isArray(raw.entries.items) || typeof raw.entries.total !== "number") return null;
  const e = raw.entries;
  const rawItems = e.items as unknown[];
  const items = rawItems.filter(isWalletEntryDto);
  const entries: WalletEntriesPage = {
    total: e.total as number,
    limit: num(e.limit, ENTRIES_PAGE_SIZE),
    offset: num(e.offset, 0),
    hasMore: e.hasMore === true,
    items,
  };
  return { wallet: raw.wallet, entries, ignoredEntries: rawItems.length - items.length };
}

export function createWalletsApi(client: WalletsHttpClient) {
  return {
    /** G-09 list. */
    async listWallets(query: ListWalletsQuery): Promise<NormalizedWalletList> {
      const { data } = await client.get(WALLETS_PATH, { params: compactListParams(query) });
      const list = normalizeWalletList(data);
      if (!list) throw malformedResponse();
      return list;
    },
    /** G-09 detail + G-10 entry kinds. */
    async getWallet(id: string, query: WalletDetailQuery = {}): Promise<NormalizedWalletDetail> {
      const { data } = await client.get(`${WALLETS_PATH}/${encodeURIComponent(id)}`, { params: compactDetailParams(query) });
      const detail = normalizeWalletDetail(data);
      if (!detail) throw malformedResponse();
      return detail;
    },
  };
}

export const walletsApi = createWalletsApi(api);
export const listWallets = (query: ListWalletsQuery) => walletsApi.listWallets(query);
export const getWallet = (id: string, query?: WalletDetailQuery) => walletsApi.getWallet(id, query);
