import { useEffect, useRef, useState, type FormEvent } from "react";
import { disputeCaseApi } from "../admin/disputes/disputeCaseApi";
import { parseDisputeError } from "../admin/disputes/disputeCaseErrors";
import type { StatementCreated } from "../admin/disputes/disputeCaseTypes";
import { useIdempotentAction } from "../admin/disputes/useIdempotentAction";
import { Field, Notice, PRIMARY_BUTTON, Panel, PartyLink, ReloadButton, LIST_PATH, FOCUS, controlClass, describedBy } from "./PartyParts";
import { NOT_FOUND_TEXT } from "./partyLabels";
import { REASON_MAX, STATEMENT_MAX, describeFormFailure, validateStatement, type FieldErrors, type FormFeedback, type StatementBody } from "./partyModel";

/**
 * D4 / B3 - "Gửi lời khai". One stable Idempotency-Key per attempt (useIdempotentAction): a double click is one request, a retry of the same
 * text replays instead of duplicating. The reason field appears from the second statement of the party's role on (and as soon as the server asks).
 */
export function StatementForm({
  caseId,
  nextVersion,
  onSaved,
  onReload,
  reloading,
}: {
  caseId: string;
  nextVersion: number;
  onSaved: () => void;
  onReload: () => Promise<unknown> | void;
  reloading: boolean;
}) {
  const needsReason = nextVersion > 1;
  const [text, setText] = useState("");
  const [reason, setReason] = useState("");
  const [forceReason, setForceReason] = useState(false);
  const [errors, setErrors] = useState<FieldErrors>({});
  const [feedback, setFeedback] = useState<FormFeedback | null>(null);
  const [saved, setSaved] = useState<string | null>(null);
  const [mustReload, setMustReload] = useState(false);
  const action = useIdempotentAction<StatementBody, StatementCreated>();
  const textRef = useRef<HTMLTextAreaElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const focusAfter = useRef<"text" | "reason" | null>(null);
  const reasonVisible = needsReason || forceReason;

  useEffect(() => {
    if (!focusAfter.current) return;
    (focusAfter.current === "reason" ? reasonRef.current : textRef.current)?.focus();
    focusAfter.current = null;
  });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (action.pending || mustReload) return;
    const checked = validateStatement({ text, supplementReason: reason }, reasonVisible);
    if ("errors" in checked) {
      setErrors(checked.errors);
      setFeedback(null);
      setSaved(null);
      focusAfter.current = checked.errors.text ? "text" : "reason";
      return;
    }
    setErrors({});
    setFeedback(null);
    setSaved(null);
    const out = await action.run(checked.body, (key, body) => disputeCaseApi.submitStatement(caseId, body, key));
    if (out.status === "busy") return;
    if (out.status === "ok") {
      setText("");
      setReason("");
      setForceReason(false);
      setSaved(`Đã gửi lời khai lần ${out.value.version}. Lời khai của bạn đã được ghi vào hồ sơ.`);
      onSaved();
      return;
    }
    const f = describeFormFailure(parseDisputeError(out.error, { action: "write" }));
    setFeedback(f);
    setErrors(f.fieldErrors);
    if (f.showReasonField) {
      setForceReason(true);
      focusAfter.current = "reason";
    } else if (f.fieldErrors.text) focusAfter.current = "text";
    if (f.mustReload) setMustReload(true);
  };

  const reload = async () => {
    await onReload();
    setMustReload(false);
    setFeedback(null);
  };

  const busy = action.pending;
  return (
    <Panel id="d4-stmt" title={needsReason ? "Bổ sung lời khai" : "Gửi lời khai của bạn"} testId="d4-statement-form">
      <form onSubmit={submit} noValidate className="space-y-4" aria-busy={busy || undefined}>
        <p className="text-sm">
          {needsReason
            ? `Bạn đã có lời khai trong hồ sơ này. Lời khai mới sẽ là lần ${nextVersion}; các lần trước vẫn được giữ lại.`
            : "Hãy mô tả điều đã xảy ra với buổi tập, theo cách của bạn. Lời khai được lưu vào hồ sơ và không sửa được sau khi gửi; nếu cần thay đổi, bạn gửi lời khai bổ sung."}
        </p>
        <Field
          id="d4-stmt-text"
          label="Nội dung lời khai"
          required
          error={errors.text}
          counter={`${text.trim().length}/${STATEMENT_MAX}`}
        >
          <textarea
            id="d4-stmt-text"
            ref={textRef}
            name="text"
            rows={6}
            value={text}
            onChange={(e) => setText(e.target.value)}
            disabled={busy}
            aria-required="true"
            aria-invalid={errors.text ? true : undefined}
            aria-describedby={describedBy("d4-stmt-text", false, !!errors.text)}
            className={`${controlClass(!!errors.text)} resize-y`}
          />
        </Field>
        {reasonVisible && (
          <Field
            id="d4-stmt-reason"
            label="Lý do bổ sung"
            required
            hint="Vì sao bạn bổ sung lời khai này (ví dụ: có thêm thông tin mới)."
            error={errors.supplementReason}
            counter={`${reason.trim().length}/${REASON_MAX}`}
          >
            <textarea
              id="d4-stmt-reason"
              ref={reasonRef}
              name="supplementReason"
              rows={3}
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              disabled={busy}
              aria-required="true"
              aria-invalid={errors.supplementReason ? true : undefined}
              aria-describedby={describedBy("d4-stmt-reason", true, !!errors.supplementReason)}
              className={`${controlClass(!!errors.supplementReason)} resize-y`}
            />
          </Field>
        )}

        {feedback && (
          <Notice tone={feedback.outcomeUnknown ? "warning" : "danger"} role="alert" testId="d4-statement-error">
            <p>{feedback.message}</p>
            {feedback.notFound && (
              <p className="mt-1">
                {NOT_FOUND_TEXT}{" "}
                <PartyLink to={LIST_PATH} className={`font-semibold underline ${FOCUS}`}>
                  Về danh sách
                </PartyLink>
              </p>
            )}
          </Notice>
        )}
        {saved && (
          <Notice tone="info" role="status" testId="d4-statement-saved">
            {saved}
          </Notice>
        )}

        <div className="flex flex-wrap items-center gap-2">
          <button type="submit" className={PRIMARY_BUTTON} disabled={busy || mustReload} data-testid="d4-statement-submit">
            {busy ? "Đang gửi…" : "Gửi lời khai"}
          </button>
          {(mustReload || feedback?.outcomeUnknown) && (
            <ReloadButton onClick={() => void reload()} busy={reloading} label="Tải lại hồ sơ" testId="d4-statement-reload" />
          )}
        </div>
        {mustReload && <p className="text-xs">Hãy tải lại hồ sơ trước, rồi gửi lại nếu vẫn cần.</p>}
      </form>
    </Panel>
  );
}
