/**
 * D7 - chip "Khoản giữ buổi PT vắng" of Tài chính › Đối soát: the four-eyes resolution (D65-B, P1-P5) of the money a contract HELD for a NO_SHOW
 * session. List (P1) + detail (P3) + eligibility preview of a session (P2, opened from the «Tất toán cần người xử lý» group) + propose / approve /
 * resume, all behind the `d65bResolution` flag. With the flag off or unknown the views stay and NO write control is rendered.
 */
import { useState } from "react";
import { CompactReference } from "../../disputes/shared/CompactReference";
import { useSearchParams } from "react-router";
import { ArrowClockwiseIcon, ArrowLeftIcon } from "@phosphor-icons/react";
import { useApp } from "../../../../context/AppContext";
import { formatMoneyString, formatVnDateTime } from "../../adminFinanceOverview.utils";
import { shortId } from "../../adminReconciliation.utils";
import { ApproveD65bDialog, ProposeD65bDialog, type D65bDone } from "./D65bDialogs";
import { adminName, type AdminDirectoryEntry } from "./adminDirectory";
import { Btn, GatedButton, Kv, ListSkeleton, MutedLine, Notice, Pill, ReadFailed, ResultCard, Section, FOCUS } from "./MoneyExceptionParts";
import { D65B_HISTORY_LABEL, D65B_HUMAN_NOTE_ACTIONS, D65B_STATUS_LABEL, D65B_STATUS_TONE, sessionStatusLabel, settlementRowLabel } from "./moneyExceptionLabels";
import { d65bCredited, d65bGates, flagLine, flagMode, idParam, type ResultNote } from "./moneyExceptionModel";
import { parseMoneyError } from "./moneyExceptionErrors";
import { reasonOrGeneric } from "./moneyExceptionText";
import { D65B_STATUSES, type D65bDetail, type D65bSessionPreview, type D65bStatus, type D65bSummary, type MoneyCapabilities } from "./moneyExceptionTypes";
import { useAdminDirectory, useD65bDetail, useD65bList, useD65bPreview } from "./useMoneyExceptionData";
import { HeldMoneyReviewSection } from "./HeldMoneyReviewSection";

type Dialog = { kind: "propose" } | { kind: "approve" } | { kind: "resume" } | { kind: "reject" } | { kind: "handover" } | null;

