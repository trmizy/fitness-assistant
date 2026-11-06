import { useEffect, useState } from "react";
import { gymCaseApi } from "../gymCaseApi";
import type { FormProps } from "./formTypes";
import { actionOf } from "../gymCaseModel";
import { CARD, Muted, Notice } from "../GymParts";
import {
  ActionButton,
  ButtonRow,
  ErrorBox,
  Field,
  useWrite,
} from "../../disputes/actions/actionKit";
import { listAdminOptions } from "../../disputes/actions/adminDirectory";
import type { AdminOption } from "../../disputes/actions/actionModel";
import { shortRefOf } from "../gymCaseModel";

/** Never show the raw appeal status. */
const GYM_APPEAL_STATUS_LABEL: Record<string, string> = {
  FILED: "Đã gửi, chờ giao người xem xét",
  REVIEWING: "Đang xem xét",
  DECIDED: "Đã có kết quả",
  CONCLUDED: "Đã có kết quả",
};

export function GymAppealReviewerPanel({
  detail,
  currentUserId,
  onChanged,
}: FormProps) {
  const caseId = detail.case.id;
  const assignAction = actionOf(detail, "ASSIGN_APPEAL_REVIEWER");

  const [admins, setAdmins] = useState<AdminOption[]>([]);
  const [selectedReviewer, setSelectedReviewer] = useState("");
  const [error, setError] = useState<string | null>(null);

  const write = useWrite<{ reviewerId?: string }, unknown>(onChanged);

  useEffect(() => {
    void listAdminOptions(null).then((opts) => setAdmins(opts));
  }, []);

  const appeal = detail.appeal;

  // Show if assign action is allowed, or case is in APPEAL_REVIEW
  if (!assignAction.allowed && detail.case.status !== "APPEAL_REVIEW") {
    return null;
  }

  // Filter out users linked to this case
  const excludedIds = new Set([
    detail.case.investigatorId,
    detail.complaint.reporterUserId,
    detail.gym?.ownerId,
    currentUserId,
    // G26: the reviewer must never have taken ANY role in the case; the server re-checks (REVIEWER_NOT_INDEPENDENT).
    ...(detail.proposals ?? []).flatMap((pr) => [pr.proposerId, ...(pr.approvals ?? []).map((ap) => ap.approverId)]),
    ...(detail.findings ?? []).map((f) => f.recordedBy),
    ...(detail.claims ?? []).map((c) => c.createdBy),
  ].filter(Boolean));

  const eligibleAdmins = admins.filter((adm) => !excludedIds.has(adm.id));

  const handleSubmit = async () => {
    setError(null);
    const body = selectedReviewer ? { reviewerId: selectedReviewer } : {};
    const res = await write.submit(body, (key, b) =>
      gymCaseApi.assignAppealReviewer(caseId, b, key),
    );
    if (res.ok) {
      setSelectedReviewer("");
      await onChanged();
    }
  };

  return (
    <section
      className={`${CARD} space-y-3 p-4`}
      data-testid="gym-appeal-reviewer-panel"
      aria-label="Phân công người xem xét lại hồ sơ phòng gym"
    >
      <h3 className="text-base font-semibold text-adm-text">
        Người xem xét lại kháng nghị
      </h3>

      <Muted>
        Người xem xét phải độc lập: chưa từng làm bất kỳ bước nào trong hồ sơ và
        không liên quan tới phòng tập.
      </Muted>

      {appeal && (
        <div className="space-y-1 rounded border border-adm-border-soft bg-adm-surface-2 p-3 text-xs text-adm-text">
          <p className="font-medium text-adm-text">
            Trạng thái kháng nghị: {GYM_APPEAL_STATUS_LABEL[appeal.status ?? ""] ?? "Đang xem xét"}
          </p>
          {appeal.reviewerId && (
            <p className="text-adm-text-2">
              Người xem xét hiện tại: mã {shortRefOf(appeal.reviewerId)}
            </p>
          )}
        </div>
      )}

      {assignAction.allowed && (
        <div className="space-y-3 rounded-lg border border-adm-border bg-adm-surface p-3">
          <Field id="gym-appeal-reviewer-select" label="Chọn quản trị viên độc lập">
            <select
              id="gym-appeal-reviewer-select"
              className="block w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-2 text-sm text-adm-text"
              value={selectedReviewer}
              onChange={(e) => {
                setSelectedReviewer(e.target.value);
                setError(null);
              }}
            >
              <option value="">-- Để trống để tự nhận trách nhiệm --</option>
              {eligibleAdmins.map((adm) => (
                <option key={adm.id} value={adm.id}>
                  {adm.label} ({shortRefOf(adm.id)})
                </option>
              ))}
            </select>
          </Field>

          {error && <Notice tone="danger">{error}</Notice>}
          {write.error && (
            <ErrorBox
              error={write.error}
              mustReload={write.mustReload}
              reloading={write.reloading}
              onReload={write.reload}
              onRetry={write.retry}
              pending={write.pending}
            />
          )}

          <ButtonRow>
            <ActionButton
              variant="primary"
              onClick={handleSubmit}
              disabled={write.pending}
              pending={write.pending}
            >
              Giao người xem xét lại
            </ActionButton>
          </ButtonRow>
        </div>
      )}
    </section>
  );
}
