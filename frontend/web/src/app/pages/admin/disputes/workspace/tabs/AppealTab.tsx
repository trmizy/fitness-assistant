import { useState } from "react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { disputeCaseApi } from "../../disputeCaseApi";
import { FINDING_LABEL } from "../../disputeCaseLabels";
import {
  DISPUTE_QUERY_OPTIONS,
  useDisputeQueryKeys,
} from "../../disputeQueryKeys";
import type {
  AppealDecisionInput,
  AppealItem,
  FindingKind,
} from "../../disputeCaseTypes";
import { formatDateTime, shortRef } from "../format";
import type { ActionSlotProps } from "../actionSlots";
import { CARD, EmptyBox, Muted, Notice, Pill } from "../WorkspaceParts";
import {
  ActionButton,
  ButtonRow,
  ConfirmModal,
  ErrorBox,
  Field,
  TextArea,
  useWrite,
} from "../../actions/actionKit";
import { listAdminOptions } from "../../actions/adminDirectory";
import { QuotaCorrectionCard } from "../../actions/QuotaCorrectionCard";
import {
  CLOSE_EXECUTED_CONFIRM,
  DECIDE_APPEAL_CONFIRM,
  RES_KEEP,
  RES_NEW,
  appealPartyLabel,
  appealResultLabel,
  appealStatusLabel,
  appealStatusTone,
  canAdminDecideAppeal,
  consequenceKindLabel,
  consequenceStatusLabel,
  consequenceStatusTone,
  canRetryObligation,
  isNeedsRecon,
  filterIndependentReviewers,
  isKeepResult,
  isNewResult,
  isObligationOpen,
  appealDecisionPayload,
  type AppealResultChoice,
  type ConsequenceFormRow,
  type ResponsibleParty,
} from "../appealModel";

const ALLOWED_FINDINGS: FindingKind[] = [
  "VERIFIED_DELIVERED",
  "VERIFIED_CLIENT_ABSENT",
  "VERIFIED_PT_ABSENT",
  "VERIFIED_NOT_DELIVERED_NO_FAULT",
  "INSUFFICIENT_EVIDENCE",
  "NOT_A_DISPUTE",
];

const CAPABILITY_OFF_NOTE = "Chức năng này đang tắt ở môi trường hiện tại.";