export function HeldNoShowView({ caps, capsFailed }: { caps: MoneyCapabilities | undefined; capsFailed: boolean }) {
  const [search, setSearch] = useSearchParams();
  const { user } = useApp();
  const me = user?.id ?? null;
  const resolutionId = idParam(search.get("resolution"));
  const sessionId = idParam(search.get("session"));
  const flag = caps?.d65bResolution ?? null;
  const mode = flagMode(flag);
  const line = capsFailed ? flagLine("unknown", "d65b") : flagLine(mode, "d65b");

  const list = useD65bList();
  const admins = useAdminDirectory(!!resolutionId || !!sessionId || (list.data?.length ?? 0) > 0);
  const [filter, setFilter] = useState<D65bStatus | "ALL">("ALL");
  const [dialog, setDialog] = useState<Dialog>(null);
  const [note, setNote] = useState<ResultNote | null>(null);

  const selected = resolutionId ?? sessionId;
  const open = (next: { resolution?: string; session?: string } | null) => {
    setNote(null);
    setSearch(
      (prev) => {
        const p = new URLSearchParams(prev);
        p.delete("resolution");
        p.delete("session");
        if (next?.resolution) p.set("resolution", next.resolution);
        if (next?.session) p.set("session", next.session);
        return p;
      },
      { replace: false },
    );
  };

  // a form finished: close it, follow a newly made proposal, and keep the honest sentence about the money on screen
  const done = (d: D65bDone) => {
    setDialog(null);
    if (d.resolutionId) open({ resolution: d.resolutionId });
    setNote(d.note);
  };

  const items = list.data ?? [];
  const counts = Object.fromEntries(D65B_STATUSES.map((s) => [s, items.filter((i) => i.status === s).length])) as Record<D65bStatus, number>;
  const shown = filter === "ALL" ? items : items.filter((i) => i.status === filter);

  return (
    <div data-testid="held-no-show-view" className="space-y-4">
      <header className="space-y-2">
        <h2 className="text-base font-bold text-adm-text">Khoản giữ của buổi PT vắng</h2>
        <p className="max-w-3xl text-sm text-adm-text-2">
          Khi PT vắng mặt mà hợp đồng kết thúc trước khi khách được hoàn, khoản của buổi đó bị giữ lại.
          Hai quản trị viên cùng xử lý: một người đề xuất, một người duyệt.
          Tiền chỉ về ví của khách và do sổ cái tính; không ai nhập số tiền.
        </p>
        {line && (
          <MutedLine testId="held-flag-line" icon="lock">
            {line}
          </MutedLine>
        )}
      </header>

      <div className="xl:grid xl:grid-cols-[minmax(0,2fr)_minmax(0,3fr)] xl:items-start xl:gap-4">
        <div className={`space-y-3 ${selected ? "hidden xl:block" : ""}`} data-testid="held-list-pane">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div role="group" aria-label="Lọc theo trạng thái" className="flex flex-wrap gap-2">
              {(["ALL", ...D65B_STATUSES] as const).map((s) => (
                <button
                  key={s}
                  type="button"
                  aria-pressed={filter === s}
                  data-testid={`held-filter-${s}`}
                  onClick={() => setFilter(s)}
                  className={`inline-flex min-h-11 items-center gap-1.5 rounded-full border px-3 text-xs font-medium xl:min-h-9 ${FOCUS} ${
                    filter === s ? "border-adm-text bg-adm-text text-adm-bg" : "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2"
                  }`}
                >
                  {s === "ALL" ? "Tất cả" : D65B_STATUS_LABEL[s]}
                  <span className="tabular-nums">{s === "ALL" ? items.length : counts[s]}</span>
                </button>
              ))}
            </div>
            <Btn variant="outline" onClick={() => void list.refetch()} pending={list.isFetching} testId="held-reload">
              <ArrowClockwiseIcon className="size-4" aria-hidden />
              Tải lại
            </Btn>
          </div>

          {list.isLoading ? (
            <ListSkeleton testId="held-loading" />
          ) : list.isError ? (
            <ReadFailed what="danh sách đề xuất" view={parseMoneyError(list.error)} onRetry={() => void list.refetch()} testId="held-list-error" />
          ) : shown.length === 0 ? (
            <MutedLine testId="held-empty">
              {items.length === 0
                ? "Chưa có đề xuất nào. Để lập đề xuất mới, mở một dòng «Chưa được xác nhận»" +
                  " của buổi PT vắng từ nhóm «Tất toán cần người xử lý» ở chip Ngoại lệ."
                : "Không có đề xuất nào ở trạng thái này."}
            </MutedLine>
          ) : (
            <ul className="space-y-2" data-testid="held-list">
              {shown.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    data-testid={`held-item-${r.id}`}
                    aria-current={r.id === resolutionId ? "true" : undefined}
                    onClick={() => open({ resolution: r.id })}
                    className={`block min-h-11 w-full rounded-xl border p-3 text-left transition-colors motion-reduce:transition-none ${FOCUS} ${
                      r.id === resolutionId ? "border-adm-text bg-adm-surface-2" : "border-adm-border bg-adm-surface hover:bg-adm-surface-2"
                    }`}
                  >
                    <span className="flex flex-wrap items-center justify-between gap-2">
                      <span className="text-sm font-semibold text-adm-text">Buổi mã {shortId(r.sessionId)}</span>
                      <Pill tone={D65B_STATUS_TONE[r.status]}>{D65B_STATUS_LABEL[r.status]}</Pill>
                    </span>
                    <span className="mt-1 block text-xs text-adm-text-2">
                      Lập bởi {adminName(r.proposedBy, admins.data, me)} · {formatVnDateTime(r.createdAt)}
                    </span>
                    <span className="mt-1 line-clamp-2 block break-words text-xs text-adm-text">{r.reason}</span>
                  </button>
                </li>
              ))}
              {items.length >= 50 && <li className="text-xs text-adm-text-2">Chỉ hiện 50 đề xuất mới nhất.</li>}
            </ul>
          )}
        </div>

        <div className={`space-y-3 ${selected ? "" : "hidden xl:block"}`} data-testid="held-detail-pane">
          {selected && (
            <Btn variant="outline" onClick={() => open(null)} testId="held-back">
              <ArrowLeftIcon className="size-4" aria-hidden />
              Quay lại danh sách
            </Btn>
          )}
          {note && <ResultCard note={note} onDismiss={() => setNote(null)} testId="held-result" />}
          {resolutionId ? (
            <ResolutionDetail id={resolutionId} flag={flag} me={me} admins={admins.data} dialog={dialog} setDialog={setDialog} onDone={done} />
          ) : sessionId ? (
            <SessionPreview sessionId={sessionId} flag={flag} me={me} dialog={dialog} setDialog={setDialog} onOpenResolution={(id) => open({ resolution: id })} onDone={done} />
          ) : (
            <MutedLine testId="held-pick">Chọn một đề xuất ở bên trái để xem chi tiết.</MutedLine>
          )}
        </div>
      </div>

      <HeldMoneyReviewSection d65bProposals={items} proposalsComplete={list.isSuccess && items.length < 50} />
    </div>
  );
}

