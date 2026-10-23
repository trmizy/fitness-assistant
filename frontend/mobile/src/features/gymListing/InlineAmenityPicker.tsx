import { useState } from "react";
import { ActivityIndicator, Text, View } from "react-native";
import { X } from "lucide-react-native";

import { Badge, Button, Tappable, useToast } from "../../components/ui";
import { useWorkspaceAccent } from "../../theme/workspace";
import { AmenityChips, AmenityHeader, ProposeAmenitySheet, type ProposalValues } from "./AmenityWidgets";
import { amenityCategoryLabel } from "./amenityIcons";
import { findCatalogMatch, normalizeAmenityName, toggleId, type Amenity, type Proposal } from "./gymListing";

export type InlineProposal = { name: string; suggestedCategory: ProposalValues["suggestedCategory"]; note?: string };

/**
 * Amenity choice for a branch that has NO published listing yet (the application wizard's amenity step and the quick
 * "Thêm chi nhánh" sheet): catalogue chips + new proposals sent inline with the save (`proposals: [{ name, suggestedCategory }]`).
 * There is no revision here, so the selection IS what is sent: `amenityIds` replaces the branch's amenities.
 *
 * A name that is already an ACTIVE catalogue amenity (accent / case insensitive) is selected instead of proposed — the same answer the
 * server would give (`matchedAmenity`) — and the owner is told. The server stays the judge; this only saves a round trip.
 *
 * `existing` / `keptProposalIds` carry proposals the server already holds for this branch (application wizard resume): a PENDING one
 * stays unless the owner removes it.
 */
export function InlineAmenityPicker({
  catalog,
  loading,
  error,
  onRetry,
  selectedIds,
  onSelectedChange,
  proposals,
  onProposalsChange,
  existing = [],
  keptProposalIds = [],
  onKeptProposalIdsChange,
  disabled,
}: {
  catalog: Amenity[];
  loading: boolean;
  /** A sentence when the catalogue could not be loaded. */
  error: string | null;
  onRetry: () => void;
  selectedIds: string[];
  onSelectedChange: (ids: string[]) => void;
  proposals: InlineProposal[];
  onProposalsChange: (next: InlineProposal[]) => void;
  existing?: Proposal[];
  keptProposalIds?: string[];
  onKeptProposalIdsChange?: (ids: string[]) => void;
  disabled?: boolean;
}) {
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const [sheet, setSheet] = useState(false);

  const pendingExisting = existing.filter((p) => p.status === "PENDING");
  const total = selectedIds.length + proposals.length + keptProposalIds.length;

  const add = (v: ProposalValues) => {
    const match = findCatalogMatch(catalog, v.name);
    if (match) {
      onSelectedChange(selectedIds.includes(match.id) ? selectedIds : [...selectedIds, match.id]);
      toast.show(`"${match.name}" đã có sẵn trong danh mục — mình đã chọn giúp bạn.`, "success");
      setSheet(false);
      return;
    }
    const n = normalizeAmenityName(v.name);
    if (proposals.some((p) => normalizeAmenityName(p.name) === n) || pendingExisting.some((p) => normalizeAmenityName(p.name) === n)) {
      toast.show(`Bạn đã đề xuất "${v.name}" rồi.`, "danger");
      return;
    }
    onProposalsChange([...proposals, { name: v.name, suggestedCategory: v.suggestedCategory, ...(v.note ? { note: v.note } : {}) }]);
    toast.show(`Đã thêm đề xuất "${v.name}" — Gymini sẽ duyệt cùng hồ sơ.`, "success");
    setSheet(false);
  };

  return (
    <View className="gap-3">
      <AmenityHeader form={{ amenityIds: selectedIds, proposalIds: [...keptProposalIds, ...proposals.map((p) => p.name)] }} disabled={disabled} onPropose={() => setSheet(true)} />

      {loading ? (
        <ActivityIndicator color={accent.primary} />
      ) : error ? (
        <View className="items-start gap-2">
          <Text className="font-body text-xs text-destructive">{error}</Text>
          <Button size="sm" variant="secondary" onPress={onRetry}>
            Thử lại
          </Button>
        </View>
      ) : (
        <AmenityChips amenities={catalog} selectedIds={selectedIds} onToggle={(id) => onSelectedChange(toggleId(selectedIds, id))} disabled={disabled} />
      )}

      {pendingExisting.length > 0 || proposals.length > 0 ? (
        <View className="gap-2 border-t border-border pt-3">
          <Text className="font-body-semibold text-xs text-muted-foreground">Đề xuất của bạn</Text>
          <View className="flex-row flex-wrap gap-2">
            {pendingExisting.map((p) => {
              const kept = keptProposalIds.includes(p.id);
              return (
                <Tappable
                  key={p.id}
                  disabled={disabled || !onKeptProposalIdsChange}
                  accessibilityLabel={`${p.name} (${kept ? "đang giữ" : "đã bỏ"})`}
                  onPress={() => onKeptProposalIdsChange?.(toggleId(keptProposalIds, p.id))}
                  className={`flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${kept ? "border-primary bg-primary/10" : "border-border opacity-60"}`}
                >
                  <Text className={`font-body text-xs ${kept ? "text-primary" : "text-muted-foreground"}`}>{p.name}</Text>
                  <Badge tone="info">{p.kind === "REENABLE" ? "Chờ bật lại" : "Chờ duyệt"}</Badge>
                </Tappable>
              );
            })}
            {proposals.map((p) => (
              <View key={p.name} className="flex-row items-center gap-1.5 rounded-full border border-primary bg-primary/10 px-3 py-2">
                <Text className="font-body text-xs text-primary">{p.name}</Text>
                <Badge tone="info">{amenityCategoryLabel(p.suggestedCategory)}</Badge>
                <Tappable accessibilityLabel={`Bỏ đề xuất ${p.name}`} hitSlop={8} disabled={disabled} onPress={() => onProposalsChange(proposals.filter((x) => x.name !== p.name))}>
                  <X size={13} color={accent.primary} />
                </Tappable>
              </View>
            ))}
          </View>
        </View>
      ) : null}

      <Text className="font-body text-[11px] text-muted-foreground">{total === 0 ? "Cần ít nhất một tiện ích (hoặc một đề xuất)." : `Tổng ${total} lựa chọn.`}</Text>

      <ProposeAmenitySheet open={sheet} onClose={() => setSheet(false)} title="Đề xuất tiện ích mới" submitLabel="Thêm đề xuất" pending={false} onSubmit={add} />
    </View>
  );
}
