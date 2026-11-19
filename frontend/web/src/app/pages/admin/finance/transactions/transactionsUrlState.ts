/**
 * B7 — URL state of "Tài chính › Giao dịch": `?q&status&provider&purpose&from&to&page&id` (Master Plan §2.3).
 * Pure (no React) so it runs under `tsx --test`. Every parser is total: a stale / typo'd / hostile value falls back to
 * "not set" instead of throwing, so an old link opens the list, never a blank page. Defaults are omitted from the URL.
 */
import { PAYMENT_PROVIDERS, PAYMENT_PURPOSES, PAYMENT_STATUSES } from "./transactionsTypes";

export const PAGE_SIZE = 25;
/** The server accepts offset ≤ 100000 → the last reachable page. */
export const MAX_PAGE = Math.floor(100000 / PAGE_SIZE) + 1;
export const MAX_Q_LENGTH = 100;

export interface TransactionFilters {
  /** Exact-match search (id, mã cổng, người trả, hợp đồng, hội viên, phòng gym, PT). "" = none. */
  q: string;
  status: string | null;
  provider: string | null;
  purpose: string | null;
  /** `YYYY-MM-DD`, inclusive (local day). */
  from: string | null;
  /** `YYYY-MM-DD`, inclusive (local day). */
  to: string | null;
  /** 1-based. */
  page: number;
}

export interface TransactionsUrlState {
  filters: TransactionFilters;
  /** Transaction id of the open drawer, or null. */
  id: string | null;
}

export const EMPTY_FILTERS: TransactionFilters = { q: "", status: null, provider: null, purpose: null, from: null, to: null, page: 1 };

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const DAY_RE = /^\d{4}-\d{2}-\d{2}$/;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID_RE.test(v);

function oneOf<T extends string>(list: readonly T[], raw: string | null): T | null {
  return raw !== null && (list as readonly string[]).includes(raw) ? (raw as T) : null;
}

/** `YYYY-MM-DD` that is a real calendar day, else null. */
export function parseDay(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!DAY_RE.test(v)) return null;
  const [y, m, d] = v.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  return date.getFullYear() === y && date.getMonth() === m - 1 && date.getDate() === d ? v : null;
}

export function parsePage(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, MAX_PAGE);
}

export function parseQ(raw: string | null | undefined): string {
  return (raw ?? "").trim().slice(0, MAX_Q_LENGTH).trim();
}

export function parseTransactionsParams(sp: URLSearchParams): TransactionsUrlState {
  const from = parseDay(sp.get("from"));
  let to = parseDay(sp.get("to"));
  // A range that ends before it starts is meaningless (the server would answer 400): ignore the end.
  if (from && to && to < from) to = null;
  const idRaw = (sp.get("id") ?? "").trim();
  return {
    filters: {
      q: parseQ(sp.get("q")),
      status: oneOf(PAYMENT_STATUSES, sp.get("status")),
      provider: oneOf(PAYMENT_PROVIDERS, sp.get("provider")),
      purpose: oneOf(PAYMENT_PURPOSES, sp.get("purpose")),
      from,
      to,
      page: parsePage(sp.get("page")),
    },
    id: isUuid(idRaw) ? idRaw : null,
  };
}

/** Query string for the URL: defaults (page 1, empty filters) are omitted. */
export function buildTransactionsParams(state: { filters?: Partial<TransactionFilters>; id?: string | null }): URLSearchParams {
  const f = { ...EMPTY_FILTERS, ...(state.filters ?? {}) };
  const out = new URLSearchParams();
  const q = parseQ(f.q);
  if (q) out.set("q", q);
  if (f.status) out.set("status", f.status);
  if (f.provider) out.set("provider", f.provider);
  if (f.purpose) out.set("purpose", f.purpose);
  if (f.from) out.set("from", f.from);
  if (f.to) out.set("to", f.to);
  if (f.page > 1) out.set("page", String(Math.min(f.page, MAX_PAGE)));
  if (state.id) out.set("id", state.id);
  return out;
}

export function hasActiveFilters(f: TransactionFilters): boolean {
  return !!(f.q || f.status || f.provider || f.purpose || f.from || f.to);
}

/** Total pages for display; at least 1 (an empty result is "page 1 of 1" — the empty state says the rest). */
export function pageCount(total: number): number {
  return Math.max(1, Math.ceil(total / PAGE_SIZE));
}
