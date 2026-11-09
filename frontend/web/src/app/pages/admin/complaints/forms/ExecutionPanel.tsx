/**
 * D6 - execution of an approved gym case (G18) and its crash recovery (G19). G18 is the ONLY money exit of the case layer: the server calls
 * `refundByAdmin` exactly once, computes the amount itself, and answers `BUSINESS_DONE` (the business step answered - NOT "money arrived").
 * What was paid is read from `money` (the server's financial view), never from the HTTP status or from `execStatus`.
 * There is no amount, reason or outcome field: neither route accepts one.
 */
import { useId, useState } from "react";
import { ArrowClockwiseIcon } from "@phosphor-icons/react";
import { gymCaseApi } from "../gymCaseApi";
import { execBlockedText } from "../gymCaseErrors";
import { EXECUTE_CONFIRM_NOTICE, EXECUTE_WALLET_NOTE, gymOutcomeLabel } from "../gymCaseLabels";
import { executeResultText } from "../gymCaseModel";
import { formatMoneyExact } from "../../adminFinanceOverview.utils";
import type { GymExecuteResult, GymReconcileResult } from "../gymCaseTypes";
import { ActionButton, ButtonRow, Check, ConfirmModal, ErrorBox, FormCard, ResultNote, useCloseOnResult, useGymWrite } from "../gymCaseKit";
import type { FormProps } from "./formTypes";

const NEEDS_HUMAN_REASON: Record<string, string> = {
  DECISION_UNREADABLE: "Không đọc được quyết định đã gắn với lần thực thi này.",
  STATE_UNREADABLE: "Không đọc được trạng thái gói hội viên.",
  MEMBERSHIP_MISSING: "Không tìm thấy gói hội viên của hồ sơ.",
  RELEASE_REPLAY_UNREADABLE: "Không đọc lại được kết quả từ sổ cái tiền.",
  CANCELLED_WITHOUT_REFUND_BY_THIS_DECISION: "Gói đã bị huỷ nhưng không thấy khoản hoàn nào do quyết định này tạo ra.",
  MEMBERSHIP_STATE_UNEXPECTED: "Gói hội viên đang ở trạng thái không như dự kiến.",
};
export const needsHumanText = (reason: unknown): string => (typeof reason === "string" && NEEDS_HUMAN_REASON[reason]) || "Có mâu thuẫn cần người xem xét.";

