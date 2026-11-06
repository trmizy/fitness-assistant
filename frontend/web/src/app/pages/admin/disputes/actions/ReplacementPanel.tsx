import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { CompactReference } from "../shared/CompactReference";
import { disputeCaseApi } from "../disputeCaseApi";
import { DISPUTE_QUERY_OPTIONS, useDisputeQueryKeys } from "../disputeQueryKeys";
import type { ReplacementItem, ReplacementList } from "../disputeCaseTypes";
import { formatDateTime, shortRef } from "../workspace/format";
import { CARD, EmptyBox, Muted, Notice, Pill } from "../workspace/WorkspaceParts";
import {
  ActionButton,
  ButtonRow,
  Check,
  ConfirmModal,
  ErrorBox,
  Field,
  TextArea,
  useWrite,
} from "./actionKit";
import {
  APPROVE_REPLACEMENT_CONFIRM,
  PROPOSE_REPLACEMENT_CONFIRM,
  REJECT_REPLACEMENT_CONFIRM,
  REPLACEMENT_EXEC_EFFECT_NOTE,
  canDecideReplacement,
  canProposeReplacement,
  isDecisionAlreadyExecuted,
  isProposer,
  replacementStatusLabel,
  replacementStatusTone,
  validateReplacementReason,
} from "./replacementModel";

interface ReplacementPanelProps {
  caseId: string;
  caseStatus: string;
  execStatus?: string | null;
  currentUserId?: string | null;
  onChanged: () => void | Promise<unknown>;
}

