/**
 * B7 — typed READ client of the finance transactions endpoints (payment-service, via the gateway):
 *   GET /admin/payments/transactions        (G-04)  list, exact-match search, filters, paging
 *   GET /admin/payments/transactions/:id    (G-05)  detail + money journey sources
 * Only the documented query params are ever sent, compacted (no empty / undefined values). There is NO write call here
 * and none may be added: this screen is read only (guarded by a source test).
 */
import { api } from "../../../../services/api";
import { PAGE_SIZE, type TransactionFilters } from "./transactionsUrlState";
import type { TxnDetailResponse, TxnListResponse, TxnSummary } from "./transactionsTypes";

/** The slice of axios this module needs — a fake in tests. Read only: `get` and nothing else. */
export interface TransactionsHttpClient {
  get(url: string, config?: { params?: Record<string, string | number> }): Promise<{ data: unknown }>;
}

export const TRANSACTIONS_PATH = "/admin/payments/transactions";

/** Query params the list endpoint documents (the server rejects anything else with 400 INVALID_QUERY). */
export interface ListTransactionsQuery {
  q?: string;
  status?: string;
  provider?: string;
  purpose?: string;
  from?: string;
  to?: string;
  limit?: number;
  offset?: number;
}

const DAY_MS = 24 * 60 * 60 * 1000;

/** Local midnight of a `YYYY-MM-DD` day as an ISO instant (the server reads `from` inclusive, `to` exclusive). */
function dayStartIso(day: string, plusDays = 0): string {
  const [y, m, d] = day.split("-").map(Number);
  const start = new Date(y, m - 1, d);
  return new Date(start.getTime() + plusDays * DAY_MS).toISOString();
}

/** UI filters (page 1-based, `to` inclusive) → documented query (offset, `to` exclusive). */
export function toListQuery(filters: TransactionFilters): ListTransactionsQuery {
  const query: ListTransactionsQuery = { limit: PAGE_SIZE, offset: (Math.max(1, filters.page) - 1) * PAGE_SIZE };
  if (filters.q) query.q = filters.q;
  if (filters.status) query.status = filters.status;
  if (filters.provider) query.provider = filters.provider;
  if (filters.purpose) query.purpose = filters.purpose;
  if (filters.from) query.from = dayStartIso(filters.from);
  if (filters.to) query.to = dayStartIso(filters.to, 1);
  return query;
}

const DOCUMENTED = ["q", "status", "provider", "purpose", "from", "to", "limit", "offset"] as const;

/** Drops everything that is not a documented param or has no value. */
export function compactListParams(query: ListTransactionsQuery): Record<string, string | number> {
  const out: Record<string, string | number> = {};
  for (const key of DOCUMENTED) {
    const v = query[key];
    if (v === undefined || v === null || v === "") continue;
    out[key] = v;
  }
  return out;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const arr = <T>(v: unknown): T[] => (Array.isArray(v) ? (v as T[]) : []);

/** A row that cannot be shown safely (no id / no readable amount) is not a transaction. */
export function isTxnSummary(v: unknown): v is TxnSummary {
  return isRecord(v) && typeof v.id === "string" && v.id !== "" && typeof v.amount === "string" && typeof v.createdAt === "string";
}

export interface NormalizedTxnList extends TxnListResponse {
  /** Rows of the response that were unreadable and therefore not shown. */
  ignored: number;
}

/** `null` = the body is not the documented list (the caller treats it as a load FAILURE, never as an empty list). */
export function normalizeTxnList(raw: unknown): NormalizedTxnList | null {
  if (!isRecord(raw) || !Array.isArray(raw.items) || typeof raw.total !== "number" || !Number.isFinite(raw.total)) return null;
  const items = raw.items.filter(isTxnSummary);
  return {
    total: raw.total,
    limit: typeof raw.limit === "number" ? raw.limit : PAGE_SIZE,
    offset: typeof raw.offset === "number" ? raw.offset : 0,
    hasMore: raw.hasMore === true,
    items,
    ignored: raw.items.length - items.length,
  };
}

/** `null` = not the documented detail. Missing arrays are empty (older servers); a missing `transaction` is a failure. */
export function normalizeTxnDetail(raw: unknown): TxnDetailResponse | null {
  if (!isRecord(raw) || !isTxnSummary(raw.transaction)) return null;
  return {
    transaction: raw.transaction,
    refundOf: isTxnSummary(raw.refundOf) ? raw.refundOf : null,
    refunds: arr<unknown>(raw.refunds).filter(isTxnSummary),
    ledgerEntries: arr(raw.ledgerEntries),
    ledgerOperations: arr(raw.ledgerOperations),
    commissions: arr(raw.commissions),
    obligations: arr(raw.obligations),
    holdbackReviews: arr(raw.holdbackReviews),
    webhookEvents: arr(raw.webhookEvents),
  };
}

/** Thrown when the server answered 2xx with a body that is not the documented shape (shown as a failure, never as "no data"). */
export const malformedResponse = () => Object.assign(new Error("MALFORMED_RESPONSE"), { malformed: true });
export const isMalformedResponse = (e: unknown) => (e as { malformed?: boolean } | null)?.malformed === true;

export function createTransactionsApi(client: TransactionsHttpClient) {
  return {
    /** G-04. */
    async listTransactions(query: ListTransactionsQuery): Promise<NormalizedTxnList> {
      const { data } = await client.get(TRANSACTIONS_PATH, { params: compactListParams(query) });
      const list = normalizeTxnList(data);
      if (!list) throw malformedResponse();
      return list;
    },
    /** G-05. */
    async getTransaction(id: string): Promise<TxnDetailResponse> {
      const { data } = await client.get(`${TRANSACTIONS_PATH}/${encodeURIComponent(id)}`);
      const detail = normalizeTxnDetail(data);
      if (!detail) throw malformedResponse();
      return detail;
    },
  };
}

export const transactionsApi = createTransactionsApi(api);
export const listTransactions = (query: ListTransactionsQuery) => transactionsApi.listTransactions(query);
export const getTransaction = (id: string) => transactionsApi.getTransaction(id);
