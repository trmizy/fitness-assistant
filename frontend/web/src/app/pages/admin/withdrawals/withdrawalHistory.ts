/**
 * G-08 — withdrawal HISTORY ("Đã chuyển" / "Từ chối"): typed READ client of
 *   GET /admin/payments/withdrawal-history?status=PAID|REJECTED&limit&offset   (payment-service, via the gateway)
 * plus the pure mapping of one response row to what the table shows. No React, no I/O of its own: runs under `tsx --test`.
 *
 * The endpoint never carries `payoutInfo` (bank account details); this screen never asks for it. There is NO write call
 * here and none may be added: history is read only.
 */
import { api } from "../../../services/api";
import { formatMoneyExact } from "../adminFinanceOverview.utils";
import { adminLabel, shortId } from "./withdrawalQueue";

export const WITHDRAWAL_HISTORY_PATH = "/admin/payments/withdrawal-history";
export const HISTORY_PAGE_SIZE = 25;
/** The server accepts offset ≤ 100000 → the last reachable page. */
export const HISTORY_MAX_PAGE = Math.floor(100000 / HISTORY_PAGE_SIZE) + 1;

export type HistoryStatus = "PAID" | "REJECTED";
export const HISTORY_STATUSES: readonly HistoryStatus[] = ["PAID", "REJECTED"];
export type WithdrawalTab = "PENDING" | "APPROVED" | HistoryStatus;

export const TAB_LABEL: Record<WithdrawalTab, string> = {
  PENDING: "Chờ duyệt",
  APPROVED: "Đã duyệt – chờ chuyển khoản",
  PAID: "Đã chuyển",
  REJECTED: "Từ chối",
};

/** `?status=` → the history tab, or null when it is one of the queue chips (or junk). */
export function parseHistoryTab(raw: string | null | undefined): HistoryStatus | null {
  const v = (raw ?? "").trim().toUpperCase();
  return v === "PAID" || v === "REJECTED" ? v : null;
}

/** `?page=` → 1-based page, total: junk → 1. */
export function parseHistoryPage(raw: string | null | undefined): number {
  const n = Number(raw);
  if (!Number.isInteger(n) || n < 1) return 1;
  return Math.min(n, HISTORY_MAX_PAGE);
}

export function historyPageCount(total: number): number {
  return Math.max(1, Math.ceil(total / HISTORY_PAGE_SIZE));
}

/** Response row exactly as the endpoint documents it (amounts are decimal strings). */
export interface WithdrawalHistoryItem {
  id: string;
  walletId: string;
  ownerType: string;
  ownerId: string;
  amount: string;
  status: HistoryStatus;
  bankReference: string | null;
  rejectionReason: string | null;
  approvedBy: string | null;
  reviewedAt: string | null;
  paidAt: string | null;
  createdAt: string;
  walletAvailableNow: string | null;
}

export interface WithdrawalHistoryPage {
  total: number;
  limit: number;
  offset: number;
  hasMore: boolean;
  items: WithdrawalHistoryItem[];
  /** Rows of the response that were unreadable and therefore not shown. */
  ignored: number;
}

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === "object" && !Array.isArray(v);
const strOrNull = (v: unknown): string | null => (typeof v === "string" && v !== "" ? v : null);

function toItem(v: unknown, status: HistoryStatus): WithdrawalHistoryItem | null {
  if (!isRecord(v) || typeof v.id !== "string" || v.id === "" || typeof v.amount !== "string") return null;
  if (v.status !== status) return null;
  return {
    id: v.id,
    walletId: typeof v.walletId === "string" ? v.walletId : "",
    ownerType: typeof v.ownerType === "string" ? v.ownerType : "",
    ownerId: typeof v.ownerId === "string" ? v.ownerId : "",
    amount: v.amount,
    status,
    bankReference: strOrNull(v.bankReference),
    rejectionReason: strOrNull(v.rejectionReason),
    approvedBy: strOrNull(v.approvedBy),
    reviewedAt: strOrNull(v.reviewedAt),
    paidAt: strOrNull(v.paidAt),
    createdAt: typeof v.createdAt === "string" ? v.createdAt : "",
    walletAvailableNow: typeof v.walletAvailableNow === "string" ? v.walletAvailableNow : null,
  };
}

