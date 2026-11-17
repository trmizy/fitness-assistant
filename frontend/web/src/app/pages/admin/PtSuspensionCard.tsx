import { useId, useRef, useState } from "react";
import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { ProhibitIcon, PlayCircleIcon } from "@phosphor-icons/react";
import { adminPtRestrictionService } from "../../services/adminPtRestrictionService";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Textarea } from "../../components/ui/textarea";
import { formatDateVi } from "../../utils/contractGymOptions";
import {
  LIFT_EFFECT,
  LIFT_SUCCESS,
  PT_STATE_LABEL,
  SUSPEND_CATEGORY_OPTIONS,
  SUSPEND_EFFECT,
  SUSPEND_PUBLIC_REASON_MAX,
  SUSPEND_REASON_MAX,
  SUSPEND_SUCCESS,
  buildSuspendBody,
  ptAccountState,
  ptSuspensionError,
  publicReasonError,
  suspendCategoryLabel,
  suspensionReasonError,
  type SuspendCategory,
} from "./ptSuspension";

const LABEL = "mb-1 block text-xs font-semibold text-zinc-400";
const FIELD = "w-full min-h-10 rounded-xl border border-zinc-800 bg-zinc-950 px-3 text-sm text-zinc-200 outline-none focus:border-green-500";

/**
 * N15B-04: the admin's own switch on an APPROVED PT - "Tạm khoá" / "Mở lại". The card shows the real state (read from the PT's
 * restriction history), and each action opens a confirm dialog that says in plain words what happens to search, sessions and
 * contracts, takes the internal reason (required) and an optional message the PT may read. A permanent ban is shown but cannot be
 * changed here (the server refuses; it lifts through the account unlock).
 */
export function PtSuspensionCard({ ptUserId, ptName }: { ptUserId: string; ptName: string }) {
  const queryClient = useQueryClient();
  const triggerRef = useRef<HTMLButtonElement>(null);
  const [mode, setMode] = useState<"SUSPEND" | "LIFT" | null>(null);
  const history = useQuery({
    queryKey: ["admin-pt-restrictions", ptUserId],
    queryFn: () => adminPtRestrictionService.history(ptUserId),
    staleTime: 15_000,
  });
  const state = ptAccountState(history.data);
  const close = () => {
    setMode(null);
    window.setTimeout(() => triggerRef.current?.focus(), 60);
  };
  const tone =
    state.kind === "ACTIVE"
      ? "bg-st-success-bg text-st-success border-st-success-border"
      : state.kind === "SUSPENDED"
        ? "bg-st-warning-bg text-st-warning border-st-warning-border"
        : "bg-st-danger-bg text-st-danger border-st-danger-border";

  return (
    <div data-testid="pt-suspension-card" className="bg-zinc-900 rounded-2xl border border-zinc-800/60 p-6 space-y-4 shadow-xl">
      <p className="text-xs font-bold text-zinc-500 uppercase flex items-center gap-2">
        <ProhibitIcon className="w-4 h-4 text-amber-400" aria-hidden /> Trạng thái hoạt động
      </p>
      {history.isLoading ? (
        <p className="text-xs text-zinc-500">Đang tải trạng thái…</p>
      ) : history.isError ? (
        <div className="space-y-2">
          <p role="alert" className="text-xs text-st-danger">Chưa tải được trạng thái huấn luyện viên.</p>
          <button type="button" onClick={() => void history.refetch()} className="min-h-10 rounded-lg border border-zinc-700 px-3 text-xs font-medium text-zinc-300 hover:bg-zinc-800">
            Thử lại
          </button>
        </div>
      ) : (
        <>
          <span data-testid="pt-suspension-badge" className={`inline-flex items-center rounded-full border px-2.5 py-1 text-[10px] font-bold uppercase tracking-wider ${tone}`}>
            {PT_STATE_LABEL[state.kind]}
          </span>
          {state.kind !== "ACTIVE" && (
            <div className="space-y-1 text-xs text-zinc-400 leading-relaxed" data-testid="pt-suspension-info">
              {state.episode.startedAt && <p>Từ {formatDateVi(state.episode.startedAt)} · {suspendCategoryLabel(state.episode.reasonCategory)}</p>}
              {state.episode.reasonText && <p className="break-words">Ghi chú nội bộ: {state.episode.reasonText}</p>}
              {state.kind === "SUSPENDED" && state.episode.overdue && <p className="text-st-warning">Đã tạm khoá quá lâu, cần xem xét lại.</p>}
              {state.kind === "BANNED" && <p>Khoá vĩnh viễn được gỡ bằng cách mở khoá tài khoản, không làm ở đây.</p>}
            </div>
          )}
          {state.kind === "ACTIVE" && (
            <button
              ref={triggerRef}
              type="button"
              data-testid="pt-suspend-open"
              onClick={() => setMode("SUSPEND")}
              className="w-full min-h-10 inline-flex items-center justify-center gap-2 rounded-xl border border-st-warning-border bg-st-warning-bg text-st-warning text-xs font-bold transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--adm-focus)]"
            >
              <ProhibitIcon className="w-4 h-4" aria-hidden /> Tạm khoá huấn luyện viên
            </button>
          )}
          {state.kind === "SUSPENDED" && (
            <button
              ref={triggerRef}
              type="button"
              data-testid="pt-lift-open"
              onClick={() => setMode("LIFT")}
              className="w-full min-h-10 inline-flex items-center justify-center gap-2 rounded-xl border border-st-success-border bg-st-success-bg text-st-success text-xs font-bold transition-colors hover:brightness-110 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--adm-focus)]"
            >
              <PlayCircleIcon className="w-4 h-4" aria-hidden /> Mở lại huấn luyện viên
            </button>
          )}
        </>
      )}
      {mode && (
        <SuspensionDialog
          mode={mode}
          ptUserId={ptUserId}
          ptName={ptName}
          onClose={close}
          onDone={() => void queryClient.invalidateQueries({ queryKey: ["admin-pt-restrictions", ptUserId] })}
        />
      )}
    </div>
  );
}

