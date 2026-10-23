/**
 * The client's "end contract" sheet: which terms are shown, what is sent, and how the
 * PT_RESTRICTION_LIFTED 409 is read. Pure helpers only; the screen just renders their answer.
 *
 * Runs with: ./node_modules/.bin/tsx --test src/features/__tests__/contractEndTerms.test.ts
 */

import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  END_TERMS_TEXT,
  PAUSED_BY_ADMIN_NOTICE,
  applyLiftedPreview,
  endSheetView,
  isPausedByAdmin,
  isPtRestrictionLifted,
  normalizeContract,
  normalizeMoneyBreakdown,
  previewFromRestrictionLifted,
  terminateSuccessMessage,
  unresolvedSessionsNote,
} from "../services/contracts";

const ORDINARY_RAW = {
  refundIfCancelledNow: "8100000.00",
  unit: "300000.00",
  remaining: "9000000.00",
  paid: true,
  canExitWithoutPenalty: false,
};
const NO_FEE_RAW = {
  ...ORDINARY_RAW,
  refundIfCancelledNow: "9000000.00",
  canExitWithoutPenalty: true,
  exitReasonIfCancelledNow: "CLIENT_EXIT_DUE_TO_PT_RESTRICTION",
  unresolvedSessions: 0,
  unresolvedAmountHeld: "0",
};

const view = (raw: unknown, extra: Partial<Parameters<typeof endSheetView>[0]> = {}) =>
  endSheetView({
    breakdown: normalizeMoneyBreakdown(raw),
    fetching: false,
    failed: false,
    reason: "CLIENT_CANCELLED",
    termsChanged: false,
    ...extra,
  });

const conflict = (data: unknown) => ({ response: { status: 409, data } });

describe("end sheet: no-fee exit", () => {
  const v = view(NO_FEE_RAW);

  it("shows the no-fee wording, the server's full refund, and sends expectNoPenalty", () => {
    assert.equal(v.phase, "ready");
    assert.equal(v.noFee, true);
    assert.equal(v.expectNoPenalty, true);
    assert.equal(v.refund, 9000000);
    assert.equal(v.refundLabel, END_TERMS_TEXT.refundLabelNoFee);
    assert.equal(v.intro, END_TERMS_TEXT.noFeeIntro);
    assert.equal(v.confirmLabel, "Xác nhận kết thúc");
    assert.equal(v.canConfirm, true);
    assert.equal(v.showReasons, false);
  });

  it("does not imply fault and has no unresolved note without unresolved sessions", () => {
    assert.equal(v.unresolvedNote, null);
    assert.equal(v.unresolvedAmount, null);
    assert.doesNotMatch(String(v.intro), /lỗi|vi phạm|sai phạm/i);
  });

  it("reads the informational exit reason without branching on it", () => {
    assert.equal(normalizeMoneyBreakdown(NO_FEE_RAW)?.exitReasonIfCancelledNow, "CLIENT_EXIT_DUE_TO_PT_RESTRICTION");
    assert.equal(normalizeMoneyBreakdown(ORDINARY_RAW)?.exitReasonIfCancelledNow, null);
  });
});

describe("end sheet: no-fee exit with unresolved sessions", () => {
  const v = view({ ...NO_FEE_RAW, unresolvedSessions: 2, unresolvedAmountHeld: "600000.00" });

  it("adds the count note and the held amount, outside the refund", () => {
    assert.equal(v.expectNoPenalty, true);
    assert.equal(v.refund, 9000000);
    assert.equal(v.unresolvedNote, unresolvedSessionsNote(2));
    assert.match(String(v.unresolvedNote), /^Có 2 buổi huấn luyện viên đã báo/);
    assert.equal(v.unresolvedAmount, 600000);
  });

  it("omits the amount when the server did not say how much", () => {
    const w = view({ ...NO_FEE_RAW, unresolvedSessions: 1, unresolvedAmountHeld: null });
    assert.ok(w.unresolvedNote);
    assert.equal(w.unresolvedAmount, null);
  });

  it("treats a bad count as zero", () => {
    assert.equal(view({ ...NO_FEE_RAW, unresolvedSessions: "abc" }).unresolvedNote, null);
    assert.equal(view({ ...NO_FEE_RAW, unresolvedSessions: -3 }).unresolvedNote, null);
  });
});