// ─────────────────────────────────────────────────────── detail ──
function ResolutionDetail({
  id,
  flag,
  me,
  admins,
  dialog,
  setDialog,
  onDone,
}: {
  id: string;
  flag: boolean | null;
  me: string | null;
  admins: AdminDirectoryEntry[] | undefined;
  dialog: Dialog;
  setDialog: (d: Dialog) => void;
  onDone: (d: D65bDone) => void;
}) {
  const q = useD65bDetail(id);
  if (q.isLoading) return <ListSkeleton testId="held-detail-loading" rows={2} />;
  if (q.isError) {
    const view = parseMoneyError(q.error);
    return <ReadFailed what="đề xuất này" view={view} onRetry={() => void q.refetch()} testId="held-detail-error" />;
  }
  const d = q.data!;
  const gates = d65bGates({ flag, me, resolution: d, preview: null });
  const credited = d65bCredited(d);
  return (
    <div className="space-y-3" data-testid="held-detail">
      <Section
        title={`Buổi mã ${shortId(d.sessionId)}`}
        aside={<Pill tone={D65B_STATUS_TONE[d.status]} testId="held-detail-status">{D65B_STATUS_LABEL[d.status]}</Pill>}
        testId="held-detail-main"
      >
        <StatusBanner d={d} credited={credited} />
        <Kv
          rows={[
            { label: "Lập bởi", value: `${adminName(d.proposedBy, admins, me)} · ${formatVnDateTime(d.createdAt)}` },
            { label: "Lý do", value: d.reason || "—" },
            {
              label: "Tham chiếu bằng chứng",
              value: d.evidenceRefs.length ? (
                <ul className="space-y-2 text-left">
                  {d.evidenceRefs.map((r, i) => (
                    <li key={i}>
                      <CompactReference value={r} />
                    </li>
                  ))}
                </ul>
              ) : "—",
            },
            ...(d.approvedBy ? [{ label: "Duyệt bởi", value: `${adminName(d.approvedBy, admins, me)} · ${formatVnDateTime(d.approvedAt)}` }, { label: "Lý do duyệt", value: d.approvalReason ?? "—" }] : []),
            ...(d.rejectedBy ? [{
              label: "Từ chối bởi",
              value: `${adminName(d.rejectedBy, admins, me)} · ${formatVnDateTime(d.rejectedAt)}`,
            }, { label: "Lý do từ chối", value: d.rejectionReason ?? "—" }] : []),
          ]}
        />
      </Section>

      <Section title="Số liệu sổ cái" testId="held-detail-ledger">
        <Kv
          rows={[
            { label: "Giá trị một buổi (sổ cái tính)", value: formatMoneyString(d.ledgerBefore?.unit) },
            { label: "Tiền đang giữ lúc đề xuất", value: formatMoneyString(d.ledgerBefore?.pendingTotal) },
            { label: "Dòng tiền đền của buổi", value: settlementRowLabel(d.heldRowStatus) },
            ...(credited ? [{ label: "Sổ cái đã ghi có cho khách", value: formatMoneyString(credited) }] : []),
          ]}
        />
        <MutedLine>Đây là số liệu sổ cái chỉ để xem. Không có ô nhập số tiền ở bất kỳ bước nào.</MutedLine>
      </Section>

      {(gates.approve.show || gates.resume.show || gates.reject.show || gates.handover.show) && (
        <Section title="Thao tác" testId="held-detail-actions">
          {gates.approve.show && <GatedButton label="Duyệt đề xuất" reason={gates.approve.disabledReason} onClick={() => setDialog({ kind: "approve" })} variant="primary" testId="held-approve" />}
          {gates.reject.show && <GatedButton label="Từ chối đề xuất" reason={gates.reject.disabledReason} onClick={() => setDialog({ kind: "reject" })} variant="outline" testId="held-reject" />}
          {gates.resume.show && <GatedButton label="Chạy lại việc ghi có" reason={gates.resume.disabledReason} onClick={() => setDialog({ kind: "resume" })} variant="primary" testId="held-resume" />}
          {gates.handover.show && (
            <GatedButton
              label="Tiếp quản nếu người duyệt đã rời vai quản trị"
              reason={gates.handover.disabledReason}
              onClick={() => setDialog({ kind: "handover" })}
              variant="outline"
              testId="held-handover"
            />
          )}
          {gates.handover.show && (
            <MutedLine>
              Máy chủ sẽ xác minh người đã duyệt không còn là quản trị viên đang hoạt động trước khi tiếp quản.
              Nếu họ vẫn còn hoạt động, thao tác bị từ chối và không ghi có.
            </MutedLine>
          )}
        </Section>
      )}

      <History entries={d.history} admins={admins} me={me} />

      {dialog?.kind === "approve" && <ApproveD65bDialog resolution={d} mode="approve" onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog?.kind === "resume" && <ApproveD65bDialog resolution={d} mode="resume" onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog?.kind === "reject" && <ApproveD65bDialog resolution={d} mode="reject" onClose={() => setDialog(null)} onDone={onDone} />}
      {dialog?.kind === "handover" && <ApproveD65bDialog resolution={d} mode="handover" onClose={() => setDialog(null)} onDone={onDone} />}
    </div>
  );
}

