import { useState, type FormEvent } from "react";
import { disputeCaseApi } from "../admin/disputes/disputeCaseApi";
import { parseDisputeError } from "../admin/disputes/disputeCaseErrors";
import type { AppealRequestResult } from "../admin/disputes/disputeCaseTypes";
import { useIdempotentAction } from "../admin/disputes/useIdempotentAction";
import {
  Field,
  Notice,
  PRIMARY_BUTTON,
  Panel,
  controlClass,
} from "./PartyParts";
import {
  APPEAL_NOTICE_TEXT,
  APPEAL_REASON_MAX,
  APPEAL_SUCCESS_TEXT,
  validateAppealReason,
} from "./partyModel";

interface PartyAppealFormProps {
  caseId: string;
  onSaved: () => void;
  onReload: () => Promise<unknown> | void;
  reloading: boolean;
  closesAt?: string | null;
}

export function PartyAppealForm({
  caseId,
  onSaved,
  onReload: _onReload,
  reloading: _reloading,
  closesAt,
}: PartyAppealFormProps) {
  const [reason, setReason] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const action = useIdempotentAction<{ reason: string }, AppealRequestResult>();

  const handleSubmit = async (e: FormEvent) => {
    e.preventDefault();
    if (action.pending) return;

    const val = validateAppealReason(reason);
    if (!val.ok) {
      setError(val.message ?? "Lý do chưa hợp lệ.");
      setFeedback(null);
      return;
    }

    setError(null);
    setFeedback(null);
    setSuccess(null);

    const body = { reason: reason.trim() };
    const res = await action.run(body, (key, b) =>
      disputeCaseApi.requestPartyAppeal(caseId, b, key),
    );

    if (res.status === "busy") return;
    if (res.status === "ok") {
      setSuccess(APPEAL_SUCCESS_TEXT);
      setReason("");
      onSaved();
    } else {
      const parsed = parseDisputeError(res.error, { action: "write" });
      setFeedback(parsed.message);
    }
  };

  return (
    <Panel
      id="d4-appeal-request"
      title="Yêu cầu xem xét lại"
      testId="d4-appeal-form"
    >
      <div className="space-y-3">
        <Notice tone="info">{APPEAL_NOTICE_TEXT}</Notice>

        {closesAt && (
          <p className="text-xs text-[var(--muted-color)]">
            Thời hạn yêu cầu đến: {new Date(closesAt).toLocaleString("vi-VN")}
          </p>
        )}

        {success && (
          <div
            role="status"
            data-testid="d4-appeal-success"
            className="rounded-lg border border-st-success-border bg-st-success-bg p-3 text-sm text-st-success"
          >
            {success}
          </div>
        )}

        {feedback && (
          <Notice tone="danger" testId="d4-appeal-error">
            {feedback}
          </Notice>
        )}

        {!success && (
          <form onSubmit={handleSubmit} className="space-y-3">
            <Field
              id="party-appeal-reason"
              label="Lý do yêu cầu xem xét lại"
              error={error ?? undefined}
            >
              <textarea
                id="party-appeal-reason"
                rows={3}
                className={controlClass(!!error)}
                value={reason}
                onChange={(e) => {
                  setReason(e.target.value);
                  setError(null);
                  setFeedback(null);
                }}
                placeholder="Nêu rõ lý do bạn đề nghị xem xét lại kết luận..."
                maxLength={APPEAL_REASON_MAX}
                disabled={action.pending}
              />
            </Field>

            <button
              type="submit"
              className={PRIMARY_BUTTON}
              disabled={action.pending || !reason.trim()}
            >
              {action.pending ? "Đang gửi..." : "Gửi yêu cầu xem xét lại"}
            </button>
          </form>
        )}
      </div>
    </Panel>
  );
}
