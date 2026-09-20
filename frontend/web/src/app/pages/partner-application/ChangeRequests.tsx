import { useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { toast } from "sonner";
import { WarningCircleIcon as WarningCircle, CheckCircleIcon as CheckCircle2, ArrowRightIcon as ArrowRight } from "@phosphor-icons/react";
import {
  CATEGORY_LABEL,
  ISSUE_STATUS_LABEL,
  friendlyError,
  partnerApplication,
  type ApplicationIssue,
  type IssueStatus,
  type ReviewCategory,
} from "../../services/partnerApplication";

export const CATEGORY_STEP: Record<ReviewCategory, string> = {
  REPRESENTATIVE: "representative",
  BRAND: "brand",
  BRANCH: "branch",
  LOCATION: "location",
  PHOTOS: "photos",
  LEGAL: "legal",
  OTHER: "review",
};

const BADGE: Record<IssueStatus, string> = {
  OPEN: "bg-amber-500/10 text-amber-300",
  RESUBMITTED: "bg-blue-500/10 text-blue-300",
  RESOLVED: "bg-green-500/10 text-green-400",
};

/** Yêu cầu chỉnh sửa của admin, theo từng mục: nhảy tới đúng bước, đánh dấu "đã cập nhật" (nộp lại KHÔNG tự đóng issue). */
export function ChangeRequestCards({
  issues,
  editable,
  onGoTo,
  onChanged,
}: {
  issues: ApplicationIssue[];
  editable: boolean;
  onGoTo?: (step: string) => void;
  onChanged: () => void;
}) {
  if (issues.length === 0) return null;
  return (
    <section aria-label="Yêu cầu chỉnh sửa" className="space-y-2.5">
      <h2 className="text-sm font-bold text-amber-300 flex items-center gap-1.5">
        <WarningCircle className="w-4 h-4" /> Gymini đề nghị bạn chỉnh sửa
      </h2>
      {issues.map((i) => (
        <IssueCard key={i.id} issue={i} editable={editable} onGoTo={onGoTo} onChanged={onChanged} />
      ))}
    </section>
  );
}

function IssueCard({ issue, editable, onGoTo, onChanged }: { issue: ApplicationIssue; editable: boolean; onGoTo?: (step: string) => void; onChanged: () => void }) {
  const [note, setNote] = useState("");
  const mark = useMutation({
    mutationFn: () => partnerApplication.markIssueUpdated(issue.id, note.trim() || undefined),
    onSuccess: () => {
      toast.success("Đã đánh dấu là đã cập nhật");
      onChanged();
    },
    onError: (e) => toast.error(friendlyError(e).message),
  });

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-900 p-3.5 space-y-2.5">
      <div className="flex items-center justify-between gap-2">
        <span className="text-xs font-semibold text-zinc-300">{CATEGORY_LABEL[issue.category]}</span>
        <span className={`rounded-full px-2.5 py-1 text-[11px] font-semibold ${BADGE[issue.status]}`}>{ISSUE_STATUS_LABEL[issue.status]}</span>
      </div>
      <p className="text-sm text-zinc-200">{issue.message}</p>
      {issue.adminFollowUp && <p className="text-xs text-amber-300">Gymini nhắn thêm: {issue.adminFollowUp}</p>}
      {issue.status === "RESUBMITTED" && issue.resubmitNote && <p className="text-xs text-zinc-500">Ghi chú của bạn: {issue.resubmitNote}</p>}

      {editable && issue.status === "OPEN" && (
        <div className="space-y-2">
          <input
            value={note}
            onChange={(e) => setNote(e.target.value)}
            maxLength={500}
            placeholder="Ghi chú cho Gymini (không bắt buộc)"
            className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 placeholder-zinc-600 outline-none focus:border-green-500/50"
          />
          <div className="flex flex-wrap gap-2">
            {onGoTo && (
              <button onClick={() => onGoTo(CATEGORY_STEP[issue.category])} className="inline-flex items-center gap-1 rounded-lg border border-zinc-700 px-3 py-1.5 text-xs font-semibold text-zinc-200 hover:border-zinc-500">
                Đi tới mục này <ArrowRight className="w-3 h-3" />
              </button>
            )}
            <button
              onClick={() => mark.mutate()}
              disabled={mark.isPending}
              className="inline-flex items-center gap-1 rounded-lg bg-green-500 px-3 py-1.5 text-xs font-bold text-black hover:bg-green-400 disabled:opacity-50"
            >
              <CheckCircle2 className="w-3.5 h-3.5" /> Đánh dấu đã cập nhật
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
