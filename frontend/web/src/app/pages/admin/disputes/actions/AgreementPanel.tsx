import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { disputeCaseApi } from "../disputeCaseApi";
import {
  DISPUTE_QUERY_OPTIONS,
  useDisputeQueryKeys,
} from "../disputeQueryKeys";
import type { AgreementItem, AgreementOutcome } from "../disputeCaseTypes";
import type { ActionSlotProps } from "../workspace/actionSlots";
import { formatDateTime, shortRef } from "../workspace/format";
import { CARD, EmptyBox, Muted, Notice, Pill } from "../workspace/WorkspaceParts";
import { CompactReference } from "../shared/CompactReference";
import {
  ActionButton,
  ButtonRow,
  ConfirmModal,
  ErrorBox,
  Field,
  TextArea,
  useWrite,
} from "./actionKit";
import {
  allowedFor,
  isAllowed,
  refusalMessage,
  verdictOf,
} from "./actionModel";
import {
  PROPOSE_AGREEMENT_CONFIRM,
  RECORD_FINDING_AGREEMENT_CONFIRM,
  WITHDRAW_AGREEMENT_CONFIRM,
  agreementOutcomeLabel,
  agreementStatusLabel,
  agreementStatusTone,
  validateAgreementProposal,
} from "../workspace/agreementModel";

