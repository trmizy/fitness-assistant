import { useEffect, useState } from "react";
import { ScrollView, Text, View } from "react-native";
import { Check, Pencil, Plus, RotateCcw, Trash2 } from "lucide-react-native";

import { Badge, BottomSheet, Button, Card, Input, Tappable, inputPlaceholderColor } from "../../components/ui";
import { useWorkspaceAccent } from "../../theme/workspace";
import { AmenityIcon } from "./AmenityIcon";
import {
  AMENITY_CATEGORIES,
  AMENITY_CATEGORY_LABEL,
  groupAmenities,
  type AmenityCategory,
  type IconAmenity,
} from "./amenityIcons";
import {
  PROPOSAL_NAME_MAX,
  PROPOSAL_NOTE_MAX,
  amenityTotal,
  pendingReenableFor,
  proposalFormError,
  type DisabledAmenityNotice,
  type Proposal,
} from "./gymListing";

/** Section label, same look as the PT listing's field labels. */
function GroupLabel({ children }: { children: string }) {
  return <Text className="font-body text-[11px] uppercase tracking-wider text-muted-foreground">{children}</Text>;
}

type ChipAmenity = IconAmenity & { id: string; status?: string };

/**
 * The catalogue as chips, grouped by category, each with its icon. Tap toggles. A selected amenity that the catalogue
 * switched off stays visible, flagged, so it can be taken out (the server refuses to save a switched-off one).
 */
