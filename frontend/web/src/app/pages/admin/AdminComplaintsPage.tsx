import { useId, useMemo, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ArrowClockwiseIcon, WarningCircleIcon, ClockIcon, CheckCircleIcon, XIcon, UserIcon, BuildingsIcon, FolderOpenIcon } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import { useModalA11y } from "./shared/useModalA11y";
import type { ComplaintIssueType, ComplaintSource, ComplaintStatus, GymComplaint } from "../../types";
import { AuthenticatedImage } from "../../components/ui/AuthenticatedImage";
import { Button } from "../../components/ui/button";
import { listAdminOptions } from "./disputes/actions/adminDirectory";
import { useIdempotentAction } from "./disputes/useIdempotentAction";
import { gymCaseApi } from "./complaints/gymCaseApi";
import { gymCaseEffective } from "./complaints/gymCaseTypes";
import { parseGymError, type GymErrorView } from "./complaints/gymCaseErrors";
import { COMPLAINT_RESOLVE_NOT_REFUND, CASE_REQUIRED_TEXT, GYM_CASE_DISABLED_NOTE, GYM_CASE_STATUS_FILTER_NOTE, OPEN_CLASS_OPTIONS, gymStatusLabel, issueLabel } from "./complaints/gymCaseLabels";
import { GYM_QUERY_OPTIONS, useGymQueryKeys } from "./complaints/gymCaseQueryKeys";
import {
  LIMITS,
  PAGE_SIZE,
  casePath,
  findCaseOfComplaint,
  hasErrors,
  pageInfo,
  parseCaseStatusFilter,
  parseComplaintStatus,
  parsePage,
  parseQueueView,
  readOpenResult,
  validateOpen,
  openBody,
  type QueueView,
} from "./complaints/gymCaseModel";
import { GYM_CASE_STATUSES } from "./complaints/gymCaseTypes";
import { CaseQueue, ComplaintCards, Pager, complaintTone } from "./complaints/ComplaintQueueParts";
import { ActionButton, ButtonRow, ErrorBox, Field, MutedLine, Select, TextArea, TextInput, counter } from "./complaints/gymCaseKit";
import { EmptyBox, FOCUS, GymFailurePanel, LoadingSkeleton, Muted, Notice, Pill, describeGymLoadFailure } from "./complaints/GymParts";
import { formatDateTimeSafe, shortRefSafe } from "./complaints/gymFormat";

// The label maps and `statusMeta` stay exported unchanged: AdminPartnersPage imports them.
export const ISSUE_TYPE_LABEL: Record<ComplaintIssueType, string> = {
  CLEANLINESS: "Vệ sinh",
  STAFF_BEHAVIOR: "Thái độ nhân viên",
  EQUIPMENT_CONDITION: "Thiết bị hư hỏng",
  FALSE_ADVERTISING: "Quảng cáo sai sự thật",
  BILLING: "Tính phí sai",
  SAFETY: "An toàn",
  OTHER: "Khác",
};

export const SOURCE_LABEL: Record<ComplaintSource, string> = {
  SELF_DETECTED: "Admin tự phát hiện",
  MEMBER_REPORT: "Hội viên báo cáo",
  PT_REPORT: "PT phản ánh",
  PARTNER_DISCLOSED: "Đối tác tự khai báo",
};

const STATUS_TABS: { key: ComplaintStatus | "ALL"; label: string }[] = [
  { key: "ALL", label: "Tất cả" },
  { key: "OPEN", label: "Mới" },
  { key: "IN_PROGRESS", label: "Đang xử lý" },
  { key: "RESOLVED", label: "Đã xử lý" },
];

export function statusMeta(status: ComplaintStatus) {
  if (status === "OPEN") return { label: "Mới", tone: "info" as const, icon: ClockIcon };
  if (status === "IN_PROGRESS") return { label: "Đang xử lý", tone: "warning" as const, icon: WarningCircleIcon };
  return { label: "Đã xử lý", tone: "success" as const, icon: CheckCircleIcon };
}

const CHIP_LABEL: Record<QueueView, string> = { complaints: "Khiếu nại", cases: "Hồ sơ xử lý" };

