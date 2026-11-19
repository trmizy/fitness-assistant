import { useId, useRef, useState } from "react";
import { useMutation, useQueryClient } from "@tanstack/react-query";
import { toast } from "sonner";
import { DotsThreeVerticalIcon } from "@phosphor-icons/react";
import { adminService } from "../../services/api";
import type { Gym } from "../../types";
import { ConfirmDialog } from "../../components/ui/ConfirmDialog";
import { Input } from "../../components/ui/input";
import { Textarea } from "../../components/ui/textarea";
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuTrigger } from "../../components/ui/dropdown-menu";
import { MAX_ADMIN_REASON, MIN_ADMIN_REASON, buildLifecycleBody, lifecycleActionsFor, lifecycleError, type LifecycleMeta } from "../../utils/adminGymManage";

const LABEL = "mb-1 block text-xs font-semibold text-adm-text-2";

const SUCCESS: Record<LifecycleMeta["action"], string> = {
  SUSPEND: "Đã tạm khoá chi nhánh",
  LIFT_SUSPENSION: "Đã bỏ tạm khoá chi nhánh",
  CLOSE_TEMPORARILY: "Đã tạm đóng cửa chi nhánh",
  REOPEN: "Đã mở cửa lại chi nhánh",
};

/**
 * FIX2-ADMIN Q5: the admin's own switches on ONE branch - tạm khoá / bỏ tạm khoá (moderation) and tạm đóng cửa / mở cửa lại (operations).
 * A "Thao tác" menu on the branch card offers only what the branch's current state allows; every action opens a confirm dialog that says in
 * plain words what changes for members and the owner, takes a reason (required for the two restrictive ones) and records an audit row
 * (the partner's "Nhật ký" shows it). Closing a branch for good is the owner's one-way decision and is not offered here.
 */
export function AdminGymLifecycleMenu({ gym }: { gym: Gym }) {
  const actions = lifecycleActionsFor(gym);
  const [target, setTarget] = useState<LifecycleMeta | null>(null);
  // The dialog opens from a menu item that disappears with the menu, so focus goes back to the menu button on close.
  const triggerRef = useRef<HTMLButtonElement>(null);
  const closeDialog = () => {
    setTarget(null);
    window.setTimeout(() => triggerRef.current?.focus(), 60);
  };
  if (actions.length === 0) return null;
  const name = gym.approvedName ?? gym.name;
  return (
    <>
      <DropdownMenu>
        <DropdownMenuTrigger asChild>
          <button
            ref={triggerRef}
            type="button"
            data-testid="admin-gym-lifecycle-trigger"
            aria-label={`Thao tác trạng thái với ${name}`}
            className="inline-flex min-h-10 items-center gap-1 rounded-lg border border-zinc-700 px-3 text-xs font-medium text-zinc-300 transition-colors hover:bg-zinc-800 focus-visible:outline focus-visible:outline-2 focus-visible:outline-[var(--adm-focus)]"
          >
            <DotsThreeVerticalIcon className="size-4" aria-hidden /> Trạng thái
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start">
          {actions.map((a) => (
            <DropdownMenuItem key={a.action} data-testid={`admin-gym-lifecycle-${a.action}`} className="min-h-10" onSelect={() => setTarget(a)}>
              {a.label}
            </DropdownMenuItem>
          ))}
        </DropdownMenuContent>
      </DropdownMenu>
      {target && <LifecycleDialog gym={gym} meta={target} onClose={closeDialog} />}
    </>
  );
}

function LifecycleDialog({ gym, meta, onClose }: { gym: Gym; meta: LifecycleMeta; onClose: () => void }) {
  const uid = useId();
  const queryClient = useQueryClient();
  const [reason, setReason] = useState("");
  const [reopenDate, setReopenDate] = useState("");
  const [touched, setTouched] = useState(false);
  const [serverError, setServerError] = useState<string | null>(null);
  const errors = lifecycleError(meta, reason, reopenDate);
  const count = reason.trim().length;
  const name = gym.approvedName ?? gym.name;

  const run = useMutation({
    mutationFn: () => adminService.setGymLifecycle(gym.id, buildLifecycleBody(meta, reason, reopenDate) as any),
    onSuccess: () => {
      toast.success(SUCCESS[meta.action]);
      void queryClient.invalidateQueries({ queryKey: ["admin-gyms"] });
      void queryClient.invalidateQueries({ queryKey: ["admin-gyms-permanently-closed"] });
      onClose();
    },
    onError: (e: any) => setServerError(e?.response?.data?.error?.message || "Không thể cập nhật. Vui lòng thử lại."),
  });

  return (
    <ConfirmDialog
      open
      onOpenChange={(o) => !o && onClose()}
      title={`${meta.label}: ${name}?`}
      description={meta.effect}
      confirmLabel={meta.confirmLabel}
      danger={meta.danger}
      confirmDisabled={!!errors.reason || !!errors.date}
      onConfirm={async () => {
        setTouched(true);
        setServerError(null);
        if (errors.reason || errors.date) return;
        try {
          await run.mutateAsync();
        } catch {
          /* hiện ở dòng lỗi trong hộp thoại */
        }
      }}
    >
      <div data-testid="admin-gym-lifecycle-dialog" className="space-y-3">
        <div>
          <label className={LABEL} htmlFor={`${uid}-reason`}>
            {meta.reasonLabel}
            {meta.reasonRequired && <span className="text-st-danger"> *</span>}
          </label>
          <Textarea
            id={`${uid}-reason`}
            rows={3}
            maxLength={MAX_ADMIN_REASON}
            value={reason}
            aria-invalid={touched && errors.reason ? true : undefined}
            aria-describedby={`${uid}-reason-hint`}
            onChange={(e) => {
              setServerError(null);
              setReason(e.target.value);
            }}
          />
          <div id={`${uid}-reason-hint`} className="mt-1 flex items-start justify-between gap-3 text-[11px]">
            <span className="text-adm-text-2">
              {meta.reasonRequired ? `Tối thiểu ${MIN_ADMIN_REASON} ký tự. ` : ""}Lý do được ghi vào nhật ký kiểm toán của đối tác.
            </span>
            <span data-testid="admin-gym-lifecycle-reason-count" className={`shrink-0 tabular-nums ${!meta.reasonRequired || count >= MIN_ADMIN_REASON ? "text-st-success" : "text-adm-text-2"}`}>
              {meta.reasonRequired ? `${count}/${MIN_ADMIN_REASON}` : count}
            </span>
          </div>
          {errors.reason && (touched || count > 0) && (
            <p role="alert" className="mt-1 text-[11px] text-st-danger">
              {errors.reason}
            </p>
          )}
        </div>
        {meta.askReopenDate && (
          <div>
            <label className={LABEL} htmlFor={`${uid}-date`}>Dự kiến mở cửa lại (không bắt buộc)</label>
            <Input id={`${uid}-date`} className="min-h-10" type="date" value={reopenDate} onChange={(e) => setReopenDate(e.target.value)} aria-invalid={errors.date ? true : undefined} />
            {errors.date && (
              <p role="alert" className="mt-1 text-[11px] text-st-danger">
                {errors.date}
              </p>
            )}
          </div>
        )}
        {serverError && (
          <p role="alert" data-testid="admin-gym-lifecycle-error" className="rounded-lg border border-st-danger-border bg-st-danger-bg px-3 py-2 text-xs text-st-danger">
            {serverError}
          </p>
        )}
      </div>
    </ConfirmDialog>
  );
}
