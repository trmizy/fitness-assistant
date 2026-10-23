import { useState } from "react";
import { toast } from "sonner";
import { ClockIcon, PlusIcon, XIcon } from "@phosphor-icons/react";
import { Button } from "../ui/button";
import { AmenityChipGroups, ProposeAmenityDialog } from "./AmenityEditor";
import { amenityCategoryLabel } from "../../utils/amenityIcons";
import {
  addInlineProposal,
  toggleId,
  type CatalogAmenity,
  type InlineProposalInput,
} from "../../utils/gymListing";

/** A proposal the server already holds for the branch (application resume): it stays unless the owner removes it. */
export interface ExistingProposal {
  id: string;
  name: string;
  kind: "NEW" | "REENABLE";
}

/**
 * Amenity choice for a branch that has NO published listing and where the owner's `/owner/amenities` calls are not available yet
 * (the partner application wizard): catalogue chips by category + new proposals that travel INLINE with the save
 * (`proposals: [{ name, suggestedCategory }]`). There is no revision here, so the selection IS what is sent.
 *
 * A name that is already an ACTIVE catalogue amenity (accent / case insensitive) is selected instead of proposed — the same answer
 * the server would give (`matchedAmenity`) — and the owner is told. The server stays the judge; this only saves a round trip.
 */
export function InlineAmenityPicker({
  catalog,
  loading,
  error,
  notice,
  onRetry,
  selectedIds,
  onSelectedChange,
  proposals,
  onProposalsChange,
  existing,
  keptIds,
  onKeptIdsChange,
  disabled,
}: {
  catalog: CatalogAmenity[];
  loading: boolean;
  error: string | null;
  /** A calm line under the chips (e.g. "showing the standard list"). */
  notice?: string | null;
  onRetry: () => void;
  selectedIds: string[];
  onSelectedChange: (ids: string[]) => void;
  proposals: InlineProposalInput[];
  onProposalsChange: (next: InlineProposalInput[]) => void;
  existing: ExistingProposal[];
  keptIds: string[];
  onKeptIdsChange: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const [dialog, setDialog] = useState(false);
  const total = selectedIds.length + proposals.length + keptIds.length;

  function add(v: { name: string; suggestedCategory: InlineProposalInput["suggestedCategory"]; note: string }) {
    const r = addInlineProposal(catalog, proposals, existing, { name: v.name, suggestedCategory: v.suggestedCategory, note: v.note });
    if (r.outcome === "matched") {
      if (!selectedIds.includes(r.amenity.id)) onSelectedChange([...selectedIds, r.amenity.id]);
      toast.success(`"${r.amenity.name}" đã có sẵn trong danh mục — đã chọn giúp bạn.`);
      setDialog(false);
      return;
    }
    if (r.outcome === "duplicate") {
      toast.error(`Bạn đã đề xuất "${v.name}" rồi (hoặc đã đủ số đề xuất tối đa).`);
      return;
    }
    onProposalsChange(r.proposals);
    toast.success(`Đã thêm đề xuất "${v.name}" — Gymini sẽ duyệt cùng hồ sơ.`);
    setDialog(false);
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p className="text-xs text-zinc-500">{total === 0 ? "Cần chọn ít nhất một tiện ích (hoặc một đề xuất)." : `Đã chọn ${total} tiện ích.`}</p>
        <Button type="button" size="sm" variant="outline" disabled={disabled} onClick={() => setDialog(true)}>
          <PlusIcon /> Đề xuất tiện ích mới
        </Button>
      </div>

      {loading ? (
        <p className="text-sm text-zinc-500">Đang tải danh mục tiện ích…</p>
      ) : error ? (
        <div className="space-y-2">
          <p className="text-sm text-red-400">{error}</p>
          <Button size="sm" variant="outline" onClick={onRetry}>Thử lại</Button>
        </div>
      ) : (
        <AmenityChipGroups amenities={catalog} selectedIds={selectedIds} onToggle={(id) => onSelectedChange(toggleId(selectedIds, id))} disabled={disabled} />
      )}
      {notice && <p className="text-[11px] leading-4 text-zinc-500">{notice}</p>}

      {existing.length > 0 || proposals.length > 0 ? (
        <div className="space-y-2 border-t border-zinc-800/70 pt-3">
          <p className="text-xs font-semibold uppercase tracking-wider text-zinc-500">Đề xuất của bạn</p>
          <ul className="flex flex-wrap gap-2">
            {existing.map((p) => {
              const kept = keptIds.includes(p.id);
              return (
                <li key={p.id}>
                  <button
                    type="button"
                    disabled={disabled}
                    aria-pressed={kept}
                    aria-label={`${p.name} (${kept ? "đang giữ" : "đã bỏ"})`}
                    onClick={() => onKeptIdsChange(toggleId(keptIds, p.id))}
                    className={`inline-flex min-h-10 items-center gap-1.5 rounded-full border px-3 py-2 text-sm ${kept ? "border-blue-500/50 bg-blue-500/10 text-blue-200" : "border-zinc-700 text-zinc-500 line-through"}`}
                  >
                    <ClockIcon className="size-3.5" />
                    {p.name}
                    <span className="text-[10px] font-bold">{p.kind === "REENABLE" ? "Chờ bật lại" : "Chờ duyệt"}</span>
                  </button>
                </li>
              );
            })}
            {proposals.map((p) => (
              <li key={p.name} className="inline-flex min-h-10 items-center gap-1.5 rounded-full border border-blue-500/50 bg-blue-500/10 px-3 py-2 text-sm text-blue-200">
                <ClockIcon className="size-3.5" />
                {p.name}
                <span className="text-[10px] font-bold">{amenityCategoryLabel(p.suggestedCategory)}</span>
                <button type="button" aria-label={`Bỏ đề xuất ${p.name}`} disabled={disabled} onClick={() => onProposalsChange(proposals.filter((x) => x.name !== p.name))}>
                  <XIcon className="size-3.5" />
                </button>
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      <ProposeAmenityDialog open={dialog} onOpenChange={setDialog} title="Đề xuất tiện ích mới" submitLabel="Thêm đề xuất" pending={false} onSubmit={add} />
    </div>
  );
}