function StatusBanner({ d, credited }: { d: D65bDetail; credited: string | null }) {
  if (d.status === "REJECTED") {
    return (
      <Notice tone="neutral" title="Đề xuất đã bị từ chối" testId="held-banner-rejected">
        Không có khoản tiền nào được chuyển bởi đề xuất này. Có thể lập đề xuất mới sau khi xem lại bằng chứng.
      </Notice>
    );
  }
  if (d.status === "EXECUTED") {
    return (
      <Notice tone="success" title="Sổ cái đã xác nhận ghi có cho khách" testId="held-banner-executed">
        {credited ? `Sổ cái đã ghi ${formatMoneyString(credited)} vào ví Gymini của khách. ` : "Sổ cái đã ghi có cho khách. "}
        Đây là ghi vào ví Gymini, không phải chuyển khoản ngân hàng.
      </Notice>
    );
  }
  if (d.status === "APPROVED_NOT_EXECUTED") {
    return (
      <Notice
        tone="warning"
        title="Đã duyệt, nhưng sổ cái chưa xác nhận ghi có — tiền chưa chuyển vào ví"
        testId="held-banner-not-executed"
      >
        Khoản vẫn đang được giữ. Người đã duyệt chạy lại bằng nút «Chạy lại việc ghi có».
        Nếu người đó không còn là quản trị viên đang hoạt động, một quản trị viên thứ ba có thể tiếp quản sau khi máy chủ xác minh.
        Sổ cái chỉ ghi tiền một lần.
      </Notice>
    );
  }
  return (
    <Notice tone="info" title="Chờ người thứ hai duyệt" testId="held-banner-proposed">
      Chưa có khoản tiền nào được chuyển. Khách chưa nhận khoản này vào ví.
    </Notice>
  );
}