export function AgreementPanel({
  detail,
  currentUserId: _currentUserId,
  onChanged,
  capabilities: _capabilities,
}: ActionSlotProps) {
  const caseId = detail.case?.id ?? "";

  const { keys } = useDisputeQueryKeys();
  const queryClient = useQueryClient();

  const agreementsQuery = useQuery({
    queryKey: keys ? keys.agreements(caseId) : ["dispute-case", "disabled", "agreements", caseId],
    queryFn: () => disputeCaseApi.listAgreements(caseId),
    enabled: !!keys && !!caseId,
    ...DISPUTE_QUERY_OPTIONS,
  });

  const agreements = agreementsQuery.data?.items ?? detail.agreements ?? [];
  const loading = agreementsQuery.isLoading;

  // Propose form state
  const [outcome, setOutcome] = useState("");
  const [note, setNote] = useState("");
  const [formError, setFormError] = useState<string | null>(null);
  const [proposeConfirmOpen, setProposeConfirmOpen] = useState(false);

  // Active item for actions
  const [activeItem, setActiveItem] = useState<AgreementItem | null>(null);
  const [withdrawConfirmOpen, setWithdrawConfirmOpen] = useState(false);
  const [recordFindingConfirmOpen, setRecordFindingConfirmOpen] = useState(false);

  // Writes
  const proposeWrite = useWrite<{ outcome: AgreementOutcome; note: string }, unknown>(onChanged);
  const withdrawWrite = useWrite<unknown, unknown>(onChanged);
  const recordFindingWrite = useWrite<unknown, unknown>(onChanged);

  const proposeVerdict = verdictOf(detail, "proposeAgreement");
  const allowedOutcomes = Array.isArray(proposeVerdict?.options)
    ? proposeVerdict.options
    : [];

  const handleProposeClick = () => {
    const val = validateAgreementProposal(outcome, note);
    if (!val.ok) {
      setFormError(val.error ?? "Dữ liệu chưa hợp lệ.");
      return;
    }
    setFormError(null);
    setProposeConfirmOpen(true);
  };

  const handleProposeSubmit = async () => {
    const res = await proposeWrite.submit(
      { outcome: outcome as AgreementOutcome, note: note.trim() },
      (key, body) => disputeCaseApi.proposeAgreement(caseId, body, key),
    );
    if (res.ok) {
      setProposeConfirmOpen(false);
      setNote("");
      setOutcome("");
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.agreements(caseId) });
      }
      await onChanged();
    }
  };

  const handleWithdrawSubmit = async () => {
    if (!activeItem) return;
    const res = await withdrawWrite.submit({}, (key) =>
      disputeCaseApi.withdrawAgreement(caseId, activeItem.id, key),
    );
    if (res.ok) {
      setWithdrawConfirmOpen(false);
      setActiveItem(null);
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.agreements(caseId) });
      }
      await onChanged();
    }
  };

  const handleRecordFindingSubmit = async () => {
    if (!activeItem) return;
    const res = await recordFindingWrite.submit({}, (key) =>
      disputeCaseApi.recordAgreementFinding(caseId, activeItem.id, key),
    );
    if (res.ok) {
      setRecordFindingConfirmOpen(false);
      setActiveItem(null);
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.agreements(caseId) });
      }
      await onChanged();
    }
  };

  return (
    <section className={`${CARD} space-y-4 p-4`} data-testid="agreement-panel">
      <div>
        <h3 className="text-base font-semibold text-adm-text">
          Phương án thoả thuận chung
        </h3>
        <Muted>
          Điều tra viên có thể đề xuất phương án thoả thuận chung để cả hai bên
          cùng xác nhận. Khi cả hai bên cùng xác nhận, điều tra viên có thể ghi
          nhận kết luận theo phương án thoả thuận này. Thoả thuận không tự
          thực thi và không chuyển tiền.
        </Muted>
      </div>

      {loading && <p className="text-sm text-adm-text-2">Đang tải danh sách thoả thuận...</p>}

      {/* Existing agreements */}
      {agreements.length === 0 && !loading ? (
        <EmptyBox testId="agreements-empty">
          Chưa có phương án thoả thuận nào trong hồ sơ này.
        </EmptyBox>
      ) : (
        <ul className="space-y-3">
          {agreements.map((item) => {
            const mayWithdraw = allowedFor(detail, "withdrawAgreement", item.id);
            const mayRecord = allowedFor(detail, "recordAgreementFinding", item.id);

            const clientConf = (item.confirmations ?? []).find(
              (c) => c.partyRole === "CLIENT",
            );
            const ptConf = (item.confirmations ?? []).find(
              (c) => c.partyRole === "PT",
            );

            return (
              <li
                key={item.id}
                className="space-y-2 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm"
                data-testid={`agreement-item-${item.id}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-adm-border-soft pb-2">
                  <div className="flex items-center gap-2">
                    <Pill tone={agreementStatusTone(item.status)}>
                      {agreementStatusLabel(item.status)}
                    </Pill>
                    <span className="font-medium text-adm-text">
                      {agreementOutcomeLabel(item.outcome)}
                    </span>
                  </div>
                  <span className="text-xs text-adm-text-2">
                    Tạo lúc {formatDateTime(item.createdAt)}
                  </span>
                </div>

                <p className="whitespace-pre-wrap break-words text-adm-text">
                  Ghi chú: {item.note}
                </p>

                <div className="flex flex-wrap items-center gap-4 text-xs text-adm-text-2">
                  <span>
                    Khách:{" "}
                    <strong className={clientConf ? "text-adm-text" : "font-normal italic text-adm-text-2"}>
                      {clientConf ? `Đã xác nhận (${formatDateTime(clientConf.confirmedAt)})` : "Chưa xác nhận"}
                    </strong>
                  </span>
                  <span>·</span>
                  <span>
                    PT:{" "}
                    <strong className={ptConf ? "text-adm-text" : "font-normal italic text-adm-text-2"}>
                      {ptConf ? `Đã xác nhận (${formatDateTime(ptConf.confirmedAt)})` : "Chưa xác nhận"}
                    </strong>
                  </span>
                </div>

                <div className="text-xs text-adm-text-2">
                  <span>Mã nội dung: </span>
                  <CompactReference value={item.contentHash} label="Mã thoả thuận" />
                </div>

                {item.findingId && (
                  <p className="text-xs text-adm-text-2">
                    Đã ghi vào kết luận: mã {shortRef(item.findingId)}
                  </p>
                )}

                {/* Actions on this agreement */}
                {(mayWithdraw || mayRecord) && (
                  <div className="flex flex-wrap items-center gap-2 border-t border-adm-border-soft pt-2">
                    {mayRecord && (
                      <ActionButton
                        variant="primary"
                        onClick={() => {
                          setActiveItem(item);
                          setRecordFindingConfirmOpen(true);
                        }}
                        disabled={recordFindingWrite.pending}
                        pending={recordFindingWrite.pending}
                      >
                        Ghi kết luận theo thoả thuận
                      </ActionButton>
                    )}
                    {mayWithdraw && (
                      <ActionButton
                        variant="outline"
                        onClick={() => {
                          setActiveItem(item);
                          setWithdrawConfirmOpen(true);
                        }}
                        disabled={withdrawWrite.pending}
                        pending={withdrawWrite.pending}
                      >
                        Rút phương án thoả thuận
                      </ActionButton>
                    )}
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      )}

      {/* Propose Form */}
      {isAllowed(detail, "proposeAgreement") ? (
        <div className="space-y-3 rounded-lg border border-adm-border bg-adm-surface p-3">
          <h4 className="text-sm font-semibold text-adm-text">
            Lập phương án thoả thuận mới
          </h4>

          <Field id="agreement-outcome" label="Kết quả đề xuất thoả thuận" required>
            <select
              id="agreement-outcome"
              className="block w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-2 text-sm text-adm-text"
              value={outcome}
              onChange={(e) => setOutcome(e.target.value)}
            >
              <option value="">-- Chọn kết quả --</option>
              {allowedOutcomes.map((o) => (
                <option key={o} value={o}>
                  {agreementOutcomeLabel(o)}
                </option>
              ))}
            </select>
          </Field>

          <Field id="agreement-note" label="Ghi chú thoả thuận" required>
            <TextArea
              id="agreement-note"
              rows={3}
              value={note}
              onChange={(v) => {
                setNote(v);
                setFormError(null);
              }}
              placeholder="Nêu rõ phương án thoả thuận để hai bên cùng xem xét xác nhận..."
            />
          </Field>

          {formError && <Notice tone="danger">{formError}</Notice>}
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
              onClick={handleProposeClick}
              disabled={proposeWrite.pending || !note.trim() || !outcome}
              pending={proposeWrite.pending}
            >
              Đề xuất phương án thoả thuận
            </ActionButton>
          </ButtonRow>
        </div>
      ) : refusalMessage(detail, "proposeAgreement") ? (
        <p className="text-xs text-adm-text-2">
          {refusalMessage(detail, "proposeAgreement")}
        </p>
      ) : null}

      {/* Propose confirm modal */}
      <ConfirmModal
        open={proposeConfirmOpen}
        onClose={() => setProposeConfirmOpen(false)}
        title="Xác nhận đề xuất phương án thoả thuận"
        notice={PROPOSE_AGREEMENT_CONFIRM}
        confirmLabel="Gửi đề xuất thoả thuận"
        pendingLabel="Đang gửi..."
        pending={proposeWrite.pending}
        onConfirm={handleProposeSubmit}
        testId="confirm-propose-agreement"
      />

      {/* Withdraw confirm modal */}
      <ConfirmModal
        open={withdrawConfirmOpen}
        onClose={() => {
          setWithdrawConfirmOpen(false);
          setActiveItem(null);
        }}
        title="Xác nhận rút phương án thoả thuận"
        notice={WITHDRAW_AGREEMENT_CONFIRM}
        danger
        confirmLabel="Rút phương án"
        pendingLabel="Đang gửi..."
        pending={withdrawWrite.pending}
        onConfirm={handleWithdrawSubmit}
        testId="confirm-withdraw-agreement"
      />

      {/* Record finding confirm modal */}
      <ConfirmModal
        open={recordFindingConfirmOpen}
        onClose={() => {
          setRecordFindingConfirmOpen(false);
          setActiveItem(null);
        }}
        title="Ghi nhận kết luận theo thoả thuận"
        notice={RECORD_FINDING_AGREEMENT_CONFIRM}
        confirmLabel="Ghi nhận kết luận"
        pendingLabel="Đang gửi..."
        pending={recordFindingWrite.pending}
        onConfirm={handleRecordFindingSubmit}
        testId="confirm-record-finding-agreement"
      />
    </section>
  );
}

