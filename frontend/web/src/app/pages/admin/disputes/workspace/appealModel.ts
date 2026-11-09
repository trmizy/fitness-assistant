/**
 * Pure functions for Appeals (A45-A47, A50, B8, G25, G26).
 * Follows rules B2, B3, B4:
 * - Specific consequence status texts
 * - No raw enums in visible text
 * - Closure money status sentence
 */
import type {
  AppealConsequence,
  AppealDecisionInput,
  AppealItem,
  AppealResult,
  AppealStatus,
  ClosureInfo,
  ConsequenceKind,
  ConsequenceStatus,
} from "../disputeCaseTypes";

export const DECIDE_APPEAL_CONFIRM =
  "Kết quả xem xét lại được ghi vĩnh viễn. Kết luận mới (nếu có) không tự thực thi và không tự chuyển tiền.";

export const CLOSE_EXECUTED_CONFIRM =
  "Đóng hồ sơ không chuyển tiền, không đổi buổi tập và không mở lại được.";

export const MONEY_FIELD_WARNING =
  "Chỉ ghi số tiền khi kết luận đã xác lập rõ số tiền và bên chịu trách nhiệm. Bỏ trống thì hệ quả chuyển sang chờ đối soát, không tạo khoản nợ.";

export const APPEAL_STATUS_LABEL: Record<AppealStatus, string> = {
  REQUESTED: "Đã yêu cầu",
  UNDER_REVIEW: "Đang xem xét",
  DECIDED: "Đã có kết quả",
};

export function appealStatusLabel(status: string | null | undefined): string {
  if (status && status in APPEAL_STATUS_LABEL) {
    return APPEAL_STATUS_LABEL[status as AppealStatus];
  }
  return "Chưa rõ trạng thái";
}

export function appealStatusTone(status: string | null | undefined): "pending" | "info" | "success" | "neutral" {
  switch (status) {
    case "REQUESTED":
      return "pending";
    case "UNDER_REVIEW":
      return "info";
    case "DECIDED":
      return "success";
    default:
      return "neutral";
  }
}

export const APPEAL_RESULT_LABEL: Record<AppealResult, string> = {
  UPHELD: "Giữ nguyên kết luận",
  NEW_FINDING: "Có kết luận mới",
};

export function appealResultLabel(result: string | null | undefined): string {
  if (result && result in APPEAL_RESULT_LABEL) {
    return APPEAL_RESULT_LABEL[result as AppealResult];
  }
  return "Chưa có kết quả";
}

export function appealPartyLabel(role: string | null | undefined): string {
  if (role === "CLIENT") return "Khách";
  if (role === "PT") return "PT";
  return "Bên liên quan";
}

export const CONSEQUENCE_KIND_LABEL: Record<ConsequenceKind, string> = {
  MONEY: "Tiền bồi hoàn",
  QUOTA: "Quyền buổi tập",
  PT_AT_FAULT: "Xác định lỗi PT",
};

export function consequenceKindLabel(kind: string | null | undefined): string {
  if (kind && kind in CONSEQUENCE_KIND_LABEL) {
    return CONSEQUENCE_KIND_LABEL[kind as ConsequenceKind];
  }
  return "Hệ quả khác";
}

export const CONSEQUENCE_STATUS_LABEL: Record<ConsequenceStatus, string> = {
  NEEDS_RECONCILIATION:
    "Chờ đối soát: chưa xác lập số tiền và bên chịu trách nhiệm; chưa có khoản nợ nào được tạo",
  OBLIGATION_OPEN: "Đã tạo khoản phải trả cho khách, chưa thanh toán",
  RESOLVED: "Đã xử lý",
  OPEN: "Đang mở",
};

export const isNeedsRecon = (s: string | null | undefined): boolean => s === "NEEDS_RECONCILIATION";

export function consequenceStatusLabel(status: string | null | undefined): string {
  if (status && status in CONSEQUENCE_STATUS_LABEL) {
    return CONSEQUENCE_STATUS_LABEL[status as ConsequenceStatus];
  }
  return "Chưa rõ trạng thái hệ quả";
}

export function consequenceStatusTone(status: string | null | undefined): "warning" | "info" | "success" | "neutral" {
  switch (status) {
    case "NEEDS_RECONCILIATION":
      return "warning";
    case "OBLIGATION_OPEN":
      return "info";
    case "RESOLVED":
      return "success";
    default:
      return "neutral";
  }
}

export function closureStatusText(closure?: ClosureInfo | null): string | null {
  if (!closure) return null;
  if (closure.moneyAxisSettled === false || closure.fullyResolved === false) {
    return "Hồ sơ đã đóng nhưng phần tiền chưa xong";
  }
  if (closure.state === "CLOSED" || closure.state === "APPEAL_CONCLUDED") {
    return "Hồ sơ đã đóng hoàn tất các bước xem xét lại";
  }
  return null;
}

export interface AdminOption {
  id: string;
  displayName?: string;
  label?: string;
  isSelf?: boolean;
}

export function filterIndependentReviewers(
  admins: AdminOption[],
  excludedIds: Array<string | null | undefined>,
): { eligible: AdminOption[]; excluded: AdminOption[] } {
  const exSet = new Set(excludedIds.filter((id): id is string => Boolean(id)));
  const eligible: AdminOption[] = [];
  const excluded: AdminOption[] = [];
  for (const adm of admins) {
    if (exSet.has(adm.id)) {
      excluded.push(adm);
    } else {
      eligible.push(adm);
    }
  }
  return { eligible, excluded };
}