function History({ entries, admins, me }: { entries: D65bDetail["history"]; admins: AdminDirectoryEntry[] | undefined; me: string | null }) {
  if (entries.length === 0) return null;
  return (
    <details data-testid="held-history" className="rounded-xl border border-adm-border bg-adm-surface p-4 shadow-adm-card">
      <summary className={`min-h-11 cursor-pointer text-sm font-semibold text-adm-text ${FOCUS}`}>Lịch sử ({entries.length})</summary>
      <ul className="mt-2 space-y-2 text-sm">
        {entries.map((h, i) => (
          <li key={`${h.at}-${i}`} className="break-words border-b border-adm-border-soft pb-2 last:border-0">
            <span className="font-medium text-adm-text">{D65B_HISTORY_LABEL[h.action] ?? "Cập nhật"}</span>
            <span className="text-xs text-adm-text-2"> · {formatVnDateTime(h.at)} · {adminName(h.actor, admins, me)}</span>
            {h.note && D65B_HUMAN_NOTE_ACTIONS.has(h.action) && <p className="mt-0.5 text-xs text-adm-text-2">{h.note}</p>}
          </li>
        ))}
      </ul>
    </details>
  );
}

// ────────────────────────────────────────── eligibility preview ──
function SessionPreview({
  sessionId,
  flag,
  me,
  dialog,
  setDialog,
  onOpenResolution,
  onDone,
}: {
  sessionId: string;
  flag: boolean | null;
  me: string | null;
  dialog: Dialog;
  setDialog: (d: Dialog) => void;
  onOpenResolution: (id: string) => void;
  onDone: (d: D65bDone) => void;
}) {
  const q = useD65bPreview(sessionId);
  if (q.isLoading) return <ListSkeleton testId="held-preview-loading" rows={2} />;
  if (q.isError) return <ReadFailed what="điều kiện của buổi này" view={parseMoneyError(q.error)} onRetry={() => void q.refetch()} testId="held-preview-error" />;
  const p: D65bSessionPreview = q.data!;
  const gates = d65bGates({ flag, me, resolution: p.resolution, preview: p });
  return (
    <div className="space-y-3" data-testid="held-preview">
      <Section title={`Buổi mã ${shortId(p.sessionId)}`} aside={<Pill tone="neutral">{sessionStatusLabel(p.sessionStatus)}</Pill>} testId="held-preview-main">
        {p.resolution ? (
          <>
            <Notice tone="info" title={p.resolution.status === "REJECTED" ? "Đề xuất trước đã bị từ chối" : "Buổi này đang có đề xuất"} testId="held-preview-has-resolution">
              Trạng thái: {D65B_STATUS_LABEL[p.resolution.status]}.
            </Notice>
            <Btn variant="outline" onClick={() => onOpenResolution((p.resolution as D65bSummary).id)} testId="held-preview-open">
              Mở đề xuất
            </Btn>
          </>
        ) : p.assessment.eligible ? (
          <Notice tone="success" title="Buổi này đủ điều kiện để lập đề xuất" testId="held-preview-eligible">
            Hệ thống đã kiểm tra buổi tập, hợp đồng và sổ cái. Việc lập đề xuất chưa chuyển khoản tiền nào.
          </Notice>
        ) : (
          <Notice tone="warning" title="Chưa lập được đề xuất cho buổi này" testId="held-preview-blocked">
            {reasonOrGeneric(p.assessment.code, "Buổi này chưa đủ điều kiện để lập đề xuất.")}
          </Notice>
        )}
        <Kv
          rows={[
            { label: "Giá trị một buổi (sổ cái tính)", value: formatMoneyString(p.ledger?.unit) },
            { label: "Tiền đang giữ của hợp đồng", value: formatMoneyString(p.ledger?.pendingTotal) },
            {
              label: "Hợp đồng đã kết thúc (theo sổ cái)",
              value:
                p.ledger?.contractEnded === null || p.ledger === null
                  ? "Chưa đọc được"
                  : p.ledger.contractEnded
                    ? "Đã kết thúc"
                    : "Chưa kết thúc",
            },
          ]}
        />
        {p.ledger === null && <MutedLine>Chưa đọc được số liệu sổ cái nên không hiện số tiền; đây không phải số bằng không.</MutedLine>}
        {gates.propose.show && (
          <Btn variant="primary" onClick={() => setDialog({ kind: "propose" })} testId="held-propose">
            Lập đề xuất
          </Btn>
        )}
      </Section>
      {dialog?.kind === "propose" && <ProposeD65bDialog sessionId={p.sessionId} unit={p.ledger?.unit ?? null} onClose={() => setDialog(null)} onDone={onDone} />}
    </div>
  );
}
