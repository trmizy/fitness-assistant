/**
 * B7 — "Hành trình tiền": ONE chronological list built from the detail response of a transaction.
 * It merges: creation and payment, webhook events, ledger entries, ledger operations, refunds, commissions, obligations and
 * holdback reviews. Pure (no React) so the ordering and the wording are unit-tested.
 *
 * Rules: every title is Vietnamese (labels with a neutral fallback, never a raw enum); an event without a readable time is
 * left out (it cannot be placed); amounts stay decimal strings (the view formats them with `formatMoneyExact`); webhook
 * events carry time / provider / processed / retry only — the server never sends a payload and this file never asks for one.
 */
import {
  bucketLabel,
  commissionStatusLabel,
  holdbackKindLabel,
  holdbackStatusLabel,
  ledgerOperationLabel,
  obligationKindLabel,
  obligationStatusLabel,
  ownerLabel,
  providerLabel,
  purposeLabel,
  statusLabel,
  type StatusTone,
} from "./transactionsLabels";
import type { TxnDetailResponse } from "./transactionsTypes";

export type JourneyKind =
  | "created"
  | "refund-of"
  | "webhook"
  | "paid"
  | "failed"
  | "ledger-operation"
  | "ledger-entry"
  | "commission"
  | "commission-settled"
  | "obligation"
  | "obligation-closed"
  | "holdback"
  | "holdback-decided"
  | "refund"
  | "refunded";

export interface JourneyEvent {
  /** Stable key (kind + source id). */
  key: string;
  /** ISO instant. */
  at: string;
  kind: JourneyKind;
  title: string;
  /** Extra Vietnamese sentence, or null. */
  detail: string | null;
  /** Decimal string to show with `formatMoneyExact`, or null. */
  amount: string | null;
  tone: StatusTone;
  /** Another transaction this step points at (a refund or the original) — the view renders a link to open it. */
  linkTransactionId: string | null;
}

/** Order of events that share the same instant: cause before effect. */
const RANK: Record<JourneyKind, number> = {
  created: 0,
  "refund-of": 1,
  webhook: 2,
  paid: 3,
  failed: 3,
  "ledger-operation": 4,
  "ledger-entry": 5,
  commission: 6,
  "commission-settled": 7,
  obligation: 8,
  "obligation-closed": 9,
  holdback: 10,
  "holdback-decided": 11,
  refund: 12,
  refunded: 13,
};

const validTime = (iso: string | null | undefined): iso is string => !!iso && !Number.isNaN(Date.parse(iso));

export const shortId = (id: string | null | undefined): string => (id ? (id.length > 8 ? id.slice(0, 8) : id) : "—");