export function canAdminDecideAppeal(
  appeal: Pick<AppealItem, "status" | "reviewerId">,
  currentUserId?: string | null,
): boolean {
  if (appeal.status !== "UNDER_REVIEW") return false;
  if (!appeal.reviewerId || !currentUserId) return false;
  return appeal.reviewerId === currentUserId;
}

export type ResponsibleParty = "PT" | "GYM" | "PLATFORM";

export const RESPONSIBLE_PARTY_LABEL: Record<ResponsibleParty, string> = {
  PT: "PT",
  GYM: "Phòng tập",
  PLATFORM: "Nền tảng",
};

export interface ConsequenceFormRow {
  id: string;
  kind: "MONEY" | "QUOTA" | "PT_AT_FAULT";
  note: string;
  amountVnd?: string;
  responsibleParty?: ResponsibleParty | "";
}

export interface AppealDecisionFormState {
  result: "UPHELD" | "NEW_FINDING";
  reasoning: string;
  finding?: string;
  consequences?: ConsequenceFormRow[];
}

export interface AppealDecisionPayloadOutcome {
  ok: boolean;
  payload?: AppealDecisionInput;
  errors?: Record<string, string>;
}

export function appealDecisionPayload(
  form: AppealDecisionFormState,
): AppealDecisionPayloadOutcome {
  const errors: Record<string, string> = {};
  const reasoning = (form.reasoning ?? "").trim();

  if (reasoning.length < 1) {
    errors.reasoning = "Vui lòng nhập lập luận giải quyết (tối thiểu 1 ký tự).";
  } else if (reasoning.length > 8000) {
    errors.reasoning = "Lập luận không được vượt quá 8000 ký tự.";
  }

  if (form.result === "UPHELD") {
    if (Object.keys(errors).length > 0) {
      return { ok: false, errors };
    }
    return {
      ok: true,
      payload: {
        result: "UPHELD",
        reasoning,
      },
    };
  }

  // NEW_FINDING
  if (!form.finding) {
    errors.finding = "Vui lòng chọn kết luận mới.";
  }

  const rawRows = form.consequences ?? [];
  if (rawRows.length > 3) {
    errors.consequences = "Tối đa 3 hệ quả.";
  }

  const builtConsequences: Array<{
    kind: "MONEY" | "QUOTA" | "PT_AT_FAULT";
    note: string;
    amountVnd?: number;
    responsibleParty?: ResponsibleParty;
  }> = [];

  for (let i = 0; i < rawRows.length; i++) {
    const row = rawRows[i];
    const note = (row.note ?? "").trim();
    if (note.length < 1 || note.length > 2000) {
      errors[`consequence_${i}_note`] = "Ghi chú hệ quả là bắt buộc (1..2000 ký tự).";
    }

    if (row.kind === "MONEY") {
      const amtStr = String(row.amountVnd ?? "").trim();
      const hasAmt = amtStr.length > 0;
      const party = row.responsibleParty;
      const hasParty = Boolean(party);

      if (hasAmt !== hasParty) {
        errors[`consequence_${i}_money`] =
          "Số tiền và bên chịu trách nhiệm phải đi cùng nhau (hoặc cùng để trống).";
      } else if (hasAmt && hasParty) {
        let hasRowError = false;
        const amt = Number(amtStr);
        if (!Number.isInteger(amt) || amt < 1 || amt > 10_000_000_000) {
          errors[`consequence_${i}_amount`] =
            "Số tiền phải là số nguyên từ 1 đến 10.000.000.000 đ.";
          hasRowError = true;
        }
        if (party !== "PT" && party !== "GYM" && party !== "PLATFORM") {
          errors[`consequence_${i}_party`] =
            "Bên chịu trách nhiệm không hợp lệ.";
          hasRowError = true;
        } else if (form.finding !== "VERIFIED_PT_ABSENT" || party !== "PT") {
          errors[`consequence_${i}_ruleB2`] =
            "Chỉ được ghi số tiền khi kết luận mới là 'PT vắng mặt' và bên chịu trách nhiệm là PT; các trường hợp khác để đối soát.";
          hasRowError = true;
        }
        if (!hasRowError) {
          builtConsequences.push({
            kind: "MONEY",
            note,
            amountVnd: amt,
            responsibleParty: "PT",
          });
        }
      } else {
        builtConsequences.push({
          kind: "MONEY",
          note,
        });
      }
    } else {
      builtConsequences.push({
        kind: row.kind,
        note,
      });
    }
  }

  if (Object.keys(errors).length > 0) {
    return { ok: false, errors };
  }

  return {
    ok: true,
    payload: {
      result: "NEW_FINDING",
      reasoning,
      finding: form.finding,
      ...(builtConsequences.length > 0 ? { consequences: builtConsequences } : {}),
    },
  };
}

export const RES_KEEP = "UPHELD" as const;
export const RES_NEW = "NEW_FINDING" as const;
export type AppealResultChoice = typeof RES_KEEP | typeof RES_NEW;

export const RESULT_UPHELD = RES_KEEP;
export const RESULT_NEW_FINDING = RES_NEW;
export const STATUS_OBLIGATION_OPEN = "OBLIGATION_OPEN" as const;
export const STATUS_NEEDS_RECONCILIATION = "NEEDS_RECONCILIATION" as const;

export const isKeepResult = (r?: string | null): boolean => r === RES_KEEP;
export const isNewResult = (r?: string | null): boolean => r === RES_NEW;
export const isUpheldResult = isKeepResult;
export const isNewFindingResult = isNewResult;
export const isObligationOpen = (s?: string | null): boolean => s === STATUS_OBLIGATION_OPEN;