describe("end sheet: ordinary terms", () => {
  it("keeps today's flow with the server's amount and never sends expectNoPenalty", () => {
    const v = view(ORDINARY_RAW);
    assert.equal(v.phase, "ready");
    assert.equal(v.noFee, false);
    assert.equal(v.expectNoPenalty, false);
    assert.equal(v.refund, 8100000);
    assert.equal(v.refundLabel, END_TERMS_TEXT.refundLabelOrdinary);
    assert.equal(v.showReasons, true);
    assert.equal(v.confirmLabel, "Xác nhận");
    assert.equal(v.changedNote, null);
  });

  it("shows no refund figure for a reason the preview does not describe", () => {
    assert.equal(view(ORDINARY_RAW, { reason: "PT_REPEATED_NO_SHOW" }).refund, null);
  });

  it("only a literal true opens the no-fee path", () => {
    for (const flag of ["true", 1, "yes", null, undefined]) {
      const v = view({ ...NO_FEE_RAW, canExitWithoutPenalty: flag });
      assert.equal(v.noFee, false, String(flag));
      assert.equal(v.expectNoPenalty, false, String(flag));
    }
  });

  it("a restricted-trainer breakdown with a different reason selected is ordinary", () => {
    const v = view(NO_FEE_RAW, { reason: "PT_REPEATED_NO_SHOW" });
    assert.equal(v.noFee, false);
    assert.equal(v.expectNoPenalty, false);
  });
});

describe("end sheet: loading, malformed and failed", () => {
  it("cannot confirm while the figure is being fetched", () => {
    const v = view(NO_FEE_RAW, { fetching: true });
    assert.equal(v.phase, "loading");
    assert.equal(v.canConfirm, false);
    assert.equal(v.refund, null);
  });

  it("a malformed breakdown is an error, never a guessed amount", () => {
    for (const raw of [null, undefined, {}, { refundIfCancelledNow: "abc" }, { refundIfCancelledNow: null }]) {
      const v = view(raw);
      assert.equal(v.phase, "error");
      assert.equal(v.canConfirm, false);
      assert.equal(v.intro, END_TERMS_TEXT.loadFailed);
    }
  });

  it("a failed request is an error even with an old figure around", () => {
    const v = view(ORDINARY_RAW, { failed: true });
    assert.equal(v.phase, "error");
    assert.equal(v.canConfirm, false);
  });
});

describe("end sheet: after PT_RESTRICTION_LIFTED", () => {
  it("shows ordinary terms with the explanation and a distinct second confirmation", () => {
    const v = view(ORDINARY_RAW, { termsChanged: true });
    assert.equal(v.noFee, false);
    assert.equal(v.expectNoPenalty, false);
    assert.equal(v.changedNote, END_TERMS_TEXT.termsChanged);
    assert.match(String(v.changedNote), /hoạt động trở lại/);
    assert.equal(v.confirmLabel, "Vẫn hủy hợp đồng");
    assert.equal(v.canConfirm, true);
  });

  it("never offers no-fee again, even if the re-fetch still says so", () => {
    const v = view(NO_FEE_RAW, { termsChanged: true });
    assert.equal(v.phase, "error");
    assert.equal(v.expectNoPenalty, false);
    assert.equal(v.canConfirm, false);
  });
});

