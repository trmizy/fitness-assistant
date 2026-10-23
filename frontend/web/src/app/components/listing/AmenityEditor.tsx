import { useEffect, useState } from "react";
import { CheckIcon, ClockIcon, PencilSimpleIcon, PlusIcon, TrashIcon, WarningCircleIcon, CircleNotchIcon } from "@phosphor-icons/react";
import { Button } from "../ui/button";
import { Input } from "../ui/input";
import { Textarea } from "../ui/textarea";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "../ui/dialog";
import { AmenityIcon } from "./AmenityIcon";
import { cn } from "../ui/utils";
import { AMENITY_CATEGORIES, AMENITY_CATEGORY_LABEL, amenityCategoryLabel } from "../../utils/amenityIcons";
import {
  PROPOSAL_NAME_MAX,
  PROPOSAL_NOTE_MAX,
  groupAmenitiesByCategory,
  pendingReenableFor,
  proposalFormError,
  type CatalogAmenity,
  type DisabledAmenityNotice,
  type OwnerProposal,
} from "../../utils/gymListing";
import type { AmenityCategory } from "../../types";

const sectionLabel = "text-xs font-semibold uppercase tracking-wider text-zinc-500";

/** Amenities grouped by the four categories, each a toggle chip with its icon. A selected DISABLED one is flagged so it can be removed. */
export function AmenityChipGroups({
  amenities,
  selectedIds,
  onToggle,
  disabled,
}: {
  amenities: CatalogAmenity[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const groups = groupAmenitiesByCategory(amenities);
  if (groups.length === 0) return <p className="text-sm text-zinc-500">Chưa có tiện ích nào trong danh mục.</p>;
  return (
    <div className="space-y-4">
      {groups.map((g) => (
        <div key={g.category} className="space-y-2">
          <p className={sectionLabel}>{AMENITY_CATEGORY_LABEL[g.category]}</p>
          <div className="flex flex-wrap gap-2">
            {g.items.map((a) => {
              const on = selectedIds.includes(a.id);
              const off = a.status !== "ACTIVE";
              return (
                <button
                  key={a.id}
                  type="button"
                  aria-pressed={on}
                  disabled={disabled}
                  onClick={() => onToggle(a.id)}
                  className={cn(
                    "inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-2 text-sm font-medium transition-colors disabled:opacity-50",
                    on ? "border-green-500/50 bg-green-500/15 text-green-300" : "border-zinc-700/60 bg-zinc-800/50 text-zinc-300 hover:border-zinc-500",
                    off && "border-dashed",
                  )}
                >
                  {on ? <CheckIcon className="size-3.5" weight="bold" /> : <AmenityIcon iconKey={a.iconKey} className="size-4" />}
                  {a.name}
                  {off && <span className="text-[10px] text-amber-400">(đã ngừng)</span>}
                </button>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

export interface ProposalFormValues {
  name: string;
  suggestedCategory: AmenityCategory;
  note: string;
}

/** Create / edit a proposal: name (2–40), the category the owner suggests (the admin decides), an optional note. */
export function ProposeAmenityDialog({
  open,
  onOpenChange,
  initial,
  title,
  submitLabel,
  pending,
  onSubmit,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  initial?: Partial<ProposalFormValues>;
  title: string;
  submitLabel: string;
  pending: boolean;
  onSubmit: (v: ProposalFormValues) => void | Promise<void>;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AmenityCategory | "">("");
  const [note, setNote] = useState("");
  const [touched, setTouched] = useState(false);

  useEffect(() => {
    if (open) {
      setName(initial?.name ?? "");
      setCategory(initial?.suggestedCategory ?? "");
      setNote(initial?.note ?? "");
      setTouched(false);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const error = proposalFormError({ name, category: category || null, note });
  return (
    <Dialog open={open} onOpenChange={(o) => !pending && onOpenChange(o)}>
      <DialogContent className="max-h-[90vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle>{title}</DialogTitle>
          <DialogDescription>Gymini sẽ xem và duyệt đề xuất. Tiện ích đã có sẵn trong danh mục sẽ được chọn giúp bạn, không tạo bản trùng.</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div>
            <label htmlFor="amenity-proposal-name" className="mb-1.5 block text-xs font-semibold text-zinc-500">Tên tiện ích</label>
            <Input id="amenity-proposal-name" value={name} maxLength={PROPOSAL_NAME_MAX + 10} placeholder="Ví dụ: Phòng boxing" onChange={(e) => setName(e.target.value)} />
          </div>
          <div>
            <label htmlFor="amenity-proposal-category" className="mb-1.5 block text-xs font-semibold text-zinc-500">Nhóm gợi ý</label>
            <select
              id="amenity-proposal-category"
              value={category}
              onChange={(e) => setCategory(e.target.value as AmenityCategory)}
              className="w-full rounded-lg border border-zinc-700/60 bg-zinc-800 px-3 py-2.5 text-sm text-zinc-200 outline-none focus:border-green-500/50"
            >
              <option value="">Chọn nhóm</option>
              {AMENITY_CATEGORIES.map((c) => (
                <option key={c} value={c}>{AMENITY_CATEGORY_LABEL[c]}</option>
              ))}
            </select>
          </div>
          <div>
            <label htmlFor="amenity-proposal-note" className="mb-1.5 block text-xs font-semibold text-zinc-500">Ghi chú (không bắt buộc)</label>
            <Textarea id="amenity-proposal-note" rows={3} value={note} maxLength={PROPOSAL_NOTE_MAX + 50} onChange={(e) => setNote(e.target.value)} />
          </div>
          {touched && error && <p role="alert" className="text-xs text-red-400">{error}</p>}
        </div>
        <DialogFooter>
          <Button variant="outline" disabled={pending} onClick={() => onOpenChange(false)}>Hủy</Button>
          <Button
            disabled={pending}
            onClick={() => {
              setTouched(true);
              if (error) return;
              void onSubmit({ name: name.trim(), suggestedCategory: category as AmenityCategory, note: note.trim() });
            }}
          >
            {pending && <CircleNotchIcon className="size-4 animate-spin" />}
            {submitLabel}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

/**
 * The whole amenity block of a branch: catalogue chips by category, the owner's own pending proposals (attach / edit /
 * cancel), the rejected ones with the admin's reason, the "amenity switched off" notice with "Đề xuất bật lại", and the
 * "Đề xuất tiện ích mới" button. Stateless about the server: the parent owns selection and the proposal calls.
 */
export function AmenityEditor({
  amenities,
  selectedIds,
  onToggle,
  proposals,
  attachedProposalIds,
  onToggleProposal,
  onProposeClick,
  onEditProposal,
  onCancelProposal,
  disabledNotices = [],
  onReenable,
  busy,
  loading,
  error,
  onRetry,
}: {
  amenities: CatalogAmenity[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  /** This branch's proposals (any status). */
  proposals: OwnerProposal[];
  attachedProposalIds: string[];
  onToggleProposal?: (id: string) => void;
  onProposeClick: () => void;
  onEditProposal: (p: OwnerProposal) => void;
  onCancelProposal: (p: OwnerProposal) => void;
  disabledNotices?: DisabledAmenityNotice[];
  onReenable?: (n: DisabledAmenityNotice) => void;
  busy?: boolean;
  loading?: boolean;
  error?: string | null;
  onRetry?: () => void;
}) {
  const pending = proposals.filter((p) => p.status === "PENDING");
  const rejected = proposals.filter((p) => p.status === "REJECTED" && p.rejectReason);
  const total = selectedIds.length + attachedProposalIds.length;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">{total === 0 ? "Cần chọn ít nhất một tiện ích." : `Đã chọn ${total} tiện ích.`}</p>
        <Button type="button" size="sm" variant="outline" disabled={busy} onClick={onProposeClick}>
          <PlusIcon /> Đề xuất tiện ích mới
        </Button>
      </div>

      {disabledNotices.length > 0 && (
        <div className="space-y-2 rounded-xl border border-amber-500/30 bg-amber-500/10 p-3">
          <p className="flex items-start gap-2 text-xs leading-5 text-amber-200">
            <WarningCircleIcon className="mt-0.5 size-4 shrink-0" />
            Một số tiện ích đã ngừng trong danh mục và không còn hiển thị với khách. Bạn có thể đề xuất bật lại.
          </p>
          <ul className="space-y-1.5">
            {disabledNotices.map((n) => {
              const waiting = pendingReenableFor(proposals, n.amenityId);
              return (
                <li key={n.amenityId} className="flex items-center justify-between gap-2 text-sm text-zinc-200">
                  <span className="min-w-0 truncate">{n.name}</span>
                  {waiting ? (
                    <span className="shrink-0 text-xs text-blue-300">Đã gửi yêu cầu bật lại</span>
                  ) : (
                    <Button type="button" size="sm" variant="outline" disabled={busy || !onReenable} onClick={() => onReenable?.(n)}>
                      Đề xuất bật lại
                    </Button>
                  )}
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {loading ? (
        <div className="flex justify-center py-6"><CircleNotchIcon className="size-5 animate-spin text-green-400" /></div>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          {onRetry && <Button size="sm" variant="outline" onClick={onRetry}>Thử lại</Button>}
        </div>
      ) : (
        <AmenityChipGroups amenities={amenities} selectedIds={selectedIds} onToggle={onToggle} disabled={busy} />
      )}

      {pending.length > 0 && (
        <div className="space-y-2 border-t border-zinc-800/70 pt-3">
          <p className={sectionLabel}>Đề xuất của bạn</p>
          <ul className="space-y-2">
            {pending.map((p) => {
              const on = attachedProposalIds.includes(p.id);
              return (
                <li key={p.id} className={cn("flex flex-wrap items-center gap-2 rounded-xl border p-2.5", on ? "border-blue-500/40 bg-blue-500/5" : "border-zinc-800 opacity-80")}>
                  <button
                    type="button"
                    aria-pressed={on}
                    disabled={busy || !onToggleProposal}
                    onClick={() => onToggleProposal?.(p.id)}
                    className="flex min-w-0 flex-1 items-center gap-2 text-left text-sm text-zinc-200 disabled:cursor-default"
                  >
                    <ClockIcon className="size-4 shrink-0 text-blue-300" />
                    <span className="min-w-0 truncate">{p.name}</span>
                    <span className="shrink-0 rounded-full bg-blue-500/15 px-2 py-0.5 text-[10px] font-bold text-blue-300">
                      {p.kind === "REENABLE" ? "Chờ bật lại" : `Chờ duyệt · ${amenityCategoryLabel(p.suggestedCategory)}`}
                    </span>
                    {!on && onToggleProposal && <span className="shrink-0 text-[10px] text-zinc-500">chưa đưa vào tin</span>}
                  </button>
                  {p.kind === "NEW" && (
                    <Button type="button" size="sm" variant="ghost" aria-label={`Sửa đề xuất ${p.name}`} disabled={busy} onClick={() => onEditProposal(p)}>
                      <PencilSimpleIcon />
                    </Button>
                  )}
                  <Button type="button" size="sm" variant="ghost" className="text-red-400" aria-label={`Huỷ đề xuất ${p.name}`} disabled={busy} onClick={() => onCancelProposal(p)}>
                    <TrashIcon />
                  </Button>
                </li>
              );
            })}
          </ul>
        </div>
      )}

      {rejected.length > 0 && (
        <div className="space-y-1.5 border-t border-zinc-800/70 pt-3">
          <p className={sectionLabel}>Đề xuất bị từ chối</p>
          <ul className="space-y-1">
            {rejected.slice(0, 5).map((p) => (
              <li key={p.id} className="text-xs text-zinc-400">
                <span className="font-semibold text-zinc-300">{p.name}</span> — {p.rejectReason}
              </li>
            ))}
          </ul>
          <p className="text-[11px] text-zinc-600">Muốn đề xuất lại, hãy dùng một tên khác.</p>
        </div>
      )}
    </div>
  );
}
