/**
 * D7 - chip "Bồi thường đến muộn" of Tài chính › Đối soát: the late-open reconciliation queue (L1) and one row (L2) with the person-driven,
 * four-eyes way out (claim, hand over, propose, approve, reject, retry, recovery). All writes sit behind the `lateOpenReconciliation` flag.
 *
 * What the screen refuses to say: a late-arrival compensation that is still OPEN is NOT paid; HTTP 200 of approve / retry is NOT "executed" (only
 * `execution.status` says so); the ledger figures are an OBSERVATION and are never an input.
 */
import { useState } from "react";
import { CompactReference } from "../../disputes/shared/CompactReference";
import { useSearchParams } from "react-router";
import { ArrowClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react";
import { useApp } from "../../../../context/AppContext";
import { formatVnDateTime } from "../../adminFinanceOverview.utils";
import { shortId } from "../../adminReconciliation.utils";
import { adminName, handoverOptions, type AdminDirectoryEntry } from "./adminDirectory";
import {
  ApproveLateDialog,
  ApproveRecoveryDialog,
  ClaimDialog,
  HandoverDialog,
  OpenRecoveryDialog,
  ProposeLateDialog,
  RejectLateDialog,
  RejectRecoveryDialog,
  RetryDialog,
  type LateDialogKind,
  type LateDone,
} from "./LateDialogs";
import { Btn, FOCUS, GatedButton, Kv, ListSkeleton, MutedLine, Notice, Pill, ReadFailed, ResultCard, Section } from "./MoneyExceptionParts";
import {
  LATE_HISTORY_LABEL,
  LATE_HUMAN_NOTE_ACTIONS,
  LATE_STATUS_LABEL,
  LATE_STATUS_ORDER,
  LATE_STATUS_TONE,
  obligationFigures,
  outlineObligation,
  recoveryClassText,
  sessionStatusLabel,
  settlementRowLabel,
  stepKindLabel,
} from "./moneyExceptionLabels";
import { parseMoneyError } from "./moneyExceptionErrors";
import { LATE_NOT_PAID_LINE, flagLine, flagMode, idParam, lateGates, type ResultNote } from "./moneyExceptionModel";
import { reasonOrGeneric } from "./moneyExceptionText";
import { liveProposal, openRecovery, type LateItem, type LateProposal, type LateRecovery, type LateStatus, type MoneyCapabilities } from "./moneyExceptionTypes";
import { useAdminDirectory, useLateItem, useLateList } from "./useMoneyExceptionData";

const STATUS_PARAM = "status";
const isLateStatus = (v: string | null): v is LateStatus => !!v && (LATE_STATUS_ORDER as readonly string[]).includes(v);

export function LateOpenView({ caps, capsFailed }: { caps: MoneyCapabilities | undefined; capsFailed: boolean }) {
  const [search, setSearch] = useSearchParams();
  const { user } = useApp();
  const me = user?.id ?? null;
  const rowId = idParam(search.get("row"));
  const statusParam = search.get(STATUS_PARAM);
  const filter: LateStatus | "ALL" = isLateStatus(statusParam) ? statusParam : "ALL";
  const flag = caps?.lateOpenReconciliation ?? null;
  const line = capsFailed ? flagLine("unknown", "late") : flagLine(flagMode(flag), "late");

  const list = useLateList();
  const admins = useAdminDirectory(true);
  const [note, setNote] = useState<ResultNote | null>(null);

  const setParams = (fn: (p: URLSearchParams) => void) => {
    setSearch(
      (prev) => {
        const p = new URLSearchParams(prev);
        fn(p);
        return p;
      },
      { replace: false },
    );
  };
  const openRow = (id: string | null) => {
    setNote(null);
    setParams((p) => (id ? p.set("row", id) : p.delete("row")));
  };
  const setFilter = (s: LateStatus | "ALL") => setParams((p) => (s === "ALL" ? p.delete(STATUS_PARAM) : p.set(STATUS_PARAM, s)));

  const items = list.data ?? [];
  const counts = new Map<LateStatus, number>();
  for (const i of items) counts.set(i.status, (counts.get(i.status) ?? 0) + 1);
  const shown = filter === "ALL" ? items : items.filter((i) => i.status === filter);

  return (
    <div data-testid="late-open-view" className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-base font-bold text-adm-text">Khoản bồi thường đến muộn còn mở</h2>
        <p className="max-w-3xl text-sm text-adm-text-2">
          Khi PT đến muộn, khoản bồi thường cho khách được ghi vào sổ cái. Nếu quỹ chưa đủ, khoản đó còn mở và bước tiền của buổi tập bị dừng chờ người xử lý. Hai quản trị viên cùng xử lý:
          một người đề xuất, một người duyệt. Số tiền do sổ cái tính; không ai nhập số tiền.
        </p>
        <Notice tone="warning" testId="late-not-paid" title="Khoản còn mở chưa được trả">
          {LATE_NOT_PAID_LINE}
        </Notice>
        {line && (
          <MutedLine testId="late-flag-line" icon="lock">
            {line}
          </MutedLine>
        )}
      </header>

      <div className="xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start xl:gap-4">
        <div className={`space-y-3 ${rowId ? "hidden xl:block" : ""}`} data-testid="late-list-pane">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2">
              <FilterChip active={filter === "ALL"} onClick={() => setFilter("ALL")} testId="late-filter-ALL" label="Tất cả" count={items.length} />
              {LATE_STATUS_ORDER.filter((s) => counts.get(s)).map((s) => (
                <FilterChip key={s} active={filter === s} onClick={() => setFilter(s)} testId={`late-filter-${s}`} label={LATE_STATUS_LABEL[s]} count={counts.get(s) ?? 0} />
              ))}
            </div>
            <Btn variant="outline" onClick={() => void list.refetch()} pending={list.isFetching} testId="late-reload">
              <ArrowClockwiseIcon className="size-4" aria-hidden />
              Tải lại
            </Btn>
          </div>

          {list.isLoading ? (
            <ListSkeleton testId="late-loading" />
          ) : list.isError ? (
            <ReadFailed what="hàng đợi bồi thường đến muộn" view={parseMoneyError(list.error)} onRetry={() => void list.refetch()} testId="late-list-error" />
          ) : shown.length === 0 ? (
            <MutedLine testId="late-empty">{items.length === 0 ? "Không có dòng nào đang chờ đối soát khoản bồi thường đến muộn." : "Không có dòng nào ở trạng thái này."}</MutedLine>
          ) : (
            <ul className="space-y-2" data-testid="late-list">
              {shown.map((it) => {
                const o = outlineObligation(it.ledger?.obligation ?? null);
                return (
                  <li key={it.rowId}>
                    <button
                      type="button"
                      data-testid={`late-item-${it.rowId}`}
                      aria-current={it.rowId === rowId ? "true" : undefined}
                      onClick={() => openRow(it.rowId)}
                      className={`block min-h-11 w-full rounded-xl border p-3 text-left transition-colors motion-reduce:transition-none ${FOCUS} ${
                        it.rowId === rowId ? "border-adm-text bg-adm-surface-2" : "border-adm-border bg-adm-surface hover:bg-adm-surface-2"
                      }`}
                    >
                      <span className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-sm font-semibold text-adm-text">Buổi mã {shortId(it.sessionId)}</span>
                        <Pill tone={LATE_STATUS_TONE[it.status]}>{LATE_STATUS_LABEL[it.status]}</Pill>
                      </span>
                      <span className="mt-1 block text-xs text-adm-text-2">
                        {stepKindLabel(it.kind)} · {it.assignee ? `Phụ trách: ${adminName(it.assignee, admins.data, me)}` : "Chưa có người phụ trách"}
                      </span>
                      {o.stillOwed === true && (
                        <span className="mt-1 block text-xs font-medium text-st-warning" data-testid={`late-owed-${it.rowId}`}>
                          Khoản bồi thường chưa trả cho khách
                        </span>
                      )}
                      {!it.assessment.eligible && <span className="mt-1 line-clamp-2 block text-xs text-adm-text-2">{reasonOrGeneric(it.assessment.code, "Chưa thao tác được dòng này.")}</span>}
                    </button>
                  </li>
                );
              })}
              {items.length >= 50 && <li className="text-xs text-adm-text-2">Chỉ hiện 50 dòng đầu tiên của hàng đợi.</li>}
            </ul>
          )}
        </div>

        <div className={`space-y-3 ${rowId ? "" : "hidden xl:block"}`} data-testid="late-detail-pane">
          {rowId && (
            <Btn variant="outline" onClick={() => openRow(null)} testId="late-back">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Quay lại danh sách
            </Btn>
          )}
          {note && <ResultCard note={note} onDismiss={() => setNote(null)} testId="late-result" />}
          {rowId ? <LateDetail rowId={rowId} flag={flag} me={me} admins={admins.data} adminsLoading={admins.isLoading} onNote={setNote} /> : <MutedLine testId="late-pick">Chọn một dòng ở bên trái để xem chi tiết.</MutedLine>}
        </div>
      </div>
    </div>
  );
}

function FilterChip({ active, onClick, label, count, testId }: { active: boolean; onClick: () => void; label: string; count: number; testId: string }) {
  return (
    <button
      type="button"
      aria-pressed={active}
      data-testid={testId}
      onClick={onClick}
      className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium xl:min-h-9 ${FOCUS} ${
        active ? "border-adm-text bg-adm-text text-adm-bg" : "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2"
      }`}
    >
      {label}
      <span className="tabular-nums">{count}</span>
    </button>
  );
}

// ─────────────────────────────────────────────────────── detail ──
function LateDetail({ rowId, flag, me, admins, adminsLoading, onNote }: { rowId: string; flag: boolean | null; me: string | null; admins: AdminDirectoryEntry[] | undefined; adminsLoading: boolean; onNote: (n: ResultNote | null) => void }) {
  const q = useLateItem(rowId);
  const [dialog, setDialog] = useState<LateDialogKind | null>(null);
  if (q.isLoading) return <ListSkeleton testId="late-detail-loading" rows={2} />;
  if (q.isError) return <ReadFailed what="dòng đối soát này" view={parseMoneyError(q.error)} onRetry={() => void q.refetch()} testId="late-detail-error" />;
  const item = q.data!;
  const live = liveProposal(item);
  const rec = openRecovery(item);
  const gates = lateGates({ flag, me, item });
  const outline = outlineObligation(item.ledger?.obligation ?? null);
  const figures = obligationFigures(item.ledger?.obligation ?? null);
  const anyAction = Object.values(gates).some((g) => g.show);
  const done = (d: LateDone) => {
    setDialog(null);
    onNote(d.note);
  };
  const close = () => setDialog(null);
  const nameOf = (id: string | null) => adminName(id, admins, me);

  return (
    <div className="space-y-3" data-testid="late-detail">
      <Section title={`Buổi mã ${shortId(item.sessionId)}`} aside={<Pill tone={LATE_STATUS_TONE[item.status]} testId="late-detail-status">{LATE_STATUS_LABEL[item.status]}</Pill>} testId="late-detail-main">
        <Kv
          rows={[
            { label: "Bước tiền đang chờ", value: stepKindLabel(item.kind) },
            { label: "Tình trạng dòng tiền", value: settlementRowLabel(item.settlementStatus) },
            { label: "Buổi tập", value: sessionStatusLabel(item.sessionStatus) },
            { label: "Người phụ trách", value: item.assignee ? nameOf(item.assignee) : "Chưa có" },
            ...(item.attempts
              ? [
                  { label: "Lượt chạy", value: `Thất bại ${item.attempts.failures}/${item.attempts.cap} lượt trong đợt ${item.attempts.epoch + 1}` },
                  { label: "Đợt chạy bổ sung còn lại", value: String(item.attempts.recoveriesLeft) },
                ]
              : []),
          ]}
        />
        {item.status === "EXECUTION_EXHAUSTED" && (
          <Notice tone="danger" title="Đã hết lượt chạy" testId="late-exhausted">
            {reasonOrGeneric("EXECUTION_ATTEMPTS_EXHAUSTED")} Chưa có tiền nào được ghi từ các lần chạy thất bại.
          </Notice>
        )}
      </Section>

      <Section title="Có thao tác được không?" testId="late-assessment">
        {item.assessment.eligible ? (
          <Notice tone="success" testId="late-assessment-ok">
            Hệ thống đã kiểm tra buổi tập, hợp đồng và sổ cái: dòng này đang ở trạng thái có thể xử lý.
          </Notice>
        ) : (
          <Notice tone="warning" title="Chưa thao tác được dòng này" testId="late-assessment-blocked">
            {reasonOrGeneric(item.assessment.code, "Dòng này chưa thao tác được ở thời điểm này.")}
          </Notice>
        )}
      </Section>

      <Section title="Khoản bồi thường theo sổ cái" testId="late-ledger" aside={<Pill tone={outline.tone}>{outline.label}</Pill>}>
        {item.ledger === null ? (
          <MutedLine testId="late-ledger-unavailable">Chưa đọc được sổ cái nên không hiện số tiền; đây không phải số bằng không.</MutedLine>
        ) : (
          <>
            {outline.warning && (
              <Notice tone={outline.stillOwed ? "warning" : "info"} testId="late-ledger-warning">
                {outline.warning}
              </Notice>
            )}
            {figures.length > 0 && <Kv rows={figures} testId="late-ledger-figures" />}
            <MutedLine>Số liệu này chỉ để xem (quan sát từ sổ cái), không phải đầu vào của thao tác nào. Ghi vào ví Gymini không phải chuyển khoản ngân hàng.</MutedLine>
          </>
        )}
      </Section>

      {item.proposals.length > 0 && (
        <Section title={`Đề xuất (${item.proposals.length})`} testId="late-proposals">
          <ul className="space-y-3">
            {item.proposals.map((p) => (
              <ProposalCard key={p.id} p={p} nameOf={nameOf} />
            ))}
          </ul>
        </Section>
      )}

      {item.recoveries.length > 0 && (
        <Section title={`Đợt chạy bổ sung (${item.recoveries.length})`} testId="late-recoveries">
          <ul className="space-y-3">
            {item.recoveries.map((r) => (
              <RecoveryCard key={r.id} r={r} nameOf={nameOf} />
            ))}
          </ul>
        </Section>
      )}

      {anyAction && (
        <Section title="Thao tác" testId="late-actions">
          <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap">
            {gates.claim.show && <GatedButton label="Nhận phụ trách" reason={gates.claim.disabledReason} onClick={() => setDialog("claim")} testId="late-claim" />}
            {gates.propose.show && <GatedButton label="Lập đề xuất" reason={gates.propose.disabledReason} onClick={() => setDialog("propose")} variant="primary" testId="late-propose" />}
            {gates.approve.show && <GatedButton label="Duyệt đề xuất" reason={gates.approve.disabledReason} onClick={() => setDialog("approve")} variant="primary" testId="late-approve" />}
            {gates.retry.show && <GatedButton label="Chạy lại" reason={gates.retry.disabledReason} onClick={() => setDialog("retry")} variant="primary" testId="late-retry" />}
            {gates.openRecovery.show && <GatedButton label="Mở đợt chạy bổ sung" reason={gates.openRecovery.disabledReason} onClick={() => setDialog("openRecovery")} variant="primary" testId="late-open-recovery" />}
            {gates.approveRecovery.show && <GatedButton label="Duyệt đợt bổ sung" reason={gates.approveRecovery.disabledReason} onClick={() => setDialog("approveRecovery")} variant="primary" testId="late-approve-recovery" />}
            {gates.handover.show && <GatedButton label="Chuyển giao" reason={gates.handover.disabledReason} onClick={() => setDialog("handover")} testId="late-handover" />}
            {gates.reject.show && <GatedButton label="Bác đề xuất" reason={gates.reject.disabledReason} onClick={() => setDialog("reject")} variant="danger" testId="late-reject" />}
            {gates.rejectRecovery.show && <GatedButton label="Bác đợt bổ sung" reason={gates.rejectRecovery.disabledReason} onClick={() => setDialog("rejectRecovery")} variant="danger" testId="late-reject-recovery" />}
          </div>
        </Section>
      )}

      <History item={item} nameOf={nameOf} />

      {dialog === "claim" && <ClaimDialog item={item} onClose={close} onDone={done} />}
      {dialog === "handover" && <HandoverDialog item={item} admins={handoverOptions(admins ?? [], me, item.assignee)} adminsLoading={adminsLoading} onClose={close} onDone={done} />}
      {dialog === "propose" && <ProposeLateDialog item={item} onClose={close} onDone={done} />}
      {dialog === "approve" && live && <ApproveLateDialog item={item} proposalId={live.id} onClose={close} onDone={done} />}
      {dialog === "reject" && live && <RejectLateDialog item={item} proposalId={live.id} onClose={close} onDone={done} />}
      {dialog === "retry" && live && <RetryDialog item={item} proposalId={live.id} onClose={close} onDone={done} />}
      {dialog === "openRecovery" && live && <OpenRecoveryDialog item={item} proposalId={live.id} onClose={close} onDone={done} />}
      {dialog === "approveRecovery" && rec && <ApproveRecoveryDialog item={item} recoveryId={rec.id} onClose={close} onDone={done} />}
      {dialog === "rejectRecovery" && rec && <RejectRecoveryDialog item={item} recoveryId={rec.id} onClose={close} onDone={done} />}
    </div>
  );
}

function proposalState(p: LateProposal): { label: string; tone: "pending" | "warning" | "success" | "neutral" } {
  if (p.outcome === "REJECTED") return { label: "Đã bị bác", tone: "neutral" };
  if (p.outcome === "EXECUTED") return { label: "Đã duyệt và sổ cái đã ghi nhận", tone: "success" };
  if (p.approvedAt) return { label: "Đã duyệt, chưa ghi nhận xong", tone: "warning" };
  return { label: "Chờ người thứ hai duyệt", tone: "pending" };
}

function ProposalCard({ p, nameOf }: { p: LateProposal; nameOf: (id: string | null) => string }) {
  const s = proposalState(p);
  return (
    <li data-testid={`late-proposal-${p.id}`} className="space-y-2 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-adm-text-2">Lập bởi {nameOf(p.proposedBy)} · {formatVnDateTime(p.createdAt)}</span>
        <Pill tone={s.tone}>{s.label}</Pill>
      </div>
      <Kv
        rows={[
          { label: "Lý do", value: p.reason },
          { label: "Cách đã xác minh", value: p.verificationNote },
          { label: "Căn cứ chính sách", value: p.policyBasis },
          { label: "Tham chiếu bằng chứng", value: p.evidenceRefs.length ? <ul className="space-y-2 text-left">{p.evidenceRefs.map((r, i) => <li key={i}><CompactReference value={r} /></li>)}</ul> : "—" },
          ...(p.approvedBy ? [{ label: "Duyệt bởi", value: `${nameOf(p.approvedBy)} · ${formatVnDateTime(p.approvedAt)}` }] : []),
        ]}
      />
    </li>
  );
}

function RecoveryCard({ r, nameOf }: { r: LateRecovery; nameOf: (id: string | null) => string }) {
  const state = r.outcome === "APPLIED" ? "Đã chạy" : r.outcome === "HALTED" ? "Dừng, không chạy gì" : r.outcome === "REJECTED" ? "Đã bị bác" : r.approvedAt ? "Đã duyệt" : "Chờ người thứ hai duyệt";
  return (
    <li data-testid={`late-recovery-${r.id}`} className="space-y-2 rounded-lg border border-adm-border-soft bg-adm-surface-2 p-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <span className="text-xs text-adm-text-2">Mở bởi {nameOf(r.openedBy)} · {formatVnDateTime(r.createdAt)}</span>
        <Pill tone={r.outcome === "HALTED" ? "danger" : r.outcome === "APPLIED" ? "success" : "pending"}>{state}</Pill>
      </div>
      <p className="break-words text-sm text-adm-text">{r.reason}</p>
      <p className="text-xs text-adm-text-2">{recoveryClassText(r.classification)}</p>
      {r.haltCode && <p className="text-xs text-st-warning">{reasonOrGeneric(r.haltCode, "Có điều chưa rõ trong sổ cái.")}</p>}
    </li>
  );
}

function History({ item, nameOf }: { item: LateItem; nameOf: (id: string | null) => string }) {
  if (item.history.length === 0) return null;
  // newest first, like every other timeline of the admin
  const rows = [...item.history].reverse();
  return (
    <details data-testid="late-history" className="rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card">
      <summary className={`min-h-11 cursor-pointer text-sm font-semibold text-adm-text ${FOCUS}`}>Lịch sử ({rows.length})</summary>
      <ul className="mt-2 space-y-2 text-sm">
        {rows.map((h, i) => (
          <li key={`${h.at}-${i}`} className="break-words border-b border-adm-border-soft pb-2 last:border-0">
            <span className="font-medium text-adm-text">{LATE_HISTORY_LABEL[h.action] ?? "Cập nhật"}</span>
            <span className="text-xs text-adm-text-2"> · {formatVnDateTime(h.at)} · {h.actor === "system" ? "Hệ thống" : nameOf(h.actor)}</span>
            {h.note && LATE_HUMAN_NOTE_ACTIONS.has(h.action) && <p className="mt-0.5 text-xs text-adm-text-2">{h.note}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}