/** `null` = the body is not the documented list (the caller treats it as a load FAILURE, never as an empty list). */
export function normalizeHistory(raw: unknown, status: HistoryStatus): WithdrawalHistoryPage | null {
  if (!isRecord(raw) || !Array.isArray(raw.items) || typeof raw.total !== "number" || !Number.isFinite(raw.total)) return null;
  const items: WithdrawalHistoryItem[] = [];
  for (const it of raw.items) {
    const row = toItem(it, status);
    if (row) items.push(row);
  }
  return {
    total: raw.total,
    limit: typeof raw.limit === "number" ? raw.limit : HISTORY_PAGE_SIZE,
    offset: typeof raw.offset === "number" ? raw.offset : 0,
    hasMore: raw.hasMore === true,
    items,
    ignored: raw.items.length - items.length,
  };
}

export interface HistoryQuery {
  status: HistoryStatus;
  limit: number;
  offset: number;
}

/** Tab + 1-based page → the documented query (nothing else is ever sent). */
export function toHistoryQuery(status: HistoryStatus, page: number): HistoryQuery {
  return { status, limit: HISTORY_PAGE_SIZE, offset: (Math.max(1, page) - 1) * HISTORY_PAGE_SIZE };
}

/** The slice of axios this module needs — a fake in tests. Read only: `get` and nothing else. */
export interface WithdrawalHistoryHttpClient {
  get(url: string, config?: { params?: Record<string, string | number> }): Promise<{ data: unknown }>;
}

/** Thrown when the server answered 2xx with a body that is not the documented shape (shown as a failure, never as "no data"). */
export const malformedHistory = () => Object.assign(new Error("MALFORMED_RESPONSE"), { malformed: true });

export function createWithdrawalHistoryApi(client: WithdrawalHistoryHttpClient) {
  return {
    async listHistory(query: HistoryQuery): Promise<WithdrawalHistoryPage> {
      const { data } = await client.get(WITHDRAWAL_HISTORY_PATH, {
        params: { status: query.status, limit: query.limit, offset: query.offset },
      });
      const page = normalizeHistory(data, query.status);
      if (!page) throw malformedHistory();
      return page;
    },
  };
}

export const withdrawalHistoryApi = createWithdrawalHistoryApi(api);

/** Same prefix as the queue key, so the Tài chính header "Làm mới" and every approve / pay / reject refresh history too. */
export const HISTORY_ROOT = ["admin", "pending-withdrawals", "history"] as const;

export function historyKey(userId: string, query: HistoryQuery) {
  if (!userId) throw new Error("historyKey needs the signed-in user id");
  return [...HISTORY_ROOT, userId, query.status, query.limit, query.offset] as const;
}

// ─────────────────────────────────────────────────────────────── row mapping ──

export const HISTORY_OWNER_LABEL: Record<string, string> = { PT: "Huấn luyện viên", GYM: "Phòng gym", CLIENT: "Khách hàng", PLATFORM: "Nền tảng" };

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return "—";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "—";
  return (
    d.toLocaleDateString("vi-VN", { day: "2-digit", month: "2-digit", year: "numeric" }) +
    " " +
    d.toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" })
  );
}

export interface HistoryRowView {
  id: string;
  shortId: string;
  ownerLabel: string;
  ownerId: string;
  ownerShortId: string;
  amountText: string;
  /** "bạn" / "mã abcd1234" / "—". */
  approvedByText: string;
  /** "Chuyển lúc" for PAID, "Từ chối lúc" for REJECTED. */
  whenLabel: string;
  whenIso: string | null;
  whenText: string;
  /** "Mã tham chiếu ngân hàng" (PAID) or "Lý do từ chối" (REJECTED). */
  noteLabel: string;
  noteText: string;
  walletAvailableText: string;
}

/** One response row → display values. Amounts go through `formatMoneyExact` (never rounded); no raw enums. */
export function toHistoryRowView(r: WithdrawalHistoryItem, currentAdminId: string | null | undefined): HistoryRowView {
  const paid = r.status === "PAID";
  const whenIso = paid ? r.paidAt ?? r.reviewedAt : r.reviewedAt;
  return {
    id: r.id,
    shortId: shortId(r.id),
    ownerLabel: HISTORY_OWNER_LABEL[r.ownerType] ?? "Khác",
    ownerId: r.ownerId,
    ownerShortId: shortId(r.ownerId),
    amountText: formatMoneyExact(r.amount),
    approvedByText: adminLabel(r.approvedBy, currentAdminId),
    whenLabel: paid ? "Chuyển lúc" : "Từ chối lúc",
    whenIso,
    whenText: formatDateTime(whenIso),
    noteLabel: paid ? "Mã tham chiếu ngân hàng" : "Lý do từ chối",
    noteText: (paid ? r.bankReference : r.rejectionReason) ?? "—",
    walletAvailableText: formatMoneyExact(r.walletAvailableNow),
  };
}