function SuspensionDialog({ mode, ptUserId, ptName, onClose, onDone }: { mode: "SUSPEND" | "LIFT"; ptUserId: string; ptName: string; onClose: () => void; onDone: () => void }) {
  const uid = useId();
  const [category, setCategory] = useState<SuspendCategory>("COMPLAINT_REVIEW");
  const [reason, setReason] = useState("");
  const [publicReason, setPublicReason] = useState("");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const reasonError = suspensionReasonError(reason);
  const pubError = mode === "SUSPEND" ? publicReasonError(publicReason) : null;
  const suspend = mode === "SUSPEND";

  const run = useMutation({
    mutationFn: () => (suspend ? adminPtRestrictionService.suspend(ptUserId, buildSuspendBody(category, reason, publicReason)) : adminPtRestrictionService.lift(ptUserId, reason.trim())),
    onSuccess: () => {
      toast.success(suspend ? SUSPEND_SUCCESS : LIFT_SUCCESS);
      onDone();
      onClose();
    },
    onError: (e) => setServerError(ptSuspensionError(e)),
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={suspend ? `Tạm khoá ${ptName}?` : `Mở lại ${ptName}?`}
      description={suspend ? SUSPEND_EFFECT : LIFT_EFFECT}
      confirmLabel={suspend ? "Tạm khoá" : "Mở lại"}
      danger={suspend}
      confirmDisabled={!!reasonError || !!pubError}
      onConfirm={async () => {
        setTouched(true);
        setServerError(null);
        if (reasonError || pubError) return;
        try {
          await run.mutateAsync();
        } catch {
          /* hiện ở dòng lỗi trong hộp thoại */
        }
      }}
    >
      <div data-testid="pt-suspension-dialog" className="space-y-3">
        {suspend && (
          <div>
            <label className={LABEL} htmlFor={`${uid}-cat`}>Nhóm lý do</label>
            <select id={`${uid}-cat`} className={FIELD} value={category} onChange={(e) => setCategory(e.target.value as SuspendCategory)}>
              {SUSPEND_CATEGORY_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>{o.label}</option>
              ))}
            </select>
          </div>
        )}
        <div>
          <label className={LABEL} htmlFor={`${uid}-reason`}>
            {suspend ? "Lý do (chỉ quản trị viên thấy)" : "Lý do mở lại"} <span className="text-st-danger">*</span>
          </label>
          <Textarea
            id={`${uid}-reason`}
            rows={3}
            maxLength={SUSPEND_REASON_MAX}
            value={reason}
            aria-invalid={touched && reasonError ? true : undefined}
            onChange={(e) => {
              setServerError(null);
              setReason(e.target.value);
            }}
          />
          {reasonError && <p className={`mt-1 text-[11px] ${touched ? "text-st-danger" : "text-zinc-500"}`}>Lý do là bắt buộc.</p>}
        </div>
        {suspend && (
          <div>
            <label className={LABEL} htmlFor={`${uid}-pub`}>Lời nhắn cho huấn luyện viên (không bắt buộc)</label>
            <Textarea id={`${uid}-pub`} rows={2} maxLength={SUSPEND_PUBLIC_REASON_MAX} value={publicReason} onChange={(e) => setPublicReason(e.target.value)} />
            <p className="mt-1 text-[11px] text-zinc-500">Bỏ trống thì huấn luyện viên chỉ thấy nhóm lý do ở trên.</p>
          </div>
        )}
        {serverError && (
          <p role="alert" data-testid="pt-suspension-error" className="rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2 text-xs text-st-danger">
            {serverError}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
