import { useState } from "react";
import { ConfirmDialog } from "./ConfirmDialog";
import { Textarea } from "./textarea";
import { Label } from "./label";
import { cn } from "./utils";

export interface ImpactRow {
  label: string;
  value: string;
  /** Right-aligns and renders in a tabular-numeral mono font — for money/counts (§54). */
  isNumeric?: boolean;
  /** e.g. call out "MANAGER accounts still can log in" as a reassurance, not an alarm. */
  tone?: "neutral" | "danger" | "positive";
}

export interface ImpactDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** e.g. "Toàn bộ hội viên đang hoạt động sẽ tiếp tục ✅ / Không thể rút tiền ❌" rows. */
  impact: ImpactRow[];
  confirmLabel: string;
  onConfirm: (reason: string) => void | Promise<void>;
  reasonLabel?: string;
  reasonRequired?: boolean;
  reasonPlaceholder?: string;
}

const TONE_TEXT: Record<NonNullable<ImpactRow["tone"]>, string> = {
  neutral: "text-zinc-200",
  danger: "text-red-400",
  positive: "text-green-400",
};

/**
 * GYM_MANAGEMENT master spec §49 — destructive-action dialog with a real impact summary
 * (counts + money), a required reason, and the safe-button-is-primary structure inherited
 * from ConfirmDialog. Used for: suspend, permanent close, terminate partnership, reject
 * partner, revoke account.
 */
export function ImpactDialog({
  open,
  onOpenChange,
  title,
  impact,
  confirmLabel,
  onConfirm,
  reasonLabel = "Lý do",
  reasonRequired = true,
  reasonPlaceholder = "Bắt buộc — sẽ được ghi vào nhật ký kiểm toán",
}: ImpactDialogProps) {
  const [reason, setReason] = useState("");

  return (
    <ConfirmDialog
      open={open}
      onOpenChange={(next) => {
        if (!next) setReason("");
        onOpenChange(next);
      }}
      title={title}
      confirmLabel={confirmLabel}
      confirmDisabled={reasonRequired && !reason.trim()}
      onConfirm={() => onConfirm(reason.trim())}
    >
      <div className="space-y-4">
        <div className="rounded-lg border border-zinc-800 divide-y divide-zinc-800 overflow-hidden">
          {impact.map((row, i) => (
            <div key={i} className="flex items-center justify-between px-3 py-2 text-sm">
              <span className="text-zinc-400">{row.label}</span>
              <span
                className={cn(
                  TONE_TEXT[row.tone ?? "neutral"],
                  row.isNumeric && "font-mono tabular-nums font-semibold",
                )}
              >
                {row.value}
              </span>
            </div>
          ))}
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="impact-dialog-reason">{reasonLabel}</Label>
          <Textarea
            id="impact-dialog-reason"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder={reasonPlaceholder}
            rows={3}
          />
        </div>
      </div>
    </ConfirmDialog>
  );
}
