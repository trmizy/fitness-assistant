/**
 * G-09 — URL state of "Tài chính › Ví": `?ownerType&ownerId&page&id&ep`.
 *   ownerType + ownerId = the exact-match search; page = list page; id = open drawer (wallet id); ep = entries page of the drawer.
 * Pure (no React) so it runs under `tsx --test`. Every parser is total: a stale / typo'd / hostile value falls back to
 * "not set" instead of throwing. Defaults are omitted from the URL.
 */
import { WALLET_OWNER_TYPES } from "./walletLabels";

export const PAGE_SIZE = 25;
export const ENTRIES_PAGE_SIZE = 50;
/** The server accepts offset ≤ 100000 → the last reachable page. */
export const MAX_PAGE = Math.floor(100000 / PAGE_SIZE) + 1;
export const MAX_ENTRIES_PAGE = Math.floor(100000 / ENTRIES_PAGE_SIZE) + 1;
export const MAX_OWNER_ID_LENGTH = 128;

export interface WalletFilters {
  /** null = every owner type. */
  ownerType: string | null;
  /** Exact owner id ("" = none). Platform wallets: "ESCROW" / "REVENUE". */
  ownerId: string;
  /** 1-based. */
  page: number;
}

export interface WalletsUrlState {
  filters: WalletFilters;
  /** Wallet id of the open drawer, or null. */
  id: string | null;
  /** 1-based page of the drawer's entries. */
  entriesPage: number;
}

export const EMPTY_FILTERS: WalletFilters = { ownerType: null, ownerId: "", page: 1 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function parsePositive(raw: string | null | undefined, max: number): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, max);
}
export const parsePage = (raw: string | null | undefined) => parsePositive(raw, MAX_PAGE);
export const parseEntriesPage = (raw: string | null | undefined) => parsePositive(raw, MAX_ENTRIES_PAGE);

export function parseOwnerId(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, MAX_OWNER_ID_LENGTH).trim();
}

export function parseOwnerType(raw: string | null | undefined): string | null {
  return raw !== null && raw !== undefined && (WALLET_OWNER_TYPES as readonly string[]).includes(raw) ? raw : null;
}

export function parseWalletsParams(sp: URLSearchParams): WalletsUrlState {
  const idRaw = (sp.get("id") ?? "").trim();
  const id = isUuid(idRaw) ? idRaw : null;
  return {
    filters: { ownerType: parseOwnerType(sp.get("ownerType")), ownerId: parseOwnerId(sp.get("ownerId")), page: parsePage(sp.get("page")) },
    id,
    // The entries page only means something while a drawer is open.
    entriesPage: id ? parseEntriesPage(sp.get("ep")) : 1,
  };
}

/** Query string for the URL: defaults (page 1, empty filters, entries page 1) are omitted. */
export function buildWalletsParams(state: { filters?: Partial<WalletFilters>; id?: string | null; entriesPage?: number }): URLSearchParams {
  const f = { ...EMPTY_FILTERS, ...(state.filters ?? {}) };
  const out = new URLSearchParams();
  if (f.ownerType) out.set("ownerType", f.ownerType);
  const ownerId = parseOwnerId(f.ownerId);
  if (ownerId) out.set("ownerId", ownerId);
  if (f.page > 1) out.set("page", String(Math.min(f.page, MAX_PAGE)));
  if (state.id) {
    out.set("id", state.id);
    const ep = state.entriesPage ?? 1;
    if (ep > 1) out.set("ep", String(Math.min(ep, MAX_ENTRIES_PAGE)));
  }
  return out;
}

export function hasActiveFilters(f: WalletFilters): boolean {
  return !!(f.ownerType || f.ownerId);
}

/** Total pages for display; at least 1 (an empty result is "page 1 of 1" — the empty state says the rest). */
export function pageCount(total: number, size: number = PAGE_SIZE): number {
  return Math.max(1, Math.ceil(total / size));
}

/** Where "open this wallet" links go (e.g. from the transaction drawer's ledger table). */
export const walletLink = (walletId: string) => `/admin/finance/wallets?id=${encodeURIComponent(walletId)}`;
/** Where "open this transaction" links go (from the wallet drawer's entries table). */
export const transactionLink = (transactionId: string) => `/admin/finance/transactions?id=${encodeURIComponent(transactionId)}`;
