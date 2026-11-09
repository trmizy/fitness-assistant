/**
 * Dispute V2.1 admin UI (D1) - the MONEY axis of a case, as words.
 *
 * Pure mapping from the 12 financial states (and the case-level group) to `{label, group, tone}`:
 *  - the server's `label` / `groupLabel` wins when present (it is the authoritative wording), otherwise the allowed sentence below;
 *  - WAIVED and RESOLVED_OTHER never say paid / refunded / completed (a server label that does is ignored for those two states);
 *  - LEDGER_POSTED_FULL / PAID_VIA_LEDGER say "written to the Gymini wallet", never a bank transfer;
 *  - UNAVAILABLE is "could not read the ledger", never 0;
 *  - an unknown state is "Cần xác minh ...", never "paid" and never "owed";
 *  - amounts are decimal STRINGS formatted with `formatMoneyString` (no arithmetic here); `ledger.result` is opaque and never read.
 */
import { formatMoneyString, parseCents } from "../adminFinanceOverview.utils";
import type { CaseFinancialGroup, FinancialGroup, FinancialItem, FinancialState, FinancialView } from "./disputeCaseTypes";

export type MoneyTone = "success" | "neutral" | "warning" | "danger" | "info";

export interface MoneyDescription {
  label: string;
  group: CaseFinancialGroup;
  tone: MoneyTone;
  /** A second line with amounts (formatted strings), when the ledger gave readable ones. */
  detail?: string;
}

/** Same wording as the server's VERIFICATION_REQUIRED label. */
export const NEEDS_VERIFICATION_LABEL = "Cần xác minh — không phải nợ đang mở, cũng chưa xác minh đã trả";

/** Fallback group wording (the server sends `groupLabel`; these are the same sentences for when it is missing). */
export const GROUP_LABEL_FALLBACK: Record<CaseFinancialGroup, string> = {
  F1: "Đã ghi sổ đủ",
  F2: "Đã giải quyết, không chi trả",
  F3: "Còn phải thanh toán hoặc đối soát",
  UNAVAILABLE: "Chưa xác định được (không đọc được sổ cái)",
  NO_RECORDED_SETTLEMENT: "Chưa có bước quyết toán được ghi nhận",
};

const GROUP_TONE: Record<CaseFinancialGroup, MoneyTone> = {
  F1: "success",
  F2: "neutral",
  F3: "warning",
  UNAVAILABLE: "danger",
  NO_RECORDED_SETTLEMENT: "neutral",
};

interface StateRule {
  label: string;
  group: FinancialGroup;
  tone: MoneyTone;
}

/** Allowed sentence per state (handoff section 1). */
const STATE_RULES: Record<FinancialState, StateRule> = {
  LEDGER_PENDING: { label: "Đang ghi sổ", group: "F3", tone: "warning" },
  NEEDS_RECONCILIATION: { label: "Cần đối soát", group: "F3", tone: "warning" },
  LEDGER_POSTED_FULL: { label: "Đã ghi vào ví Gymini", group: "F1", tone: "success" },
  LEDGER_POSTED_PARTIAL: { label: "Đã ghi vào ví Gymini một phần, còn thiếu (chưa trả)", group: "F3", tone: "warning" },
  OBLIGATION_IN_PAYMENT: { label: "Đang chi ngoài hệ thống, chờ xác minh", group: "F3", tone: "info" },
  OBLIGATION_PAID_VERIFIED: { label: "Phần còn thiếu đã được chi, chứng từ đã được xác minh", group: "F1", tone: "success" },
  OBLIGATION_PAID_VIA_LEDGER: { label: "Đã trả vào ví Gymini", group: "F1", tone: "success" },
  OBLIGATION_WAIVED: { label: "Không chi trả phần còn thiếu theo quyết định của chủ", group: "F2", tone: "neutral" },
  OBLIGATION_RESOLVED_OTHER: { label: "Phần còn thiếu được xử lý bằng cách khác", group: "F2", tone: "neutral" },
  NO_MONEY_EFFECT: { label: "Không phát sinh tiền", group: "F2", tone: "neutral" },
  LEGACY_NEEDS_VERIFICATION: { label: NEEDS_VERIFICATION_LABEL, group: "F3", tone: "warning" },
  UNAVAILABLE: { label: "Chưa đọc được sổ cái", group: "UNAVAILABLE", tone: "danger" },
};

const FORBIDDEN_FOR_NOT_PAID = /đã trả|đã hoàn|hoàn tất/i;
/** States whose wording must never claim a payment. */
const NEVER_SAYS_PAID: readonly FinancialState[] = ["OBLIGATION_WAIVED", "OBLIGATION_RESOLVED_OTHER"];
/** States whose wording must never mention a bank. */
const NO_BANK_WORDS = /ngân hàng/i;

