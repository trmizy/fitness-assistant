import { useState } from "react";
import { WarningCircleIcon } from "@phosphor-icons/react";
import { Checkbox } from "../ui/checkbox";
import { Textarea } from "../ui/textarea";
import { Button } from "../ui/button";
import type { BranchReviewCategory } from "../../types";

const CATEGORIES: { value: BranchReviewCategory; label: string }[] = [
  { value: "BASIC_INFO", label: "Thông tin cơ bản" },
  { value: "LOCATION", label: "Địa điểm" },
  { value: "OPENING_HOURS", label: "Giờ hoạt động" },
  { value: "FACILITIES", label: "Tiện ích & Dịch vụ" },
  { value: "PHOTOS", label: "Hình ảnh" },
  { value: "VERIFICATION", label: "Xác minh" },
  { value: "OTHER", label: "Khác" },
];

export interface BranchReviewIssue {
  category: BranchReviewCategory;
  message: string;
}

export interface BranchReviewIssuesPanelProps {
  mode: "compose" | "view";
  /** "view" mode only — the branch's currently-open issues. */
  issues?: BranchReviewIssue[];
  onSubmit?: (issues: BranchReviewIssue[]) => void | Promise<void>;
  submitLabel?: string;
}

const CATEGORY_LABEL: Record<BranchReviewCategory, string> = Object.fromEntries(CATEGORIES.map((c) => [c.value, c.label])) as Record<
  BranchReviewCategory,
  string
>;

/**
 * GYM_BRANCH_FORM_SPEC.md, Phase 4 — "Request Changes" by category on a branch's first-time
 * PENDING_REVIEW wizard submission. Mirrors RequestChangesPanel's exact interaction shape
 * (checkbox reveals a textarea) extended from 2 fixed fields to 7 fixed categories — this is
 * a SEPARATE mechanism from that one (see gymBranchReviewService's own doc comment for why),
 * so it's a new component rather than a generalization of the old one.
 */
export function BranchReviewIssuesPanel({ mode, issues, onSubmit, submitLabel = "Gửi yêu cầu chỉnh sửa" }: BranchReviewIssuesPanelProps) {
  const [flagged, setFlagged] = useState<Set<BranchReviewCategory>>(new Set());
  const [messages, setMessages] = useState<Partial<Record<BranchReviewCategory, string>>>({});

  if (mode === "view") {
    if (!issues || issues.length === 0) return null;
    return (
      <div className="space-y-2 rounded-lg border border-amber-500/20 bg-amber-500/5 p-3">
        <div className="flex items-center gap-1.5 text-amber-400 text-sm font-semibold">
          <WarningCircleIcon className="size-4" />
          Admin đã yêu cầu chỉnh sửa
        </div>
        {issues.map((issue, i) => (
          <div key={i} className="text-sm">
            <span className="font-medium text-zinc-300">{CATEGORY_LABEL[issue.category]}: </span>
            <span className="text-zinc-400">{issue.message}</span>
          </div>
        ))}
      </div>
    );
  }

  function toggle(category: BranchReviewCategory, checked: boolean) {
    setFlagged((prev) => {
      const next = new Set(prev);
      if (checked) next.add(category);
      else next.delete(category);
      return next;
    });
  }

  const composed: BranchReviewIssue[] = CATEGORIES.filter((c) => flagged.has(c.value) && messages[c.value]?.trim()).map((c) => ({
    category: c.value,
    message: messages[c.value]!.trim(),
  }));
  const canSubmit = composed.length > 0;

  return (
    <div className="space-y-3">
      {CATEGORIES.map((c) => (
        <div key={c.value} className="space-y-1.5">
          <label className="flex items-center gap-2 text-sm">
            <Checkbox checked={flagged.has(c.value)} onCheckedChange={(v) => toggle(c.value, v === true)} />
            Yêu cầu chỉnh sửa — {c.label}
          </label>
          {flagged.has(c.value) && (
            <Textarea
              value={messages[c.value] ?? ""}
              onChange={(e) => setMessages((prev) => ({ ...prev, [c.value]: e.target.value }))}
              placeholder={`Vì sao mục "${c.label}" cần sửa?`}
              rows={2}
            />
          )}
        </div>
      ))}
      <Button disabled={!canSubmit} onClick={() => onSubmit?.(composed)}>
        {submitLabel}
      </Button>
    </div>
  );
}