export function buildMoneyJourney(detail: TxnDetailResponse): JourneyEvent[] {
  const out: JourneyEvent[] = [];
  const push = (e: Omit<JourneyEvent, "at" | "detail" | "amount" | "linkTransactionId"> & Partial<Pick<JourneyEvent, "detail" | "amount" | "linkTransactionId">>, at: string | null | undefined) => {
    if (!validTime(at)) return;
    out.push({ detail: null, amount: null, linkTransactionId: null, ...e, at });
  };
  const tx = detail.transaction;

  push({ key: `created:${tx.id}`, kind: "created", title: `Tạo giao dịch: ${purposeLabel(tx.purpose)}`, detail: `Cổng thanh toán: ${providerLabel(tx.provider)}.`, amount: tx.amount, tone: "neutral" }, tx.createdAt);

  if (detail.refundOf) {
    push({ key: `refund-of:${tx.id}`, kind: "refund-of", title: "Đây là khoản hoàn tiền cho một giao dịch gốc", detail: `Giao dịch gốc ${shortId(detail.refundOf.id)}.`, amount: detail.refundOf.amount, tone: "warning", linkTransactionId: detail.refundOf.id }, tx.createdAt);
  }

  for (const w of detail.webhookEvents ?? []) {
    const processed = validTime(w.processedAt);
    const retry = w.retryCount > 0 ? ` Cổng đã gửi lại ${w.retryCount} lần.` : "";
    push({
      key: `webhook:${w.id}`,
      kind: "webhook",
      title: `Cổng ${providerLabel(w.provider)} gọi về`,
      detail: `${processed ? "Đã xử lý." : "Chưa xử lý."}${retry}`,
      tone: processed ? "info" : "warning",
    }, processed ? w.processedAt : w.createdAt);
  }

  push({ key: `paid:${tx.id}`, kind: "paid", title: "Đã thu tiền thành công", detail: `Qua ${providerLabel(tx.provider)}.`, amount: tx.amount, tone: "success" }, tx.paidAt);
  push({ key: `failed:${tx.id}`, kind: "failed", title: "Thanh toán thất bại", tone: "danger" }, tx.failedAt);

  for (const o of detail.ledgerOperations ?? []) {
    push({ key: `ledger-operation:${o.id}`, kind: "ledger-operation", title: ledgerOperationLabel(o.kind), tone: "info" }, o.createdAt);
  }

  for (const e of detail.ledgerEntries ?? []) {
    const verb = e.entryType === "DEBIT" ? "Trừ" : e.entryType === "CREDIT" ? "Cộng" : "Ghi";
    push({
      key: `ledger-entry:${e.id}`,
      kind: "ledger-entry",
      title: `${verb} ví ${ownerLabel(e.walletOwnerType)} · ${bucketLabel(e.bucket)}`,
      amount: e.amount,
      tone: e.entryType === "DEBIT" ? "warning" : "success",
    }, e.createdAt);
  }

  for (const c of detail.commissions ?? []) {
    push({
      key: `commission:${c.id}`,
      kind: "commission",
      title: `Ghi nhận hoa hồng nền tảng (${ownerLabel(c.partnerType)})`,
      detail: `${commissionStatusLabel(c.status)}.`,
      amount: c.platformFeeAmount,
      tone: "neutral",
    }, c.createdAt);
    push({ key: `commission-settled:${c.id}`, kind: "commission-settled", title: "Hoa hồng đã được chốt", amount: c.platformFeeAmount, tone: "success" }, c.settledAt);
  }

  for (const o of detail.obligations ?? []) {
    push({
      key: `obligation:${o.id}`,
      kind: "obligation",
      title: `Ghi nhận nghĩa vụ chưa trả: ${obligationKindLabel(o.kind)}`,
      detail: `Bên nhận: ${ownerLabel(o.party)}. Trạng thái hiện tại: ${obligationStatusLabel(o.status)}.`,
      amount: o.unpaid,
      tone: "danger",
    }, o.createdAt);
    push({ key: `obligation-closed:${o.id}`, kind: "obligation-closed", title: "Nghĩa vụ chưa trả đã được đóng", detail: `${obligationStatusLabel(o.status)}.`, tone: "success" }, o.resolvedAt);
  }

  for (const h of detail.holdbackReviews ?? []) {
    push({
      key: `holdback:${h.id}`,
      kind: "holdback",
      title: `Giữ lại tiền của PT: ${holdbackKindLabel(h.kind)}`,
      detail: `${holdbackStatusLabel(h.status)}.`,
      amount: h.reserve,
      tone: "warning",
    }, h.createdAt);
    push({
      key: `holdback-decided:${h.id}`,
      kind: "holdback-decided",
      title: "Đã quyết định khoản tiền giữ lại",
      detail: `${holdbackStatusLabel(h.status)}.`,
      amount: h.releasedToPt ?? h.verifiedAmount ?? null,
      tone: "success",
    }, h.decidedAt);
  }

  for (const r of detail.refunds ?? []) {
    push({
      key: `refund:${r.id}`,
      kind: "refund",
      title: `Hoàn tiền ${shortId(r.id)}`,
      detail: `Trạng thái: ${statusLabel(r.status).toLowerCase()}. Mở giao dịch hoàn để xem chi tiết.`,
      amount: r.amount,
      tone: "warning",
      linkTransactionId: r.id,
    }, r.createdAt);
  }
  push({ key: `refunded:${tx.id}`, kind: "refunded", title: "Giao dịch được ghi nhận là đã hoàn tiền", tone: "warning" }, tx.refundedAt);

  // Stable sort: time, then cause-before-effect rank, then insertion order.
  return out
    .map((e, i) => ({ e, i }))
    .sort((a, b) => Date.parse(a.e.at) - Date.parse(b.e.at) || RANK[a.e.kind] - RANK[b.e.kind] || a.i - b.i)
    .map(({ e }) => e);
}