/**
 * GYM_MANAGEMENT master spec, Phase 5 + Dispute V2.1 Slice 3 (D6) - the admin queue of gym complaints. One surface, two chips kept in the URL
 * (`?view=complaints|cases&status=&page=`):
 *  - `complaints` the old queue (H1) with real paging (`limit`/`offset`, the server's `meta.total`); a card opens the detail dialog, where a
 *                 case can be opened, the complaint assigned to a real ADMIN, and the status changed (RESOLVED never refunds).
 *  - `cases`      G2 - the case queue (status filter, offset paging); a row opens the case workspace.
 * Every read of G2 writes access-log rows, so there is no polling; reload is always a click.
 */
export function AdminComplaintsPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const view = parseQueueView(searchParams.get("view"));
  const complaintStatus = parseComplaintStatus(searchParams.get("status"));
  const caseStatus = parseCaseStatusFilter(searchParams.get("status"));
  const page = parsePage(searchParams.get("page"));
  const { keys, userId } = useGymQueryKeys();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState<GymComplaint | null>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  const go = (next: { view?: QueueView; status?: string | null; page?: number }) => {
    const p = new URLSearchParams();
    const v = next.view ?? view;
    if (v === "cases") p.set("view", "cases");
    const st = next.status === undefined ? (v === "cases" ? caseStatus : complaintStatus !== "OPEN" ? complaintStatus : null) : next.status;
    if (st && !(v === "complaints" && st === "OPEN")) p.set("status", st);
    const pg = next.page ?? 1;
    if (pg > 1) p.set("page", String(pg));
    setSearchParams(p);
  };

  const offset = (page - 1) * PAGE_SIZE;
  const complaintsQuery = useQuery({
    queryKey: keys ? keys.complaints({ status: complaintStatus, page }) : ["gym-complaint", "disabled", "c"],
    queryFn: () => gymCaseApi.listComplaintsPage<GymComplaint>({ status: complaintStatus === "ALL" ? undefined : complaintStatus, limit: PAGE_SIZE, offset }),
    enabled: !!keys && view === "complaints",
    ...GYM_QUERY_OPTIONS,
  });
  const casesQuery = useQuery({
    queryKey: keys ? keys.caseList({ status: caseStatus ?? undefined, page }) : ["gym-complaint", "disabled", "k"],
    queryFn: () => gymCaseApi.listCases({ status: caseStatus ?? undefined, limit: PAGE_SIZE, offset }),
    enabled: !!keys && view === "cases",
    ...GYM_QUERY_OPTIONS,
  });
  const gymsQuery = useQuery({
    queryKey: keys ? keys.gyms() : ["gym-complaint", "disabled", "g"],
    queryFn: () => adminService.listGymsForAdmin(),
    enabled: !!keys,
    ...GYM_QUERY_OPTIONS,
  });
  const gymNameById = useMemo(() => {
    const map = new Map<string, string>();
    for (const g of (gymsQuery.data as Array<{ id: string; name: string; approvedName?: string | null }> | undefined) ?? []) map.set(g.id, g.approvedName ?? g.name);
    return map;
  }, [gymsQuery.data]);

  const active = view === "complaints" ? complaintsQuery : casesQuery;
  const hasData = active.data !== undefined;
  const loading = !keys || (active.isLoading && !hasData);
  const failure = active.isError && !hasData ? describeGymLoadFailure(parseGymError(active.error)) : null;
  const staleView = active.isError && hasData ? parseGymError(active.error) : null;
  const refresh = () => void active.refetch();

  const complaints = complaintsQuery.data?.items ?? [];
  const complaintInfo = pageInfo(complaintsQuery.data?.meta.total ?? 0, page, complaints.length);
  const cases = casesQuery.data?.items ?? [];
  const caseInfo = pageInfo(casesQuery.data?.total ?? 0, page, cases.length);

  const invalidate = () => {
    if (keys) void queryClient.invalidateQueries({ queryKey: keys.complaintsAll() });
  };

  return (
    <div className="mx-auto max-w-6xl space-y-5 p-4 md:p-6" data-testid="complaints-page">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h1 className="text-xl font-bold text-adm-text">Khiếu nại / Vi phạm</h1>
          <p className="mt-0.5 text-sm text-adm-text-2">Mọi nguồn — hội viên báo cáo, PT phản ánh, admin tự phát hiện — trong một hàng đợi.</p>
        </div>
        <div className="flex items-center gap-3">
          {hasData && active.dataUpdatedAt > 0 && <span className="text-xs tabular-nums text-adm-text-2">Cập nhật lúc {formatDateTimeSafe(new Date(active.dataUpdatedAt).toISOString())}</span>}
          <Button type="button" variant="outline" size="sm" onClick={refresh} disabled={!keys || active.isFetching} aria-busy={active.isFetching} className="min-h-11 xl:min-h-8" data-testid="complaints-reload">
            <ArrowClockwiseIcon aria-hidden className={active.isFetching ? "animate-spin" : ""} /> Tải lại
          </Button>
        </div>
      </div>

      <div role="group" aria-label="Chọn danh sách" className="flex flex-wrap gap-2" data-testid="complaints-chips">
        {(["complaints", "cases"] as const).map((v) => {
          const on = v === view;
          return (
            <button
              key={v}
              type="button"
              aria-pressed={on}
              data-testid={`complaints-chip-${v}`}
              onClick={() => go({ view: v, status: null })}
              className={`inline-flex min-h-11 items-center gap-2 rounded-full border px-4 text-sm font-medium transition-colors motion-reduce:transition-none xl:min-h-10 ${FOCUS} ${
                on ? "border-adm-text bg-adm-text text-adm-bg" : "border-adm-border bg-adm-surface text-adm-text hover:bg-adm-surface-2"
              }`}
            >
              {v === "cases" && <FolderOpenIcon className="size-4" aria-hidden />}
              {CHIP_LABEL[v]}
              {on && hasData && (
                <span className="rounded-full bg-adm-bg/20 px-2 py-px text-xs font-semibold tabular-nums" data-testid={`complaints-chip-count-${v}`}>
                  {v === "complaints" ? complaintInfo.total : caseInfo.total}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {view === "complaints" ? (
        <div role="group" aria-label="Lọc theo tình trạng" className="flex flex-wrap gap-1.5 border-b border-adm-border pb-2" data-testid="complaints-status-tabs">
          {STATUS_TABS.map((t) => {
            const on = complaintStatus === t.key;
            return (
              <button
                key={t.key}
                type="button"
                aria-pressed={on}
                data-testid={`complaints-status-${t.key}`}
                onClick={() => go({ status: t.key })}
                className={`min-h-11 rounded-lg px-3 text-xs font-semibold transition-colors motion-reduce:transition-none xl:min-h-9 ${FOCUS} ${on ? "bg-adm-text text-adm-bg" : "text-adm-text-2 hover:bg-adm-surface-2"}`}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      ) : (
        <div className="space-y-2">
          <div className="flex flex-wrap items-center gap-2">
            <label htmlFor="gym-case-status-filter" className="text-sm font-medium text-adm-text">
              Bước hiện tại
            </label>
            <select
              id="gym-case-status-filter"
              data-testid="gym-case-status-filter"
              value={caseStatus ?? ""}
              onChange={(e) => go({ status: parseCaseStatusFilter(e.target.value) })}
              className={`min-h-11 rounded-md border border-adm-border bg-adm-surface px-3 text-sm text-adm-text xl:min-h-9 ${FOCUS}`}
            >
              <option value="">Tất cả các bước</option>
              {GYM_CASE_STATUSES.map((s) => (
                <option key={s} value={s}>
                  {gymStatusLabel(s)}
                </option>
              ))}
            </select>
          </div>
          <Muted testId="gym-case-note">{GYM_CASE_STATUS_FILTER_NOTE}</Muted>
        </div>
      )}

      {staleView && (
        <Notice tone="pending" role="status" testId="complaints-refresh-failed">
          Không làm mới được: {staleView.message} Đang hiện dữ liệu cũ.
        </Notice>
      )}

      {loading ? (
        <LoadingSkeleton testId="complaints-loading" />
      ) : failure ? (
        <GymFailurePanel failure={{ ...failure, backToQueue: false }} onReload={refresh} reloading={active.isFetching} testId="complaints-failure" />
      ) : view === "complaints" ? (
        complaints.length === 0 ? (
          <EmptyBox testId="complaints-empty">{complaintStatus === "OPEN" ? "Không có khiếu nại mới nào." : "Không có khiếu nại nào khớp bộ lọc."}</EmptyBox>
        ) : (
          <div className="space-y-3">
            <ComplaintCards
              items={complaints}
              gymNameById={gymNameById}
              onOpen={(c, opener) => {
                openerRef.current = opener;
                setSelected(c);
              }}
            />
            <Pager info={complaintInfo} testId="complaints-pager" onPrev={() => go({ page: page - 1 })} onNext={() => go({ page: page + 1 })} />
          </div>
        )
      ) : cases.length === 0 ? (
        <EmptyBox testId="gym-cases-empty">{caseStatus ? "Không có hồ sơ nào ở bước này." : "Chưa có hồ sơ xử lý nào. Mở hồ sơ từ chi tiết một khiếu nại."}</EmptyBox>
      ) : (
        <div className="space-y-3">
          <CaseQueue items={cases} userId={userId} />
          <Pager info={caseInfo} testId="gym-cases-pager" onPrev={() => go({ page: page - 1 })} onNext={() => go({ page: page + 1 })} />
        </div>
      )}

      {selected && (
        <ComplaintDetailDialog
          complaint={selected}
          gymName={gymNameById.get(selected.gymId)}
          onClose={() => setSelected(null)}
          onChanged={(updated) => {
            invalidate();
            setSelected(updated);
          }}
        />
      )}
    </div>
  );
}

/** The complaint detail dialog. Exported with the same props as before: AdminPartnersPage opens it from a partner's complaints tab. */
export function ComplaintDetailDialog({
  complaint,
  gymName,
  onClose,
  onChanged,
}: {
  complaint: GymComplaint;
  gymName?: string;
  onClose: () => void;
  onChanged: (updated: GymComplaint) => void;
}) {
  const [response, setResponse] = useState(complaint.adminResponse ?? "");
  const [statusError, setStatusError] = useState<GymErrorView | null>(null);
  const panelRef = useRef<HTMLDivElement>(null);
  const titleId = useId();
  useModalA11y(panelRef, onClose);

  const updateMutation = useMutation({
    mutationFn: (status: ComplaintStatus) => adminService.updateComplaintStatus(complaint.id, { status, adminResponse: response }),
    onSuccess: (updated) => {
      setStatusError(null);
      toast.success("Đã cập nhật");
      onChanged(updated);
    },
    onError: (e) => setStatusError(parseGymError(e, { action: "write" })),
  });

  const meta = statusMeta(complaint.status);
  const resolved = complaint.status === "RESOLVED";
  // G37: the gym case flag as gym-service evaluates it; missing / failed read = off (fail-closed).
  const { keys: gymKeys } = useGymQueryKeys();
  const capsQuery = useQuery({ queryKey: gymKeys?.capabilities() ?? ["gym-complaint", "disabled", "capabilities"], enabled: !!gymKeys, queryFn: () => gymCaseApi.capabilities(), ...GYM_QUERY_OPTIONS });

  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onClick={onClose} data-testid="complaint-dialog-overlay">
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        tabIndex={-1}
        data-testid="complaint-dialog"
        className="max-h-[90dvh] w-full max-w-lg overflow-y-auto rounded-2xl border border-adm-border bg-adm-surface text-adm-text shadow-adm-pop outline-none"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-adm-border bg-adm-surface px-4 py-3">
          <h3 id={titleId} className="text-sm font-bold text-adm-text">
            {issueLabel(complaint.issueType)}
          </h3>
          <button type="button" aria-label="Đóng" onClick={onClose} className={`grid size-11 place-items-center rounded-md text-adm-text-2 hover:text-adm-text xl:size-8 ${FOCUS}`}>
            <XIcon className="size-4" aria-hidden />
          </button>
        </div>
        <div className="space-y-4 p-4">
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <Pill tone={complaintTone(complaint.status)}>{meta.label}</Pill>
            <span className="flex items-center gap-1 text-adm-text-2">
              <BuildingsIcon className="size-3.5" aria-hidden /> {gymName ?? `Phòng tập mã ${shortRefSafe(complaint.gymId)}`}
            </span>
            <span className="flex items-center gap-1 text-adm-text-2">
              <UserIcon className="size-3.5" aria-hidden /> {SOURCE_LABEL[complaint.source]}
              {complaint.reporterUserId ? ` (mã ${shortRefSafe(complaint.reporterUserId)})` : ""}
            </span>
          </div>

          <p className="whitespace-pre-wrap break-words text-sm text-adm-text">{complaint.description}</p>

          {complaint.photoTokens.length > 0 && (
            <div className="flex flex-wrap gap-2">
              {complaint.photoTokens.map((token) => (
                <AuthenticatedImage key={token} fetchBlob={() => adminService.fetchComplaintPhotoBlob(token)} alt="Ảnh minh chứng" className="size-20" />
              ))}
            </div>
          )}

          {!resolved &&
            (gymCaseEffective(capsQuery.data) ? (
              <OpenCaseSection complaint={complaint} />
            ) : (
              <p className="text-xs text-adm-text-2" data-testid="gym-case-open-off">
                {capsQuery.isLoading ? "Đang kiểm tra chức năng mở hồ sơ…" : "Chức năng mở hồ sơ khiếu nại phòng gym đang tắt ở môi trường hiện tại."}
              </p>
            ))}
          <AssignSection complaint={complaint} onChanged={onChanged} />

          {!resolved ? (
            <div className="space-y-2" data-testid="complaint-status-section">
              <label htmlFor={`${titleId}-resp`} className="text-xs font-semibold text-adm-text">
                Phản hồi cho người báo cáo
              </label>
              <TextArea id={`${titleId}-resp`} value={response} onChange={setResponse} rows={3} placeholder="Bắt buộc khi đánh dấu Đã xử lý — người báo cáo sẽ thấy nội dung này" />
              <p className="text-xs text-adm-text-2" data-testid="complaint-no-refund">
                {COMPLAINT_RESOLVE_NOT_REFUND}
              </p>
              {statusError && <StatusError error={statusError} complaintId={complaint.id} onClose={onClose} />}
              <div className="flex flex-col gap-3 sm:flex-row">
                {complaint.status === "OPEN" && (
                  <ActionButton variant="outline" disabled={updateMutation.isPending} onClick={() => updateMutation.mutate("IN_PROGRESS")} testId="complaint-start">
                    Bắt đầu xử lý
                  </ActionButton>
                )}
                <ActionButton disabled={!response.trim() || updateMutation.isPending} onClick={() => updateMutation.mutate("RESOLVED")} testId="complaint-resolve">
                  Đánh dấu đã xử lý
                </ActionButton>
              </div>
            </div>
          ) : (
            <div className="rounded-lg bg-adm-surface-2 px-3 py-2.5 text-sm" data-testid="complaint-resolved">
              <span className="text-adm-text-2">Phản hồi đã gửi: </span>
              <span className="break-words text-adm-text">{complaint.adminResponse}</span>
              <p className="mt-1 text-[11px] text-adm-text-2">Xử lý xong lúc {complaint.resolvedAt ? new Date(complaint.resolvedAt).toLocaleString("vi-VN") : "—"} — không có phúc thẩm. {COMPLAINT_RESOLVE_NOT_REFUND}</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/** A refused status change. `CASE_REQUIRED` (RESOLVED on a complaint that has a case) leads to the case, not to a retry. */
function StatusError({ error, complaintId, onClose }: { error: GymErrorView; complaintId: string; onClose: () => void }) {
  const navigate = useNavigate();
  const [busy, setBusy] = useState(false);
  const [notFound, setNotFound] = useState(false);
  const caseRequired = error.code === "CASE_REQUIRED";

  async function goToCase() {
    setBusy(true);
    setNotFound(false);
    try {
      for (let offset = 0; offset <= 100000; offset += 100) {
        const list = await gymCaseApi.listCases({ limit: 100, offset });
        const found = findCaseOfComplaint(list.items, complaintId);
        if (found) {
          onClose();
          navigate(casePath(found.id));
          return;
        }
        if (offset + 100 >= list.total || list.items.length === 0) break;
      }
      setNotFound(true);
    } catch {
      setNotFound(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div role="alert" data-testid="complaint-status-error" data-error-code={error.code ?? ""} className="space-y-2 rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2.5 text-sm text-st-danger">
      <p className="break-words">{caseRequired ? CASE_REQUIRED_TEXT : error.message}</p>
      {caseRequired && (
        <div className="space-y-2 text-adm-text">
          <ActionButton variant="outline" onClick={() => void goToCase()} pending={busy} testId="complaint-go-case">
            Mở hồ sơ của khiếu nại này
          </ActionButton>
          {notFound && (
            <p className="text-xs" data-testid="complaint-case-not-found">
              Chưa tìm thấy hồ sơ trong danh sách. Hãy mở tab «Hồ sơ xử lý» để tìm.
            </p>
          )}
        </div>
      )}
    </div>
  );
}

/** G1. The case class is CHOSEN; the membership of the reporter is needed for the classes with a money exit. */
function OpenCaseSection({ complaint }: { complaint: GymComplaint }) {
  const id = useId();
  const navigate = useNavigate();
  const queryClient = useQueryClient();
  const { keys } = useGymQueryKeys();
  const action = useIdempotentAction<{ caseClass: string; membershipId?: string }, Awaited<ReturnType<typeof gymCaseApi.openCase>>>();
  const [open, setOpen] = useState(false);
  const [caseClass, setCaseClass] = useState("");
  const [membershipId, setMembershipId] = useState("");
  const [shown, setShown] = useState(false);
  const [error, setError] = useState<GymErrorView | null>(null);
  const opt = OPEN_CLASS_OPTIONS.find((o) => o.value === caseClass);
  const v = validateOpen({ caseClass, membershipId });
  const errs = { ...(shown ? v : {}), ...fieldErrs(error) };

  async function send() {
    setShown(true);
    setError(null);
    if (hasErrors(v)) return;
    const body = openBody({ caseClass, membershipId });
    const out = await action.run(body, (key, b) => gymCaseApi.openCase(complaint.id, { caseClass: b.caseClass as never, membershipId: b.membershipId }, key));
    if (out.status === "busy") return;
    if (out.status === "error") {
      setError(parseGymError(out.error, { action: "write" }));
      return;
    }
    const r = readOpenResult(out.value);
    if (!r) {
      setError(parseGymError({ response: { status: 500, data: {} } }, { action: "write" }));
      return;
    }
    if (keys) void queryClient.invalidateQueries({ queryKey: keys.caseListAll() });
    if (r.existing) toast.info("Khiếu nại này đã có hồ sơ. Đã đưa bạn vào hồ sơ đó.");
    else toast.success("Đã mở hồ sơ xử lý.");
    navigate(casePath(r.caseId));
  }

  const disabled = error?.code === "GYM_CASE_DISABLED";
  return (
    <section aria-label="Hồ sơ xử lý" className="space-y-2 rounded-xl border border-adm-border-soft bg-adm-surface-2 p-3" data-testid="open-case-section">
      <p className="text-xs font-semibold text-adm-text">Hồ sơ xử lý (điều tra, duyệt bốn mắt, hoàn tiền qua hệ thống)</p>
      {!open ? (
        <ActionButton variant="outline" onClick={() => setOpen(true)} testId="open-case-start">
          Mở hồ sơ xử lý…
        </ActionButton>
      ) : (
        <div className="space-y-3">
          <Field id={`${id}-class`} label="Loại hồ sơ" required error={errs.caseClass} hint={opt?.help}>
            <Select
              id={`${id}-class`}
              value={caseClass}
              onChange={(x) => {
                setCaseClass(x);
                setError(null);
                if (x === "GYM_GENERAL") setMembershipId("");
              }}
              options={OPEN_CLASS_OPTIONS.map((o) => ({ value: o.value, label: o.label }))}
              placeholder="Chọn loại hồ sơ"
              error={errs.caseClass}
              hint={!!opt?.help}
            />
          </Field>
          {opt?.allowsMembership && (
            <Field
              id={`${id}-m`}
              label="Mã gói hội viên của người phản ánh"
              required={opt.needsMembership}
              error={errs.membershipId}
              hint="Gói phải thuộc người phản ánh và đúng chi nhánh của khiếu nại. Máy chủ kiểm lại."
              count={membershipId.trim().length}
              max={LIMITS.membershipId}
            >
              <TextInput id={`${id}-m`} value={membershipId} onChange={(x) => { setMembershipId(x); setError(null); }} error={errs.membershipId} hint mono maxLength={80} />
            </Field>
          )}
          {disabled ? (
            <MutedLine testId="open-case-disabled">{GYM_CASE_DISABLED_NOTE}</MutedLine>
          ) : (
            <ErrorBox error={error} mustReload={false} reloading={false} onReload={() => undefined} onRetry={() => void send()} pending={action.pending} testId="open-case-error" />
          )}
          <ButtonRow>
            <ActionButton onClick={() => void send()} pending={action.pending} testId="open-case-send">
              {error?.outcomeUnknown ? "Mở hồ sơ (thử lại)" : "Mở hồ sơ"}
            </ActionButton>
            <ActionButton variant="outline" onClick={() => { setOpen(false); setError(null); action.reset(); }} disabled={action.pending} testId="open-case-cancel">
              Huỷ
            </ActionButton>
          </ButtonRow>
        </div>
      )}
    </section>
  );
}

function fieldErrs(error: GymErrorView | null): Record<string, string> {
  if (!error) return {};
  if (error.code === "MEMBERSHIP_REQUIRED" || error.code === "MEMBERSHIP_NOT_ALLOWED" || error.code === "MEMBERSHIP_NOT_FOUND" || error.code === "MEMBERSHIP_MISMATCH") return { membershipId: error.message };
  return {};
}

/** `assignedAdminId` must be a real ADMIN: chosen from the ADMIN list, never typed. The server checks again (400 ADMIN_NOT_FOUND / NOT_AN_ADMIN, 503 AUTH_UNAVAILABLE). */
function AssignSection({ complaint, onChanged }: { complaint: GymComplaint; onChanged: (c: GymComplaint) => void }) {
  const id = useId();
  const { keys, userId } = useGymQueryKeys();
  const [pick, setPick] = useState("");
  const [error, setError] = useState<GymErrorView | null>(null);
  const options = useQuery({
    queryKey: keys ? [...keys.all, "admin-options-all"] : ["gym-complaint", "disabled", "a"],
    queryFn: () => listAdminOptions(null),
    enabled: !!keys,
    ...GYM_QUERY_OPTIONS,
  });
  const m = useMutation({
    mutationFn: (adminId: string | null) => adminService.assignComplaintAdmin(complaint.id, adminId),
    onSuccess: (updated) => {
      setError(null);
      setPick("");
      toast.success(updated?.assignedAdminId ? "Đã giao khiếu nại" : "Đã bỏ giao khiếu nại");
      onChanged(updated);
    },
    onError: (e) => setError(parseGymError(e, { action: "write" })),
  });
  const current = complaint.assignedAdminId;
  const label = !current ? "Chưa giao cho ai" : current === userId ? "Đang giao cho bạn" : `Đang giao cho quản trị viên mã ${shortRefSafe(current)}`;
  const list = options.data ?? [];
  return (
    <section aria-label="Người phụ trách khiếu nại" className="space-y-2" data-testid="assign-section">
      <p className="text-xs font-semibold text-adm-text">Người phụ trách khiếu nại</p>
      <p className="text-sm text-adm-text" data-testid="assign-current">
        {label}
      </p>
      <div className="grid grid-cols-1 gap-2 sm:grid-cols-[1fr_auto_auto] sm:items-end">
        <Field id={`${id}-pick`} label="Giao cho quản trị viên" hint={options.isError ? "Chưa lấy được danh sách quản trị viên." : undefined}>
          <Select
            id={`${id}-pick`}
            value={pick}
            onChange={setPick}
            options={list.map((o) => ({ value: o.id, label: o.id === userId ? `${o.label} (bạn)` : o.label }))}
            placeholder={options.isLoading ? "Đang tải danh sách…" : list.length === 0 ? "Không có quản trị viên nào" : "Chọn quản trị viên"}
            disabled={options.isLoading || list.length === 0}
          />
        </Field>
        <ActionButton variant="outline" disabled={!pick || m.isPending} pending={m.isPending} onClick={() => m.mutate(pick)} testId="assign-send">
          Giao
        </ActionButton>
        {current && (
          <ActionButton variant="outline" disabled={m.isPending} onClick={() => m.mutate(null)} testId="assign-clear">
            Bỏ giao
          </ActionButton>
        )}
      </div>
      {error && (
        <p role="alert" data-testid="assign-error" data-error-code={error.code ?? ""} className="rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2 text-sm text-st-danger">
          {error.message}
        </p>
      )}
    </section>
  );
}