export function ExecuteCard({ detail, onChanged, push }: FormProps) {
  const id = useId();
  const w = useGymWrite<Record<string, never>, GymExecuteResult>(onChanged);
  const [open, setOpen] = useState(false);
  const [ack, setAck] = useState(false);
  useCloseOnResult(open, setOpen, w);
  const outcome = detail.decision?.outcome;
  const refund = !!outcome && outcome.startsWith("REFUND_");
  const outcomeText = detail.decision?.outcomeLabel || gymOutcomeLabel(outcome);
  const blocked = detail.case.execStatus === "EXEC_BLOCKED" ? [...detail.execution.history].reverse().find((h) => h.state === "BLOCKED") : null;

  async function confirm() {
    const r = await w.submit({}, () => gymCaseApi.execute(detail.case.id, detail.decision ? { decisionId: detail.decision.approvalId } : {}));
    if (r.ok) {
      const money = r.value.money;
      const tone = money?.state === "LEDGER_POSTED_FULL" ? "success" : money?.state === "NO_MONEY_EFFECT" || money?.state === "NO_REFUNDABLE_AMOUNT" ? "info" : "warning";
      push({ tone, testId: "d6-execute-done", text: executeResultText(money, r.value.replayed) });
      setOpen(false);
      setAck(false);
    }
  }

  return (
    <FormCard
      title="Thực thi quyết định"
      caption={refund ? `Hoàn gói hội viên đúng một lần. ${EXECUTE_WALLET_NOTE}` : "Ghi nhận kết quả và đóng khiếu nại. Kết quả này không có hoàn tiền."}
      testId="d6-execute"
    >
      {blocked && (
        <p role="note" className="rounded-lg border border-st-warning-border bg-st-warning-bg px-3 py-2.5 text-sm text-st-warning" data-testid="d6-execute-blocked">
          {execBlockedText(blocked.blockedReason)} Sửa nguyên nhân rồi thực thi lại được.
        </p>
      )}
      <ButtonRow>
        <ActionButton onClick={() => setOpen(true)} testId="d6-execute-open">
          {blocked ? "Thực thi lại…" : "Thực thi…"}
        </ActionButton>
      </ButtonRow>
      {!open && <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} pending={w.pending} testId="d6-execute-error" />}
      <ConfirmModal
        open={open}
        onClose={() => setOpen(false)}
        title="Thực thi quyết định"
        description="Máy chủ đọc lại mọi điều kiện (kết quả, bốn mắt, bằng chứng, gói hội viên) trước khi chạy."
        rows={[
          { label: "Kết quả", value: outcomeText },
          ...(refund
            ? [
                // INT-21: the refund is FIXED at the complaint date (refundQuote); show it before the admin confirms. What really reaches the
                // wallet is only known afterwards (the money may already have been released to the gym -> NEEDS_RECONCILIATION).
                {
                  label: "Số tiền",
                  value: detail.refundQuote
                    ? `${formatMoneyExact(detail.refundQuote.amount)}: mức hoàn đã chốt theo ngày khiếu nại. Máy chủ kiểm lại khi thực thi; số tiền thực ghi vào ví hiện sau khi thực thi.`
                    : "Do máy chủ tính theo phần chưa dùng của gói, hiện sau khi thực thi",
                },
                { label: "Nơi nhận", value: "Ví Gymini của hội viên (không chuyển về ngân hàng)" },
              ]
            : []),
        ]}
        notice={refund ? EXECUTE_CONFIRM_NOTICE : "Thao tác ghi nhận kết quả và đóng khiếu nại. Không thể hoàn tác."}
        confirmLabel={refund ? "Thực thi và hoàn gói" : "Thực thi"}
        pendingLabel="Đang thực thi…"
        confirmDisabled={refund && !ack}
        pending={w.pending}
        onConfirm={() => void confirm()}
        error={<ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} pending={w.pending} testId="d6-execute-dialog-error" />}
        testId="d6-execute-dialog"
      >
        {refund && <Check id={`${id}-ack`} checked={ack} onChange={setAck} label="Tôi hiểu thao tác chỉ chạy một lần, không hoàn tác được và số tiền do máy chủ quyết định." />}
      </ConfirmModal>
    </FormCard>
  );
}

function reconcileText(r: GymReconcileResult): { tone: "success" | "info" | "warning"; text: string } {
  switch (r.action) {
    case "NOTHING_TO_RECONCILE":
      return { tone: "info", text: "Không có lần thực thi nào đang dở để đối chiếu." };
    case "NEEDS_HUMAN":
      return { tone: "warning", text: `Cần người xem xét. ${needsHumanText((r as { reason?: string }).reason)} Hệ thống không tự thử lại.` };
    case "RERAN_REFUND":
      return { tone: "warning", text: `Đã chạy lại bước hoàn (an toàn nhờ khoá chống trùng). ${executeResultText((r as GymExecuteResult).money, false)}` };
    default:
      return { tone: "info", text: executeResultText((r as GymExecuteResult).money, false) };
  }
}

export function ReconcileCard({ detail, onChanged, push }: FormProps) {
  const w = useGymWrite<Record<string, never>, GymReconcileResult>(onChanged);

  async function run() {
    const r = await w.submit({}, () => gymCaseApi.reconcileExecution(detail.case.id));
    if (r.ok) {
      const t = reconcileText(r.value);
      push({ tone: t.tone, testId: "d6-reconcile-done", text: t.text });
    }
  }

  return (
    <FormCard
      title="Đối chiếu thực thi"
      caption="Dùng khi lần thực thi trước bị dở (mất kết nối, máy chủ sập). Hệ thống đọc trạng thái thật của gói hội viên trước rồi mới quyết định; không chạy lại mù."
      testId="d6-reconcile"
    >
      <ButtonRow>
        <ActionButton variant="outline" onClick={() => void run()} disabled={w.mustReload} pending={w.pending} testId="d6-reconcile-send">
          <ArrowClockwiseIcon className="size-4" aria-hidden /> Đối chiếu thực thi
        </ActionButton>
      </ButtonRow>
      <ErrorBox error={w.error} mustReload={w.mustReload} reloading={w.reloading} onReload={() => void w.reload()} onRetry={w.retry} pending={w.pending} testId="d6-reconcile-error" />
      {w.result && !w.error && <ResultNote tone={reconcileText(w.result).tone} testId="d6-reconcile-result">{reconcileText(w.result).text}</ResultNote>}
    </FormCard>
  );
}