describe("409 PT_RESTRICTION_LIFTED parsing", () => {
  it("reads the code from data.code, data.errorCode, data.error and data.error.code", () => {
    assert.equal(isPtRestrictionLifted(conflict({ code: "PT_RESTRICTION_LIFTED" })), true);
    assert.equal(isPtRestrictionLifted(conflict({ errorCode: "PT_RESTRICTION_LIFTED" })), true);
    assert.equal(isPtRestrictionLifted(conflict({ error: "PT_RESTRICTION_LIFTED" })), true);
    assert.equal(isPtRestrictionLifted(conflict({ error: { code: "PT_RESTRICTION_LIFTED" } })), true);
  });

  it("is not triggered by other statuses, other codes, or junk", () => {
    assert.equal(isPtRestrictionLifted({ response: { status: 400, data: { code: "PT_RESTRICTION_LIFTED" } } }), false);
    assert.equal(isPtRestrictionLifted(conflict({ code: "SOMETHING_ELSE" })), false);
    assert.equal(isPtRestrictionLifted(conflict(null)), false);
    assert.equal(isPtRestrictionLifted(undefined), false);
    assert.equal(isPtRestrictionLifted(new Error("network")), false);
  });

  it("with a preview: overlays it on the cached figures and forces ordinary terms", () => {
    const err = conflict({
      code: "PT_RESTRICTION_LIFTED",
      data: { preview: { refundIfCancelledNow: "8100000.00", canExitWithoutPenalty: true } },
    });
    assert.deepEqual(previewFromRestrictionLifted(err), {
      refundIfCancelledNow: "8100000.00",
      canExitWithoutPenalty: true,
    });
    const next = applyLiftedPreview(NO_FEE_RAW, err)!;
    assert.equal(next.refundIfCancelledNow, "8100000.00");
    assert.equal(next.canExitWithoutPenalty, false);
    const v = view(next, { termsChanged: true });
    assert.equal(v.phase, "ready");
    assert.equal(v.refund, 8100000);
    assert.equal(v.expectNoPenalty, false);
  });

  it("also finds the preview at data.preview and at data itself", () => {
    const flat = conflict({ code: "PT_RESTRICTION_LIFTED", preview: { refundIfCancelledNow: "5" } });
    assert.equal(previewFromRestrictionLifted(flat)?.refundIfCancelledNow, "5");
    const bare = conflict({ error: { code: "PT_RESTRICTION_LIFTED" }, data: { refundIfCancelledNow: "7" } });
    assert.equal(previewFromRestrictionLifted(bare)?.refundIfCancelledNow, "7");
  });

  it("without a usable preview: returns null so the caller re-fetches", () => {
    for (const data of [
      { code: "PT_RESTRICTION_LIFTED" },
      { code: "PT_RESTRICTION_LIFTED", data: {} },
      { code: "PT_RESTRICTION_LIFTED", data: { preview: { refundIfCancelledNow: "abc" } } },
      { code: "PT_RESTRICTION_LIFTED", data: { preview: [] } },
    ]) {
      assert.equal(previewFromRestrictionLifted(conflict(data)), null);
      assert.equal(applyLiftedPreview(NO_FEE_RAW, conflict(data)), null);
    }
  });
});

describe("contract status and success message", () => {
  it("reads effectiveStatus and flags only PAUSED_BY_ADMIN", () => {
    const base = { id: "c1", status: "ACTIVE" };
    assert.equal(isPausedByAdmin(normalizeContract({ ...base, effectiveStatus: "PAUSED_BY_ADMIN" })), true);
    assert.equal(isPausedByAdmin(normalizeContract({ ...base, effectiveStatus: "ACTIVE" })), false);
    assert.equal(isPausedByAdmin(normalizeContract(base)), false);
    assert.equal(normalizeContract({ ...base, effectiveStatus: 5 }).effectiveStatus, null);
  });

  it("uses the agreed neutral wording", () => {
    assert.equal(
      PAUSED_BY_ADMIN_NOTICE,
      "Hợp đồng đang tạm dừng trong lúc huấn luyện viên tạm ngưng hoạt động. Buổi tập và thời hạn của bạn được giữ nguyên.",
    );
  });

  it("reports a no-fee exit as such and keeps today's toast otherwise", () => {
    const fmt = (n: number) => `${n}đ`;
    assert.equal(
      terminateSuccessMessage({ exitWithoutPenalty: true, settlement: { refund: "9000000" } }, fmt),
      "Đã kết thúc hợp đồng — hoàn 9000000đ vào ví của bạn, không mất phí",
    );
    assert.equal(terminateSuccessMessage({ exitWithoutPenalty: true }, fmt), "Đã kết thúc hợp đồng");
    assert.equal(terminateSuccessMessage({ exitWithoutPenalty: false }, fmt), "Đã cập nhật hợp đồng.");
    assert.equal(terminateSuccessMessage(undefined, fmt), "Đã cập nhật hợp đồng.");
  });
});