export function AppealTab({
  detail,
  currentUserId,
  onChanged,
  capabilities,
}: ActionSlotProps) {
  const caseId = detail.case?.id ?? "";
  const allowedActions = detail.allowedActions ?? [];
  const appealsCapability = capabilities?.appeals === true;

  const { keys } = useDisputeQueryKeys();
  const queryClient = useQueryClient();

  const appealsQuery = useQuery({
    queryKey: keys ? keys.appeals(caseId) : ["dispute-case", "disabled", "appeals", caseId],
    queryFn: () => disputeCaseApi.listAppeals(caseId),
    enabled: !!keys && !!caseId,
    ...DISPUTE_QUERY_OPTIONS,
  });

  const adminsQuery = useQuery({
    queryKey: keys ? [...keys.all, "admins"] : ["dispute-case", "disabled", "admins"],
    queryFn: () => listAdminOptions(currentUserId),
    enabled: !!keys,
    ...DISPUTE_QUERY_OPTIONS,
  });

  const appeals = appealsQuery.data?.items ?? [];
  const admins = adminsQuery.data ?? [];
  const loading = appealsQuery.isLoading;
  const error = appealsQuery.error ? "Chưa tải được danh sách yêu cầu xem xét lại." : null;

  // Reviewer assignment state
  const [selectedReviewer, setSelectedReviewer] = useState<Record<string, string>>({});
  const [assignError, setAssignError] = useState<string | null>(null);

  // Reviewer decision state per appeal
  const [decideResult, setDecideResult] = useState<Record<string, AppealResultChoice>>({});
  const [decideFinding, setDecideFinding] = useState<Record<string, FindingKind>>({});
  const [decideReasoning, setDecideReasoning] = useState<Record<string, string>>({});
  const [decideConsequences, setDecideConsequences] = useState<Record<string, ConsequenceFormRow[]>>({});
  const [fieldErrors, setFieldErrors] = useState<Record<string, Record<string, string>>>({});
  const [activeDecideAppeal, setActiveDecideAppeal] = useState<AppealItem | null>(null);
  const [preparedPayload, setPreparedPayload] = useState<AppealDecisionInput | null>(null);
  const [decideConfirmOpen, setDecideConfirmOpen] = useState(false);

  // Close executed state
  const [closeReason, setCloseReason] = useState("");
  const [closeConfirmOpen, setCloseConfirmOpen] = useState(false);
  const [closeError, setCloseError] = useState<string | null>(null);

  // Writes
  const assignWrite = useWrite<{ reviewerId: string }, unknown>(onChanged);
  const decideWrite = useWrite<AppealDecisionInput, unknown>(onChanged);
  const syncWrite = useWrite<unknown, unknown>(onChanged);
  const createObligationWrite = useWrite<unknown, unknown>(onChanged);
  const closeWrite = useWrite<{ reason: string }, unknown>(onChanged);

  const canCloseExecuted = allowedActions.includes("closeExecuted");
  const appealsEnabled = detail.case?.status === "DECISION_APPROVED" || detail.case?.status === "CLOSED" || appeals.length > 0;

  if (!appealsEnabled) {
    return (
      <div className="space-y-4" data-testid="d2-tab-appeals">
        <Notice tone="info">
          Chức năng xem xét lại chỉ khả dụng sau khi hồ sơ đã có quyết định được duyệt hoặc đã đóng.
        </Notice>
      </div>
    );
  }

  // Filter excluded admins for independence
  const excludedIds = [
    detail.case?.investigatorId,
    detail.latestProposal?.proposerId,
    detail.latestApproval?.approverId,
    detail.case?.clientUserId,
    detail.case?.ptUserId,
  ];
  const { eligible: eligibleAdmins, excluded: excludedAdmins } =
    filterIndependentReviewers(admins, excludedIds);

  const handleAssignSubmit = async (appealId: string) => {
    const reviewerId = selectedReviewer[appealId];
    if (!reviewerId) {
      setAssignError("Vui lòng chọn quản trị viên độc lập.");
      return;
    }
    setAssignError(null);
    const res = await assignWrite.submit({ reviewerId }, (key, body) =>
      disputeCaseApi.assignAppealReviewer(caseId, appealId, body, key),
    );
    if (res.ok) {
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.appeals(caseId) });
      }
      await onChanged();
    }
  };

  const addConsequenceRow = (appealId: string) => {
    const current = decideConsequences[appealId] ?? [];
    if (current.length >= 3) return;
    const newRow: ConsequenceFormRow = {
      id: `c_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      kind: "MONEY",
      note: "",
      amountVnd: "",
      responsibleParty: "",
    };
    setDecideConsequences({
      ...decideConsequences,
      [appealId]: [...current, newRow],
    });
  };

  const removeConsequenceRow = (appealId: string, rowId: string) => {
    const current = decideConsequences[appealId] ?? [];
    setDecideConsequences({
      ...decideConsequences,
      [appealId]: current.filter((r) => r.id !== rowId),
    });
  };

  const updateConsequenceRow = (
    appealId: string,
    rowId: string,
    patch: Partial<ConsequenceFormRow>,
  ) => {
    const current = decideConsequences[appealId] ?? [];
    setDecideConsequences({
      ...decideConsequences,
      [appealId]: current.map((r) => (r.id === rowId ? { ...r, ...patch } : r)),
    });
  };

  const handleOpenDecideConfirm = (appeal: AppealItem) => {
    const resType = decideResult[appeal.id] ?? RES_KEEP;
    const reasoning = decideReasoning[appeal.id] ?? "";
    const finding = isNewResult(resType) ? (decideFinding[appeal.id] ?? "VERIFIED_PT_ABSENT") : undefined;
    const consequences = isNewResult(resType) ? (decideConsequences[appeal.id] ?? []) : undefined;

    const outcome = appealDecisionPayload({
      result: resType,
      reasoning,
      finding,
      consequences,
    });

    if (!outcome.ok) {
      setFieldErrors({
        ...fieldErrors,
        [appeal.id]: outcome.errors ?? {},
      });
      return;
    }

    setFieldErrors({
      ...fieldErrors,
      [appeal.id]: {},
    });
    setPreparedPayload(outcome.payload!);
    setActiveDecideAppeal(appeal);
    setDecideConfirmOpen(true);
  };

  const handleDecideSubmit = async () => {
    if (!activeDecideAppeal || !preparedPayload) return;
    const appealId = activeDecideAppeal.id;

    const res = await decideWrite.submit(preparedPayload, (key, body) =>
      disputeCaseApi.decideAppeal(caseId, appealId, body, key),
    );

    if (res.ok) {
      setDecideConfirmOpen(false);
      setActiveDecideAppeal(null);
      setPreparedPayload(null);
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.appeals(caseId) });
      }
      await onChanged();
    }
  };

  const handleSyncObligation = async (consequenceId: string) => {
    const res = await syncWrite.submit({}, (key) =>
      disputeCaseApi.syncAppealObligation(caseId, consequenceId, key),
    );
    if (res.ok) {
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.appeals(caseId) });
      }
      await onChanged();
    }
  };

  const handleCreateObligation = async (consequenceId: string) => {
    const res = await createObligationWrite.submit({}, (key) =>
      disputeCaseApi.createAppealObligation(caseId, consequenceId, key),
    );
    if (res.ok) {
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.appeals(caseId) });
      }
      await onChanged();
    }
  };

  const handleCloseSubmit = async () => {
    const trimmed = closeReason.trim();
    if (!trimmed) {
      setCloseError("Vui lòng nhập lý do đóng hồ sơ.");
      return;
    }
    setCloseError(null);
    const res = await closeWrite.submit({ reason: trimmed }, (key, body) =>
      disputeCaseApi.closeExecuted(caseId, body, key),
    );
    if (res.ok) {
      setCloseConfirmOpen(false);
      setCloseReason("");
      if (keys) {
        await queryClient.invalidateQueries({ queryKey: keys.appeals(caseId) });
      }
      await onChanged();
    }
  };

  return (
    <div className="space-y-4" data-testid="d2-tab-appeals">
      <div>
        <h3 className="text-base font-semibold text-adm-text">
          Xem xét lại sau phán quyết
        </h3>
        <Muted>
          Khi một bên yêu cầu xem xét lại, quản trị viên phân công một người
          độc lập đánh giá lại. Người xem xét ghi nhận kết luận mới hoặc giữ
          nguyên kết luận. Kết luận mới không tự chuyển tiền.
        </Muted>
      </div>

      {loading && <p className="text-sm text-adm-text-2">Đang tải yêu cầu xem xét lại...</p>}
      {error && <Notice tone="danger">{error}</Notice>}

      {/* List of appeals */}
      {appeals.length === 0 && !loading ? (
        <EmptyBox testId="appeals-empty">
          Chưa có yêu cầu xem xét lại nào từ các bên.
        </EmptyBox>
      ) : (
        <div className="space-y-4">
          {appeals.map((item) => {
            const isAssignedToYou = canAdminDecideAppeal(item, currentUserId);
            const currentResType = decideResult[item.id] ?? RES_KEEP;
            const itemErrors = fieldErrors[item.id] ?? {};
            const itemConsequences = decideConsequences[item.id] ?? [];

            return (
              <section
                key={item.id}
                className={`${CARD} space-y-3 p-4`}
                data-testid={`appeal-item-${item.id}`}
                aria-label={`Yêu cầu xem xét lại từ ${appealPartyLabel(item.partyRole)}`}
              >
                <div className="flex flex-wrap items-center justify-between gap-2 border-b border-adm-border-soft pb-2">
                  <div className="flex items-center gap-2">
                    <Pill tone={appealStatusTone(item.status)}>
                      {appealStatusLabel(item.status)}
                    </Pill>
                    <span className="text-xs font-semibold text-adm-text">
                      Bên yêu cầu: {appealPartyLabel(item.partyRole)}
                    </span>
                  </div>
                  <span className="text-xs text-adm-text-2">
                    Gửi lúc {formatDateTime(item.createdAt)}
                  </span>
                </div>

                <div className="text-sm">
                  <p className="text-xs font-medium text-adm-text-2">Lý do yêu cầu:</p>
                  <p className="mt-1 whitespace-pre-wrap break-words text-adm-text">
                    {item.reason}
                  </p>
                </div>

                {/* Reviewer info */}
                <div className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-xs text-adm-text">
                  <span className="text-adm-text-2">Người xem xét lại: </span>
                  {item.reviewerId ? (
                    <span className="font-medium text-adm-text">
                      {currentUserId && item.reviewerId === currentUserId
                        ? "Bạn (Quản trị viên được phân công)"
                        : `Mã ${shortRef(item.reviewerId)}`}
                    </span>
                  ) : (
                    <span className="italic text-adm-text-2">Chưa phân công</span>
                  )}
                  {item.reviewerAssignedBy && ` · Phân công bởi ${shortRef(item.reviewerAssignedBy)}`}
                </div>

                {/* Decision outcome if decided */}
                {item.status === "DECIDED" && (
                  <div className="space-y-2 rounded-lg border border-adm-border-soft bg-adm-surface p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-adm-text">Kết quả:</span>
                      <Pill tone={isKeepResult(item.result) ? "info" : "success"}>
                        {appealResultLabel(item.result)}
                      </Pill>
                    </div>

                    {(item.newFindingId || item.finding) && (
                      <p className="text-xs text-adm-text-2">
                        Kết luận mới:{" "}
                        <span className="font-semibold text-adm-text">
                          {item.finding && FINDING_LABEL[item.finding]
                            ? FINDING_LABEL[item.finding]
                            : (item.finding ?? `Mã ${shortRef(item.newFindingId)}`)}
                        </span>
                      </p>
                    )}

                    {item.reasoning && (
                      <p className="whitespace-pre-wrap break-words text-adm-text">
                        Lập luận: {item.reasoning}
                      </p>
                    )}

                    {item.decidedAt && (
                      <p className="text-xs text-adm-text-2">
                        Quyết định lúc {formatDateTime(item.decidedAt)} bởi{" "}
                        {item.decidedBy
                          ? `mã ${shortRef(item.decidedBy)}`
                          : item.reviewerId
                            ? `mã ${shortRef(item.reviewerId)}`
                            : "quản trị viên"}
                      </p>
                    )}

                    {/* Consequences */}
                    {item.consequences && item.consequences.length > 0 && (
                      <div className="mt-3 space-y-2 border-t border-adm-border-soft pt-2">
                        <p className="text-xs font-semibold text-adm-text">
                          Hệ quả phán quyết:
                        </p>
                        <ul className="space-y-1.5 text-xs">
                          {item.consequences.map((c) => (
                            <li
                              key={c.id}
                              className="rounded border border-adm-border-soft bg-adm-surface-2 p-2"
                            >
                              <div className="flex items-center justify-between">
                                <span className="font-medium text-adm-text">
                                  {consequenceKindLabel(c.kind)}
                                </span>
                                <Pill tone={consequenceStatusTone(c.status)}>
                                  {consequenceStatusLabel(c.status)}
                                </Pill>
                              </div>
                              {isObligationOpen(c.status) && (
                                <div className="mt-2 flex items-center justify-between">
                                  <span className="text-adm-text-2">
                                    Khoản phải trả chưa thanh toán
                                  </span>
                                  {appealsCapability ? (
                                    <ActionButton
                                      variant="outline"
                                      onClick={() => handleSyncObligation(c.id)}
                                      disabled={syncWrite.pending}
                                      pending={syncWrite.pending}
                                    >
                                      Cập nhật trạng thái nghĩa vụ
                                    </ActionButton>
                                  ) : (
                                    <span className="text-xs text-adm-text-2">
                                      {CAPABILITY_OFF_NOTE}
                                    </span>
                                  )}
                                </div>
                              )}
                              {c.kind === "MONEY" && isNeedsRecon(c.status) && (
                                <div className="mt-2">
                                  {canRetryObligation(c) ? (
                                    <div className="flex items-center justify-between">
                                      <span className="text-adm-text-2">
                                        Chờ đối soát tiền
                                      </span>
                                      {appealsCapability ? (
                                        <ActionButton
                                          variant="outline"
                                          onClick={() => handleCreateObligation(c.id)}
                                          disabled={createObligationWrite.pending}
                                          pending={createObligationWrite.pending}
                                        >
                                          Thử tạo lại khoản phải trả
                                        </ActionButton>
                                      ) : (
                                        <span className="text-xs text-adm-text-2">
                                          {CAPABILITY_OFF_NOTE}
                                        </span>
                                      )}
                                    </div>
                                  ) : (
                                    <p className="text-xs text-adm-text-2">
                                      Chưa xác lập số tiền và bên chịu trách nhiệm: không có khoản phải trả nào để tạo. Hệ quả chờ đối soát.
                                    </p>
                                  )}
                                </div>
                              )}
                              {c.kind === "QUOTA" && (c.status === "OPEN" || (c.quotaCorrections ?? []).some((q) => q.appliedAt)) && (
                                <QuotaCorrectionCard
                                  caseId={caseId}
                                  consequence={c}
                                  currentUserId={currentUserId}
                                  onChanged={onChanged}
                                  appealsCapability={appealsCapability}
                                />
                              )}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                  </div>
                )}

                {/* Assignment section */}
                {item.status === "REQUESTED" && (
                  appealsCapability ? (
                    <div className="space-y-3 rounded-lg border border-adm-border bg-adm-surface p-3">
                      <h4 className="text-sm font-semibold text-adm-text">
                        Phân công người xem xét độc lập
                      </h4>
                      <p className="text-xs text-adm-text-2">
                        Người xem xét phải độc lập: chưa từng lập đề xuất, chưa
                        từng duyệt và không phải điều tra viên của vụ việc.
                      </p>

                      <Field id={`assign-reviewer-${item.id}`} label="Chọn quản trị viên độc lập" required>
                        <select
                          id={`assign-reviewer-${item.id}`}
                          className="block w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-2 text-sm text-adm-text"
                          value={selectedReviewer[item.id] ?? ""}
                          onChange={(e) => {
                            setSelectedReviewer({
                              ...selectedReviewer,
                              [item.id]: e.target.value,
                            });
                            setAssignError(null);
                          }}
                        >
                          <option value="">-- Chọn quản trị viên --</option>
                          {eligibleAdmins.map((adm) => (
                            <option key={adm.id} value={adm.id}>
                              {adm.label ?? adm.displayName} ({shortRef(adm.id)})
                            </option>
                          ))}
                        </select>
                      </Field>

                      {excludedAdmins.length > 0 && (
                        <p className="text-xs text-adm-text-2">
                          Đã loại trừ {excludedAdmins.length} người do có vai trò trong hồ sơ.
                        </p>
                      )}

                      {assignError && <Notice tone="danger">{assignError}</Notice>}
                      {assignWrite.error && (
                        <ErrorBox
                          error={assignWrite.error}
                          mustReload={assignWrite.mustReload}
                          reloading={assignWrite.reloading}
                          onReload={assignWrite.reload}
                          onRetry={assignWrite.retry}
                          pending={assignWrite.pending}
                        />
                      )}

                      <ButtonRow>
                        <ActionButton
                          variant="primary"
                          onClick={() => handleAssignSubmit(item.id)}
                          disabled={!selectedReviewer[item.id] || assignWrite.pending}
                          pending={assignWrite.pending}
                        >
                          Giao người xem xét lại
                        </ActionButton>
                      </ButtonRow>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm text-adm-text-2">
                      {CAPABILITY_OFF_NOTE}
                    </div>
                  )
                )}

                {/* Decide section: for assigned reviewer only */}
                {item.status === "UNDER_REVIEW" && isAssignedToYou && (
                  appealsCapability ? (
                    <div className="space-y-3 rounded-lg border border-adm-border bg-adm-surface p-3">
                      <h4 className="text-sm font-semibold text-adm-text">
                        Ghi nhận kết quả xem xét lại (Dành cho bạn)
                      </h4>

                      <Field id={`result-field-${item.id}`} label="Kết quả phán quyết" required>
                        <div className="flex flex-wrap gap-4 pt-1">
                          <label className="inline-flex items-center gap-2 text-sm text-adm-text">
                            <input
                              type="radio"
                              name={`result-${item.id}`}
                              value={RES_KEEP}
                              checked={isKeepResult(currentResType)}
                              onChange={() =>
                                setDecideResult({
                                  ...decideResult,
                                  [item.id]: RES_KEEP,
                                })
                              }
                            />
                            Giữ nguyên kết luận
                          </label>
                          <label className="inline-flex items-center gap-2 text-sm text-adm-text">
                            <input
                              type="radio"
                              name={`result-${item.id}`}
                              value={RES_NEW}
                              checked={isNewResult(currentResType)}
                              onChange={() =>
                                setDecideResult({
                                  ...decideResult,
                                  [item.id]: RES_NEW,
                                })
                              }
                            />
                            Có kết luận mới
                          </label>
                        </div>
                      </Field>

                      {isNewResult(currentResType) && (
                        <div className="space-y-3 border-t border-adm-border-soft pt-3">
                          <Field id={`finding-field-${item.id}`} label="Kết luận mới" required>
                            <select
                              id={`finding-field-${item.id}`}
                              className="block w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-2 text-sm text-adm-text"
                              value={decideFinding[item.id] ?? "VERIFIED_PT_ABSENT"}
                              onChange={(e) =>
                                setDecideFinding({
                                  ...decideFinding,
                                  [item.id]: e.target.value as FindingKind,
                                })
                              }
                            >
                              {ALLOWED_FINDINGS.map((fk) => (
                                <option key={fk} value={fk}>
                                  {FINDING_LABEL[fk]}
                                </option>
                              ))}
                            </select>
                          </Field>
                          {itemErrors.finding && (
                            <p className="text-xs text-st-danger">{itemErrors.finding}</p>
                          )}

                          {/* Consequence Editor (FIX-1) */}
                          <div className="space-y-3 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3">
                            <div className="flex items-center justify-between">
                              <span className="text-xs font-semibold text-adm-text">
                                Hệ quả phán quyết (tối đa 3 hệ quả):
                              </span>
                              <button
                                type="button"
                                className="rounded border border-adm-border bg-adm-surface px-2.5 py-1 text-xs font-medium text-adm-text hover:bg-adm-surface-hover disabled:opacity-50"
                                disabled={itemConsequences.length >= 3}
                                onClick={() => addConsequenceRow(item.id)}
                              >
                                + Thêm hệ quả
                              </button>
                            </div>

                            {itemErrors.consequences && (
                              <p className="text-xs text-st-danger">{itemErrors.consequences}</p>
                            )}

                            {itemConsequences.length === 0 ? (
                              <p className="text-xs italic text-adm-text-2">
                                Chưa có hệ quả nào. Bấm &quot;+ Thêm hệ quả&quot; để bổ sung hệ quả tiền, quyền buổi hoặc lỗi PT.
                              </p>
                            ) : (
                              <div className="space-y-3">
                                {itemConsequences.map((row, idx) => {
                                  const noteErr = itemErrors[`consequence_${idx}_note`];
                                  const moneyErr = itemErrors[`consequence_${idx}_money`];
                                  const amountErr = itemErrors[`consequence_${idx}_amount`];
                                  const partyErr = itemErrors[`consequence_${idx}_party`];
                                  const ruleB2Err = itemErrors[`consequence_${idx}_ruleB2`];

                                  return (
                                    <div
                                      key={row.id}
                                      className="space-y-2 rounded-md border border-adm-border bg-adm-surface p-3"
                                    >
                                      <div className="flex items-center justify-between">
                                        <span className="text-xs font-semibold text-adm-text">
                                          Hệ quả #{idx + 1}
                                        </span>
                                        <button
                                          type="button"
                                          className="text-xs text-st-danger hover:underline"
                                          onClick={() => removeConsequenceRow(item.id, row.id)}
                                        >
                                          Xóa
                                        </button>
                                      </div>

                                      <div className="grid grid-cols-1 gap-2 sm:grid-cols-3">
                                        <Field id={`kind-${row.id}`} label="Loại hệ quả" required>
                                          <select
                                            id={`kind-${row.id}`}
                                            className="block w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-1.5 text-sm text-adm-text"
                                            value={row.kind}
                                            onChange={(e) =>
                                              updateConsequenceRow(item.id, row.id, {
                                                kind: e.target.value as "MONEY" | "QUOTA" | "PT_AT_FAULT",
                                              })
                                            }
                                          >
                                            <option value="MONEY">Tiền</option>
                                            <option value="QUOTA">Quyền buổi tập</option>
                                            <option value="PT_AT_FAULT">PT có lỗi</option>
                                          </select>
                                        </Field>
                                        <div className="sm:col-span-2">
                                          <Field id={`note-${row.id}`} label="Ghi chú hệ quả" required>
                                            <input
                                              id={`note-${row.id}`}
                                              type="text"
                                              className="block w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-1.5 text-sm text-adm-text"
                                              placeholder="Ghi chú hệ quả (1..2000 ký tự)..."
                                              value={row.note}
                                              onChange={(e) =>
                                                updateConsequenceRow(item.id, row.id, {
                                                  note: e.target.value,
                                                })
                                              }
                                            />
                                          </Field>
                                          {noteErr && (
                                            <p className="mt-1 text-xs text-st-danger">{noteErr}</p>
                                          )}
                                        </div>
                                      </div>

                                      {row.kind === "MONEY" && (
                                        <div className="mt-2 space-y-2 rounded border border-adm-border-soft bg-adm-surface-2 p-2.5">
                                          <p className="text-xs text-adm-text-2">
                                            Chỉ ghi số tiền khi kết luận đã xác lập rõ số tiền và bên chịu trách nhiệm.
                                            Bỏ trống thì hệ quả chuyển sang chờ đối soát, không tạo khoản nợ.
                                          </p>

                                          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                                            <div>
                                              <Field id={`amt-${row.id}`} label="Số tiền VND (tùy chọn)">
                                                <input
                                                  id={`amt-${row.id}`}
                                                  type="number"
                                                  min="1"
                                                  max="10000000000"
                                                  className="block w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-1.5 text-sm text-adm-text"
                                                  placeholder="Để trống nếu chưa rõ..."
                                                  value={row.amountVnd ?? ""}
                                                  onChange={(e) =>
                                                    updateConsequenceRow(item.id, row.id, {
                                                      amountVnd: e.target.value,
                                                    })
                                                  }
                                                />
                                              </Field>
                                              {amountErr && (
                                                <p className="mt-1 text-xs text-st-danger">{amountErr}</p>
                                              )}
                                            </div>

                                            <div>
                                              <Field id={`party-${row.id}`} label="Bên chịu trách nhiệm">
                                                <select
                                                  id={`party-${row.id}`}
                                                  className="block w-full rounded-lg border border-adm-border bg-adm-surface px-3 py-1.5 text-sm text-adm-text"
                                                  value={row.responsibleParty ?? ""}
                                                  onChange={(e) =>
                                                    updateConsequenceRow(item.id, row.id, {
                                                      responsibleParty: e.target.value as ResponsibleParty | "",
                                                    })
                                                  }
                                                >
                                                  <option value="">-- Để trống nếu chưa rõ --</option>
                                                  <option value="PT">PT</option>
                                                  <option value="GYM">Phòng tập</option>
                                                  <option value="PLATFORM">Nền tảng</option>
                                                </select>
                                              </Field>
                                              {partyErr && (
                                                <p className="mt-1 text-xs text-st-danger">{partyErr}</p>
                                              )}
                                            </div>
                                          </div>

                                          {moneyErr && (
                                            <p className="text-xs text-st-danger">{moneyErr}</p>
                                          )}
                                          {ruleB2Err && (
                                            <p className="text-xs text-st-danger">{ruleB2Err}</p>
                                          )}
                                        </div>
                                      )}
                                    </div>
                                  );
                                })}
                              </div>
                            )}
                          </div>
                        </div>
                      )}

                      <Field id={`reasoning-field-${item.id}`} label="Lập luận giải quyết" required>
                        <TextArea
                          id={`reasoning-field-${item.id}`}
                          rows={3}
                          value={decideReasoning[item.id] ?? ""}
                          onChange={(v) => {
                            setDecideReasoning({
                              ...decideReasoning,
                              [item.id]: v,
                            });
                          }}
                          placeholder="Nêu rõ căn cứ và lập luận cho quyết định xem xét lại..."
                        />
                      </Field>
                      {itemErrors.reasoning && (
                        <p className="text-xs text-st-danger">{itemErrors.reasoning}</p>
                      )}

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
                          onClick={() => handleOpenDecideConfirm(item)}
                          disabled={decideWrite.pending}
                          pending={decideWrite.pending}
                        >
                          Ghi nhận kết quả xem xét lại
                        </ActionButton>
                      </ButtonRow>
                    </div>
                  ) : (
                    <div className="rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3 text-sm text-adm-text-2">
                      {CAPABILITY_OFF_NOTE}
                    </div>
                  )
                )}

                {item.status === "UNDER_REVIEW" && !isAssignedToYou && (
                  <Muted>
                    Hồ sơ đang chờ người xem xét lại được phân công ghi nhận kết quả.
                  </Muted>
                )}
              </section>
            );
          })}
        </div>
      )}

      {/* Close Executed section */}
      {canCloseExecuted && (
        <section
          className={`${CARD} space-y-3 p-4`}
          data-testid="close-executed-section"
        >
          <h3 className="text-base font-semibold text-adm-text">
            Đóng hồ sơ đã thực thi
          </h3>
          <Muted>
            Thao tác này chỉ dành cho hồ sơ đã có quyết định duyệt và thực thi
            xong phần nghiệp vụ. Đóng hồ sơ không chuyển tiền, không đổi buổi tập
            và không thể mở lại.
          </Muted>

          <Field id="close-executed-reason" label="Lý do đóng hồ sơ" required>
            <TextArea
              id="close-executed-reason"
              rows={2}
              value={closeReason}
              onChange={(v) => {
                setCloseReason(v);
                setCloseError(null);
              }}
              placeholder="Nhập lý do đóng hồ sơ đã thực thi..."
            />
          </Field>

          {closeError && <Notice tone="danger">{closeError}</Notice>}
          {closeWrite.error && (
            <ErrorBox
              error={closeWrite.error}
              mustReload={closeWrite.mustReload}
              reloading={closeWrite.reloading}
              onReload={closeWrite.reload}
              onRetry={closeWrite.retry}
              pending={closeWrite.pending}
            />
          )}

          <ButtonRow>
            <ActionButton
              variant="danger"
              onClick={() => {
                if (!closeReason.trim()) {
                  setCloseError("Vui lòng nhập lý do đóng hồ sơ.");
                  return;
                }
                setCloseError(null);
                setCloseConfirmOpen(true);
              }}
              disabled={closeWrite.pending || !closeReason.trim()}
              pending={closeWrite.pending}
            >
              Đóng hồ sơ đã thực thi
            </ActionButton>
          </ButtonRow>
        </section>
      )}

      {/* Decide confirm modal */}
      <ConfirmModal
        open={decideConfirmOpen}
        onClose={() => {
          setDecideConfirmOpen(false);
          setActiveDecideAppeal(null);
          setPreparedPayload(null);
        }}
        title="Xác nhận kết quả xem xét lại"
        notice={DECIDE_APPEAL_CONFIRM}
        confirmLabel="Lưu kết quả xem xét lại"
        pendingLabel="Đang gửi..."
        pending={decideWrite.pending}
        onConfirm={handleDecideSubmit}
        testId="confirm-decide-appeal"
      />

      {/* Close executed confirm modal */}
      <ConfirmModal
        open={closeConfirmOpen}
        onClose={() => setCloseConfirmOpen(false)}
        title="Xác nhận đóng hồ sơ"
        notice={CLOSE_EXECUTED_CONFIRM}
        danger
        confirmLabel="Xác nhận đóng hồ sơ"
        pendingLabel="Đang gửi..."
        pending={closeWrite.pending}
        onConfirm={handleCloseSubmit}
        testId="confirm-close-executed"
      />
    </div>
  );
}