const isFinancialState = (s: unknown): s is FinancialState => typeof s === "string" && Object.prototype.hasOwnProperty.call(STATE_RULES, s);
const KNOWN_GROUPS: readonly string[] = ["F1", "F2", "F3", "UNAVAILABLE", "NO_RECORDED_SETTLEMENT"];

/** Decimal string -> "1.000.000 ₫" or null when it cannot be read (the caller then omits the number; it is never shown as 0). */
function money(value: unknown): string | null {
  return parseCents(value) === null ? null : formatMoneyString(value);
}

interface ItemLike {
  state?: unknown;
  group?: unknown;
  label?: unknown;
  ledger?: FinancialItem["ledger"] | null;
}

function obligationOf(item: ItemLike) {
  const l = item.ledger;
  return l && l.status === "FOUND" ? l.obligation : null;
}

/** Wording of ONE money step. Unknown state -> "Cần xác minh". */
export function describeMoneyState(item: ItemLike): MoneyDescription {
  if (!isFinancialState(item.state)) {
    const group = typeof item.group === "string" && KNOWN_GROUPS.includes(item.group) ? (item.group as CaseFinancialGroup) : "F3";
    return { label: NEEDS_VERIFICATION_LABEL, group, tone: "warning" };
  }
  const state = item.state;
  const rule = STATE_RULES[state];
  let label = rule.label;
  const serverLabel = typeof item.label === "string" ? item.label.trim() : "";
  if (serverLabel) {
    const unsafe = (NEVER_SAYS_PAID.includes(state) && FORBIDDEN_FOR_NOT_PAID.test(serverLabel)) || NO_BANK_WORDS.test(serverLabel) || (state === "UNAVAILABLE" && /\b0\b/.test(serverLabel));
    if (!unsafe) label = serverLabel;
  }

  const ob = obligationOf(item);
  let detail: string | undefined;
  if (ob) {
    const paid = money(ob.paid);
    const unpaid = money(ob.unpaid);
    switch (state) {
      case "LEDGER_POSTED_PARTIAL":
        detail = [paid && `Đã ghi vào ví: ${paid}`, unpaid && `Còn thiếu: ${unpaid} (chưa trả)`].filter(Boolean).join(" · ") || undefined;
        break;
      case "OBLIGATION_IN_PAYMENT":
        detail = unpaid ? `Đang chi ngoài hệ thống, chờ xác minh: ${unpaid}` : undefined;
        break;
      case "OBLIGATION_PAID_VIA_LEDGER":
        detail = paid ? `Đã ghi vào ví Gymini: ${paid}` : undefined;
        break;
      case "OBLIGATION_WAIVED":
        // Always show the amount that is NOT paid.
        detail = unpaid ? `Số tiền không chi trả: ${unpaid}` : undefined;
        break;
      case "OBLIGATION_RESOLVED_OTHER":
        detail = unpaid ? `Phần xử lý cách khác: ${unpaid}. Lý do xem ở báo cáo đối soát.` : "Lý do xem ở báo cáo đối soát.";
        break;
      default:
        break;
    }
  } else if (state === "OBLIGATION_RESOLVED_OTHER") {
    detail = "Lý do xem ở báo cáo đối soát.";
  }
  return { label, group: rule.group, tone: rule.tone, ...(detail ? { detail } : {}) };
}

/** Wording of the case-level group. The server's `groupLabel` wins; an unknown group is "Cần xác minh". */
export function describeMoneyGroup(view: Pick<FinancialView, "group" | "groupLabel"> | { group?: unknown; groupLabel?: unknown }): MoneyDescription {
  const g = view.group;
  if (typeof g !== "string" || !KNOWN_GROUPS.includes(g)) return { label: NEEDS_VERIFICATION_LABEL, group: "F3", tone: "warning" };
  const group = g as CaseFinancialGroup;
  const server = typeof view.groupLabel === "string" ? view.groupLabel.trim() : "";
  const tone = group === "F3" && server === NEEDS_VERIFICATION_LABEL ? "warning" : GROUP_TONE[group];
  return { label: server || GROUP_LABEL_FALLBACK[group], group, tone };
}

/** Whole money view -> `{group line, one line per step}`. Never turns "unreadable" into "nothing owed". */
export function describeFinancialView(view: FinancialView | null | undefined): { group: MoneyDescription; items: Array<MoneyDescription & { key: string }> } | null {
  if (!view) return null;
  return {
    group: describeMoneyGroup(view),
    items: (view.items ?? []).map((i) => ({ key: i.key, ...describeMoneyState(i) })),
  };
}
