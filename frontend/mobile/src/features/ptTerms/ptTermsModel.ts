/**
 * D25 - pure view-model helpers for the PT terms (no React, no network). The text and the version always come
 * from the server (`GET /pt-applications/terms`); nothing here duplicates them. Same logic as the web twin
 * (frontend/web/src/app/utils/ptTerms.ts).
 */

/** Machine code the server answers when a PT tries to accept a NEW contract without the current terms confirmed. */
export const PT_TERMS_NOT_ACCEPTED = "PT_TERMS_NOT_ACCEPTED";
/** Machine code for confirming/ticking a version that is no longer the current one. */
export const PT_TERMS_VERSION_MISMATCH = "PT_TERMS_VERSION_MISMATCH";

type MaybeAxiosError = { response?: { status?: number; data?: { code?: string } } } | null | undefined;

/** True when an axios-style error is the "please confirm the PT terms first" refusal. */
export function isPtTermsRefusal(err: unknown): boolean {
  const e = err as MaybeAxiosError;
  return e?.response?.status === 409 && e.response.data?.code === PT_TERMS_NOT_ACCEPTED;
}

/** True when the version the user confirmed was replaced meanwhile: reload the terms and ask again. */
export function isPtTermsVersionStale(err: unknown): boolean {
  const e = err as MaybeAxiosError;
  return e?.response?.status === 409 && e.response.data?.code === PT_TERMS_VERSION_MISMATCH;
}

export type PtTermsBannerState =
  | { show: false }
  | { show: true; kind: "confirm" | "updated"; title: string; message: string; action: string };

/**
 * What the re-confirmation banner says. Shown only to an approved PT who has not confirmed the CURRENT version
 * (`mustReconfirm` from the server). "updated" = they confirmed an older text before; "confirm" = never confirmed.
 */
export function ptTermsBannerState(
  terms: { mustReconfirm: boolean; previouslyAcceptedVersion: string | null } | null | undefined,
): PtTermsBannerState {
  if (!terms || !terms.mustReconfirm) return { show: false };
  const updated = terms.previouslyAcceptedVersion != null;
  return {
    show: true,
    kind: updated ? "updated" : "confirm",
    title: updated ? "Điều khoản dành cho Huấn luyện viên đã được cập nhật" : "Xác nhận điều khoản dành cho Huấn luyện viên",
    message: "Bạn cần đọc và đồng ý điều khoản trước khi chấp nhận hợp đồng mới. Hợp đồng đã ký hoặc đang chạy không bị ảnh hưởng.",
    action: "Đọc và đồng ý",
  };
}

/** Friendly sentence for the toast shown when accepting a contract was refused for the terms (no internal code). */
export const PT_TERMS_REFUSAL_MESSAGE = "Bạn cần đồng ý điều khoản dành cho Huấn luyện viên trước khi chấp nhận hợp đồng mới.";