export function AmenityChips({
  amenities,
  selectedIds,
  onToggle,
  disabled,
}: {
  amenities: ChipAmenity[];
  selectedIds: string[];
  onToggle: (id: string) => void;
  disabled?: boolean;
}) {
  const accent = useWorkspaceAccent();
  const groups = groupAmenities(amenities);
  if (groups.length === 0) {
    return <Text className="font-body text-xs text-muted-foreground">Chưa tải được danh mục tiện ích.</Text>;
  }
  return (
    <View className="gap-3">
      {groups.map((g) => (
        <View key={g.category} className="gap-2">
          <GroupLabel>{g.label}</GroupLabel>
          <View className="flex-row flex-wrap gap-2">
            {g.items.map((a) => {
              const on = selectedIds.includes(a.id);
              const off = a.status != null && a.status !== "ACTIVE";
              return (
                <Tappable
                  key={a.id}
                  disabled={disabled}
                  accessibilityLabel={`${a.name}${off ? " (đã ngừng)" : ""}${on ? " (đã chọn)" : ""}`}
                  onPress={() => onToggle(a.id)}
                  className={`flex-row items-center gap-1.5 rounded-full border px-3 py-2 ${
                    off ? "border-warning bg-warning/10" : on ? "border-primary bg-primary/10" : "border-border"
                  }`}
                >
                  {on ? <Check size={12} color={accent.primary} /> : <AmenityIcon iconKey={a.iconKey} size={13} />}
                  <Text className={`font-body text-xs ${off ? "text-warning" : on ? "text-primary" : "text-muted-foreground"}`}>{a.name}</Text>
                </Tappable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Read-only amenity badges grouped by category with icons — the client's gym detail, the preview, the published summary. */
export function AmenityBadgeGroups({ amenities, grouped = true }: { amenities: IconAmenity[]; grouped?: boolean }) {
  const groups = grouped ? groupAmenities(amenities) : [{ category: "ALL", label: "", items: amenities }];
  return (
    <View className="gap-3">
      {groups.map((g) => (
        <View key={g.category} className="gap-2">
          {g.label ? <GroupLabel>{g.label}</GroupLabel> : null}
          <View className="flex-row flex-wrap gap-1.5">
            {g.items.map((a) => (
              <View key={a.slug ?? a.id ?? a.name} className="flex-row items-center gap-1.5 rounded-full border border-border bg-panel px-2.5 py-1.5">
                <AmenityIcon iconKey={a.iconKey} size={12} />
                <Text className="font-body text-xs text-foreground">{a.name}</Text>
              </View>
            ))}
          </View>
        </View>
      ))}
    </View>
  );
}

export type ProposalValues = { name: string; suggestedCategory: AmenityCategory; note: string };

/** "Đề xuất tiện ích mới" / "Sửa đề xuất" — name (2–40), category (4 groups), optional note. */
export function ProposeAmenitySheet({
  open,
  onClose,
  title,
  initial,
  pending,
  submitLabel,
  onSubmit,
  lockCategory,
}: {
  open: boolean;
  onClose: () => void;
  title: string;
  initial?: Partial<ProposalValues>;
  pending: boolean;
  submitLabel: string;
  onSubmit: (v: ProposalValues) => void;
  /** Hide the category chips (a REENABLE proposal keeps the amenity's own category). */
  lockCategory?: boolean;
}) {
  const [name, setName] = useState("");
  const [category, setCategory] = useState<AmenityCategory | null>(null);
  const [note, setNote] = useState("");

  useEffect(() => {
    if (!open) return;
    setName(initial?.name ?? "");
    setCategory(initial?.suggestedCategory ?? null);
    setNote(initial?.note ?? "");
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  const error = proposalFormError({ name, category, note });
  return (
    <BottomSheet open={open} onClose={onClose} title={title}>
      <ScrollView keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 12, paddingBottom: 8 }}>
        <Text className="font-body text-xs leading-5 text-muted-foreground">
          Chưa thấy tiện ích của chi nhánh trong danh mục? Gửi đề xuất — Gymini duyệt rồi sẽ báo cho bạn. Tiện ích đã có sẵn sẽ được chọn giúp bạn.
        </Text>
        <Input
          label={`Tên tiện ích · ${name.trim().length}/${PROPOSAL_NAME_MAX}`}
          value={name}
          onChangeText={(v) => setName(v.slice(0, PROPOSAL_NAME_MAX))}
          placeholder="Ví dụ: Phòng boxing"
          placeholderTextColor={inputPlaceholderColor}
        />
        {lockCategory ? null : (
          <View className="gap-2">
            <Text className="font-body-medium text-xs text-muted-foreground">Thuộc nhóm nào?</Text>
            <View className="flex-row flex-wrap gap-2">
              {AMENITY_CATEGORIES.map((c) => {
                const on = category === c;
                return (
                  <Tappable
                    key={c}
                    accessibilityLabel={`Nhóm ${AMENITY_CATEGORY_LABEL[c]}${on ? " (đã chọn)" : ""}`}
                    onPress={() => setCategory(c)}
                    className={`rounded-full border px-3 py-2 ${on ? "border-primary bg-primary/10" : "border-border"}`}
                  >
                    <Text className={`font-body text-xs ${on ? "text-primary" : "text-muted-foreground"}`}>{AMENITY_CATEGORY_LABEL[c]}</Text>
                  </Tappable>
                );
              })}
            </View>
          </View>
        )}
        <Input
          label={`Ghi chú cho Gymini (tuỳ chọn) · ${note.trim().length}/${PROPOSAL_NOTE_MAX}`}
          value={note}
          onChangeText={(v) => setNote(v.slice(0, PROPOSAL_NOTE_MAX))}
          placeholderTextColor={inputPlaceholderColor}
        />
        {error && (name.trim() || category) ? <Text className="font-body text-xs text-destructive">{error}</Text> : null}
        <Button
          disabled={!!error || pending}
          onPress={() => onSubmit({ name: name.trim(), suggestedCategory: category as AmenityCategory, note: note.trim() })}
        >
          {pending ? "Đang gửi…" : submitLabel}
        </Button>
      </ScrollView>
    </BottomSheet>
  );
}

/**
 * The owner's proposals for THIS branch. A PENDING one can be put in / taken out of the draft, edited and cancelled
 * (PATCH / DELETE /owner/amenities/proposals/:id); a decided one says what happened.
 */
export function ProposalsBlock({
  proposals,
  attachedIds,
  editable,
  busy,
  onToggleAttach,
  onEdit,
  onCancel,
}: {
  proposals: Proposal[];
  attachedIds: string[];
  /** false → read-only (a revision is waiting for review): no attach / edit / cancel. */
  editable: boolean;
  busy: boolean;
  onToggleAttach: (id: string) => void;
  onEdit: (p: Proposal) => void;
  onCancel: (p: Proposal) => void;
}) {
  const shown = proposals.filter((p) => p.status === "PENDING" || p.status === "REJECTED");
  if (shown.length === 0) return null;
  return (
    <View className="gap-2 border-t border-border pt-3">
      <Text className="font-body-semibold text-xs text-muted-foreground">Đề xuất tiện ích của bạn</Text>
      {shown.map((p) => {
        const attached = attachedIds.includes(p.id);
        return (
          <Card key={p.id} className="gap-2 p-3">
            <View className="flex-row flex-wrap items-center gap-1.5">
              <Text className="min-w-0 flex-shrink font-body-semibold text-sm text-foreground">{p.name}</Text>
              {p.status === "PENDING" ? (
                <Badge tone="info">{p.kind === "REENABLE" ? "Chờ bật lại" : "Chờ duyệt"}</Badge>
              ) : (
                <Badge tone="danger">Bị từ chối</Badge>
              )}
              {p.status === "PENDING" && attached ? <Badge tone="success">Trong bản nháp</Badge> : null}
            </View>
            {p.status === "REJECTED" ? (
              <Text className="font-body text-xs leading-5 text-muted-foreground">
                {p.rejectReason ? `Lý do: ${p.rejectReason}. ` : ""}Bạn có thể đề xuất lại với tên khác.
              </Text>
            ) : editable ? (
              <View className="flex-row flex-wrap items-center gap-2">
                <Button size="sm" variant={attached ? "secondary" : "primary"} disabled={busy} onPress={() => onToggleAttach(p.id)}>
                  {attached ? "Bỏ khỏi bản nháp" : "Thêm vào bản nháp"}
                </Button>
                <Button size="sm" variant="ghost" icon={Pencil} disabled={busy} onPress={() => onEdit(p)}>
                  Sửa
                </Button>
                <Button size="sm" variant="ghost" icon={Trash2} disabled={busy} onPress={() => onCancel(p)}>
                  Huỷ đề xuất
                </Button>
              </View>
            ) : null}
            {p.status === "PENDING" && !attached && editable ? (
              <Text className="font-body text-[11px] text-muted-foreground">Đề xuất chưa nằm trong bản nháp.</Text>
            ) : null}
          </Card>
        );
      })}
    </View>
  );
}

/**
 * Plan §12.3: "Một số tiện ích đã ngừng trong danh mục và đã được bỏ khỏi bản sửa: …" with a "Đề xuất bật lại" button
 * (creates a REENABLE proposal). Once one is waiting, the button gives way to a sentence saying so.
 */
export function DisabledAmenityBlock({
  items,
  proposals,
  busy,
  onReenable,
}: {
  items: DisabledAmenityNotice[];
  proposals: Proposal[];
  busy: boolean;
  onReenable: (item: DisabledAmenityNotice) => void;
}) {
  if (items.length === 0) return null;
  return (
    <View className="gap-2 rounded-xl border border-warning/30 bg-warning/10 p-3">
      <Text className="font-body-semibold text-xs text-warning">Một số tiện ích đã ngừng trong danh mục</Text>
      <Text className="font-body text-xs leading-5 text-muted-foreground">
        Các tiện ích dưới đây đã được bỏ khỏi bản sửa (khách không còn thấy chúng). Muốn dùng lại, hãy đề xuất bật lại.
      </Text>
      {items.map((it) => {
        const waiting = pendingReenableFor(proposals, it.amenityId);
        return (
          <View key={it.amenityId} className="flex-row items-center gap-2">
            <Text className="min-w-0 flex-1 font-body-medium text-sm text-foreground">{it.name}</Text>
            {waiting ? (
              <Text className="font-body text-[11px] text-muted-foreground">Đã gửi đề xuất bật lại</Text>
            ) : (
              <Button size="sm" variant="secondary" icon={RotateCcw} disabled={busy} onPress={() => onReenable(it)}>
                Đề xuất bật lại
              </Button>
            )}
          </View>
        );
      })}
    </View>
  );
}

/** "Chọn ít nhất một tiện ích" counter + the propose button, shown above the chips. */
export function AmenityHeader({
  form,
  onPropose,
  disabled,
}: {
  form: { amenityIds: string[]; proposalIds: string[] };
  onPropose: () => void;
  disabled?: boolean;
}) {
  const total = amenityTotal(form);
  return (
    <View className="flex-row items-center justify-between gap-3">
      <Text className="min-w-0 flex-1 font-body text-xs text-muted-foreground">
        {total === 0 ? "Chọn ít nhất một tiện ích chi nhánh thực sự có." : `Đã chọn ${total} tiện ích.`}
      </Text>
      <Button size="sm" variant="secondary" icon={Plus} disabled={disabled} onPress={onPropose}>
        Đề xuất mới
      </Button>
    </View>
  );
}