export function ReplacementPanel({
  caseId,
  caseStatus,
  execStatus,
  currentUserId,
  onChanged,
}: ReplacementPanelProps) {
  const queryClient = useQueryClient();
  const { keys } = useDisputeQueryKeys();

  const replacementsQuery = useQuery({
    queryKey: keys ? keys.replacements(caseId) : ["dispute-case", "disabled", "replacements", caseId],
    queryFn: () => disputeCaseApi.listReplacements(caseId),
    enabled: Boolean(keys && caseStatus === "DECISION_APPROVED"),
    ...DISPUTE_QUERY_OPTIONS,
  });

  const data = replacementsQuery.data ?? null;
  const loading = replacementsQuery.isLoading;
  const error = replacementsQuery.isError ? "Chưa tải được danh sách đề xuất thay thế." : null;

  // Propose form state
  const [proposeReason, setProposeReason] = useState("");
  const [proposeConfirmOpen, setProposeConfirmOpen] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  // Decide (Approve / Reject) state
  const [activeItem, setActiveItem] = useState<ReplacementItem | null>(null);
  const [decideAction, setDecideAction] = useState<"APPROVE" | "REJECT" | null>(null);
  const [decideReason, setDecideReason] = useState("");
  const [coiChecked, setCoiChecked] = useState(false);
  const [decideConfirmOpen, setDecideConfirmOpen] = useState(false);
  const [decideError, setDecideError] = useState<string | null>(null);

  const proposeWrite = useWrite<{ reason: string }, unknown>(onChanged);
  const decideWrite = useWrite<
    { reason: string; conflictOfInterestDeclaredNone: boolean },
    unknown
  >(onChanged);

  if (caseStatus !== "DECISION_APPROVED") {
    return null;
  }

  const items = data?.items ?? [];
  const hasPending = items.some((it) => it.status === "PENDING");
  const canPropose = canProposeReplacement(caseStatus, execStatus, hasPending);
  const alreadyExecuted = isDecisionAlreadyExecuted(caseStatus, execStatus);

  const handleOpenProposeConfirm = () => {
    const val = validateReplacementReason(proposeReason);
    if (!val.ok) {
      setProposeError(val.message ?? "Lý do chưa hợp lệ.");
      return;
    }
    setProposeError(null);
    setProposeConfirmOpen(true);
  };

  const handleProposeSubmit = async () => {
    const res = await proposeWrite.submit(
      { reason: proposeReason.trim() },
      (key, body) => disputeCaseApi.proposeReplacement(caseId, body, key),
    );
    if (res.ok) {
      setProposeReason("");
      setProposeConfirmOpen(false);
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.replacements(caseId) });
      }
      await onChanged();
    }
  };

  const handleOpenDecideConfirm = (
    item: ReplacementItem,
    action: "APPROVE" | "REJECT",
  ) => {
    const val = validateReplacementReason(decideReason);
    if (!val.ok) {
      setDecideError(val.message ?? "Lý do chưa hợp lệ.");
      return;
    }
    if (!coiChecked) {
      setDecideError("Vui lòng xác nhận không có xung đột lợi ích.");
      return;
    }
    setDecideError(null);
    setActiveItem(item);
    setDecideAction(action);
    setDecideConfirmOpen(true);
  };

  const handleDecideSubmit = async () => {
    if (!activeItem || !decideAction) return;

    const payload = {
      reason: decideReason.trim(),
      conflictOfInterestDeclaredNone: true,
    };

    const sendFn =
      decideAction === "APPROVE"
        ? (key: string, b: typeof payload) =>
            disputeCaseApi.approveReplacement(caseId, activeItem.id, b, key)
        : (key: string, b: typeof payload) =>
            disputeCaseApi.rejectReplacement(caseId, activeItem.id, b, key);

    const res = await decideWrite.submit(payload, sendFn);
    if (res.ok) {
      setDecideReason("");
      setCoiChecked(false);
      setDecideConfirmOpen(false);
      setActiveItem(null);
      setDecideAction(null);
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.replacements(caseId) });
      }
      await onChanged();
    }
  };

  return (
    <section
      className={`${CARD} space-y-4 p-4`}
      data-testid="replacement-panel"
      aria-label="Thay quyết định đã duyệt"
    >
      <div>
        <h3 className="text-base font-semibold text-adm-text">
          Thay quyết định đã duyệt
        </h3>
        <Muted>
          Khi phát hiện chứng cứ mới hoặc có sai sót, điều tra viên có thể đề
          xuất thay quyết định đã duyệt. Duyệt thay quyết định đòi hỏi nguyên tắc
          bốn mắt và không tự chuyển tiền.
        </Muted>
      </div>

      {loading && <p className="text-sm text-adm-text-2">Đang tải đề xuất thay thế...</p>}
      {error && <Notice tone="danger">{error}</Notice>}

      {/* List of replacements */}
      {items.length === 0 && !loading ? (
        <EmptyBox testId="replacement-empty">
          Chưa có đề xuất thay quyết định nào.
        </EmptyBox>
      ) : (
        <ul className="space-y-3">
          {items.map((item) => {
            const proposedByYou = isProposer(item, currentUserId);
            const canDecide = canDecideReplacement(
              item,
              currentUserId,
            );

            return (
              <li
                key={item.id}
                className="space-y-2 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm"
                data-testid={`replacement-item-${item.id}`}
              >
                <div className="flex flex-wrap items-center gap-2">
                  <Pill tone={replacementStatusTone(item.status)}>
                    {replacementStatusLabel(item.status)}
                  </Pill>
                  <span className="text-xs text-adm-text-2">
                    Lập bởi{" "}
                    {proposedByYou ? "bạn" : `mã ${shortRef(item.proposedBy)}`} ·{" "}
                    {formatDateTime(item.createdAt)}
                  </span>
                </div>

                <p className="whitespace-pre-wrap break-words text-adm-text">
                  {item.reason}
                </p>

                {(item.approvedAt || item.rejectedAt) && (
                  <p className="text-xs text-adm-text-2">
                    {item.status === "APPROVED" ? "Đã duyệt thay bởi" : "Đã bác bởi"}{" "}
                    {currentUserId && (item.approvedBy === currentUserId || item.rejectedBy === currentUserId)
                      ? "bạn"
                      : `mã ${shortRef(item.approvedBy ?? item.rejectedBy)}`}{" "}
                    · {formatDateTime(item.approvedAt ?? item.rejectedAt ?? "")}
                  </p>
                )}

                {(item.approvalReason || item.rejectionReason) && (
                  <p className="text-xs italic text-adm-text-2">
                    Lý do xử lý: {item.approvalReason || item.rejectionReason}
                  </p>
                )}

                {item.checksAtApproval && (
                  <details className="mt-2 text-xs">
                    <summary className="cursor-pointer text-adm-text-2 hover:text-adm-text">
                      Xem kiểm tra khi duyệt (snapshot)
                    </summary>
                    <div className="mt-1 space-y-1 rounded border border-adm-border-soft bg-adm-surface p-2 font-mono">
                      {item.checksAtApproval.contractStatus ? (
                        <div>Hợp đồng: {String(item.checksAtApproval.contractStatus)}</div>
                      ) : null}
                      {item.checksAtApproval.sessionStatus ? (
                        <div>Buổi tập: {String(item.checksAtApproval.sessionStatus)}</div>
                      ) : null}
                      <div className="mt-1">
                        <CompactReference
                          value={JSON.stringify(item.checksAtApproval)}
                          label="Kiểm tra duyệt"
                        />
                      </div>
                    </div>
                  </details>
                )}

                {/* Approve / Reject actions for other admins */}
                {canDecide && (
                  <div className="mt-3 space-y-2 border-t border-adm-border-soft pt-3">
                    <p className="text-xs font-semibold text-adm-text">
                      Xử lý đề xuất này (Bốn mắt):
                    </p>
                    <Field id={`decide-replacement-reason-${item.id}`} label="Lý do xử lý" required>
                      <TextArea
                        id={`decide-replacement-reason-${item.id}`}
                        rows={2}
                        value={decideReason}
                        onChange={(v) => {
                          setDecideReason(v);
                          setDecideError(null);
                        }}
                        placeholder="Nhập lý do duyệt thay thế hoặc bác đề xuất..."
                      />
                    </Field>

                    <Check
                      id={`coi-replacement-${item.id}`}
                      checked={coiChecked}
                      onChange={(v) => {
                        setCoiChecked(v);
                        setDecideError(null);
                      }}
                      label="Tôi cam kết không có xung đột lợi ích với vụ việc này."
                    />

                    {decideError && <Notice tone="danger">{decideError}</Notice>}
                    {decideWrite.error && (
                      <ErrorBox
                        error={decideWrite.error}
                        mustReload={decideWrite.mustReload}
                        reloading={decideWrite.reloading}
                        onReload={decideWrite.reload}
                        onRetry={decideWrite.retry}
                        pending={decideWrite.pending}
                      />
                    )}

                    <ButtonRow>
                      <ActionButton
                        variant="primary"
                        onClick={() => handleOpenDecideConfirm(item, "APPROVE")}
                        disabled={!coiChecked || decideWrite.pending}
                        pending={decideWrite.pending && decideAction === "APPROVE"}
                      >
                        Duyệt thay quyết định
                      </ActionButton>
                      <ActionButton
                        variant="danger"
                        onClick={() => handleOpenDecideConfirm(item, "REJECT")}
                        disabled={!coiChecked || decideWrite.pending}
                        pending={decideWrite.pending && decideAction === "REJECT"}
                      >
                        Bác đề xuất
                      </ActionButton>
                    </ButtonRow>
                  </div>
                )}

                {item.status === "PENDING" && proposedByYou && (
                  <Muted>
                    Bạn là người lập đề xuất này nên không tự duyệt hoặc bác được.
                  </Muted>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Propose Form or Already Executed note */}
      {alreadyExecuted && !hasPending && (
        <p className="text-xs text-adm-text-2" data-testid="replacement-executed-note">
          {REPLACEMENT_EXEC_EFFECT_NOTE}
        </p>
      )}

      {canPropose && (
        <div className="space-y-3 rounded-lg border border-adm-border bg-adm-surface p-3">
          <h4 className="text-sm font-semibold text-adm-text">
            Lập đề xuất thay quyết định mới
          </h4>
          <Field id="propose-replacement-reason" label="Lý do đề xuất thay thế" required>
            <TextArea
              id="propose-replacement-reason"
              rows={3}
              value={proposeReason}
              onChange={(v) => {
                setProposeReason(v);
                setProposeError(null);
              }}
              placeholder="Nêu rõ lý do cần thay thế quyết định đã duyệt..."
            />
          </Field>

          {proposeError && <Notice tone="danger">{proposeError}</Notice>}
          {proposeWrite.error && (
            <ErrorBox
              error={proposeWrite.error}
              mustReload={proposeWrite.mustReload}
              reloading={proposeWrite.reloading}
              onReload={proposeWrite.reload}
              onRetry={proposeWrite.retry}
              pending={proposeWrite.pending}
            />
          )}

          <ButtonRow>
            <ActionButton
              variant="primary"
              onClick={handleOpenProposeConfirm}
              disabled={proposeWrite.pending || !proposeReason.trim()}
              pending={proposeWrite.pending}
            >
              Gửi đề xuất thay thế
            </ActionButton>
          </ButtonRow>
        </div>
      )}

      {/* Propose confirm modal */}
      <ConfirmModal
        open={proposeConfirmOpen}
        onClose={() => setProposeConfirmOpen(false)}
        title="Xác nhận gửi đề xuất thay quyết định"
        notice={PROPOSE_REPLACEMENT_CONFIRM}
        confirmLabel="Xác nhận đề xuất"
        pendingLabel="Đang gửi..."
        pending={proposeWrite.pending}
        onConfirm={handleProposeSubmit}
        testId="confirm-propose-replacement"
      />

      {/* Decide confirm modal */}
      <ConfirmModal
        open={decideConfirmOpen}
        onClose={() => setDecideConfirmOpen(false)}
        title={
          decideAction === "APPROVE"
            ? "Xác nhận duyệt thay quyết định"
            : "Xác nhận bác đề xuất thay quyết định"
        }
        notice={
          decideAction === "APPROVE"
            ? APPROVE_REPLACEMENT_CONFIRM
            : REJECT_REPLACEMENT_CONFIRM
        }
        danger={decideAction === "APPROVE"}
        confirmLabel={
          decideAction === "APPROVE" ? "Duyệt thay quyết định" : "Bác đề xuất"
        }
        pendingLabel="Đang gửi..."
        pending={decideWrite.pending}
        onConfirm={handleDecideSubmit}
        testId="confirm-decide-replacement"
      />
    </section>
  );
}
