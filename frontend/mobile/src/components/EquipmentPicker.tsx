import { useMemo, useState } from "react";
import { Text, View } from "react-native";
import { Check, Search, X } from "lucide-react-native";

import { Input, Tappable } from "./ui";
import type { EquipmentCatalogItem } from "../services/api";
import { useWorkspaceAccent } from "../theme/workspace";

/**
 * Equipment picker + training-location presets — ported from web's `components/EquipmentPicker.tsx`
 * (same catalog filtering, category order, Vietnamese search aliases and preset slug lists; the
 * slugs must keep matching fitness-service's seed_equipment.ts catalog).
 *
 * One deliberate layout difference: web caps the list at 420px with its own scroll. Inside the
 * onboarding wizard's ScrollView a nested scroll area fights the page scroll on a phone, so the full
 * list renders inline — ~44 rows, no virtualization needed.
 */

// Internal-only fallback catalog entries — never meant to be picked by a user directly
// (seed_equipment.ts: "generic-machine" is an unclassified-machine fallback,
// "specialty-strongman" a niche catch-all).
const HIDDEN_FROM_PICKER = new Set(["generic-machine", "specialty-strongman"]);

const CATEGORY_LABELS: Record<string, string> = {
  FREE_WEIGHTS: "Tạ tự do",
  BENCHES_RACKS: "Ghế / Giá đỡ",
  CABLE: "Ròng rọc / Cáp",
  CHEST_MACHINES: "Máy tập ngực",
  BACK_MACHINES: "Máy tập lưng",
  SHOULDER_MACHINES: "Máy tập vai",
  LEG_MACHINES: "Máy tập chân",
  ARM_MACHINES: "Máy tập tay",
  CORE_MACHINES: "Máy tập bụng",
  CARDIO: "Cardio",
  OTHER: "Khác",
};

// The catalog's own names/aliases are English; these cover the common Vietnamese search terms for
// items whose category label alone would not surface them.
const VN_SEARCH_ALIASES: Record<string, string[]> = {
  bodyweight: ["trọng lượng cơ thể", "không dụng cụ"],
  "resistance-band": ["dây kháng lực", "dây thun"],
  "pull-up-bar": ["xà đơn"],
  "dip-bars": ["xà kép"],
  "foam-roller": ["con lăn"],
  "medicine-ball": ["bóng tạ"],
  "exercise-ball": ["bóng tập", "bóng gym"],
  "jump-rope": ["dây nhảy"],
  "suspension-trainer": ["dây treo"],
  "battle-ropes": ["dây thừng"],
  sled: ["xe đẩy tạ"],
  "plyo-box": ["bục nhảy"],
};

const CATEGORY_ORDER = [
  "FREE_WEIGHTS",
  "BENCHES_RACKS",
  "CABLE",
  "CHEST_MACHINES",
  "BACK_MACHINES",
  "SHOULDER_MACHINES",
  "LEG_MACHINES",
  "ARM_MACHINES",
  "CORE_MACHINES",
  "CARDIO",
  "OTHER",
];

// Presets are UX prefill only, never persisted as-is — the final checkbox state is what gets saved.
export const TRAINING_LOCATION_PRESETS: Array<{
  key: string;
  label: string;
  description: string;
  slugs: string[];
}> = [
  {
    key: "COMMERCIAL_GYM",
    label: "Phòng gym lớn",
    description: "Tự động chọn thiết bị PHỔ BIẾN — máy chuyên biệt hơn bạn tự chọn thêm bên dưới",
    // Common tier only — pre-checking rare machines "most big gyms might have" gives false
    // confidence; those stay manually selectable.
    slugs: [
      "barbell", "dumbbell", "kettlebell",
      "bench", "squat-rack", "smith-machine", "cable-machine",
      "chest-press-machine", "lat-pulldown-machine", "seated-row-machine", "shoulder-press-machine",
      "leg-press-machine", "leg-extension-machine", "leg-curl-machine", "calf-raise-machine",
      "treadmill", "stationary-bike", "rowing-machine",
      "pull-up-bar", "bodyweight",
    ],
  },
  {
    key: "SMALL_GYM",
    label: "Phòng gym nhỏ / gym địa phương",
    description: "Tạ cơ bản + vài máy chính, chưa chắc đủ máy chuyên biệt",
    slugs: [
      "barbell", "dumbbell", "kettlebell", "bench", "squat-rack",
      "cable-machine", "lat-pulldown-machine", "seated-row-machine", "leg-press-machine",
      "pull-up-bar", "treadmill", "bodyweight",
    ],
  },
  {
    key: "HOME_GYM",
    label: "Gym tại nhà",
    description: "Thiết bị cá nhân, không có máy tập",
    slugs: ["dumbbell", "barbell", "bench", "squat-rack", "pull-up-bar", "kettlebell", "resistance-band", "bodyweight"],
  },
  {
    key: "GARAGE_GYM",
    label: "Garage gym",
    description: "Setup tối giản: tạ đòn + giá đỡ",
    slugs: ["barbell", "dumbbell", "bench", "squat-rack", "pull-up-bar", "kettlebell", "bodyweight"],
  },
  {
    key: "BODYWEIGHT_ONLY",
    label: "Chỉ dùng trọng lượng cơ thể",
    description: "Không có thiết bị nào",
    slugs: ["bodyweight", "pull-up-bar", "resistance-band"],
  },
  {
    key: "OTHER",
    label: "Khác",
    description: "Tự chọn thiết bị bên dưới",
    slugs: [],
  },
];

export function EquipmentPicker({
  catalog,
  selectedSlugs,
  onChange,
}: {
  catalog: EquipmentCatalogItem[];
  selectedSlugs: Set<string>;
  onChange: (next: Set<string>) => void;
}) {
  const accent = useWorkspaceAccent();
  const [search, setSearch] = useState("");

  const visibleCatalog = useMemo(
    () => catalog.filter((eq) => !HIDDEN_FROM_PICKER.has(eq.slug)),
    [catalog],
  );

  const grouped = useMemo(() => {
    const q = search.trim().toLowerCase();
    const filtered = q
      ? visibleCatalog.filter(
          (eq) =>
            eq.name.toLowerCase().includes(q) ||
            eq.aliases.some((a) => a.toLowerCase().includes(q)) ||
            (CATEGORY_LABELS[eq.category] ?? "").toLowerCase().includes(q) ||
            (VN_SEARCH_ALIASES[eq.slug] ?? []).some((a) => a.includes(q)),
        )
      : visibleCatalog;
    const map = new Map<string, EquipmentCatalogItem[]>();
    for (const eq of filtered) {
      const arr = map.get(eq.category) ?? [];
      arr.push(eq);
      map.set(eq.category, arr);
    }
    return CATEGORY_ORDER.map((cat) => ({ category: cat, items: map.get(cat) ?? [] })).filter(
      (g) => g.items.length > 0,
    );
  }, [visibleCatalog, search]);

  const toggle = (slug: string) => {
    const next = new Set(selectedSlugs);
    if (next.has(slug)) next.delete(slug);
    else next.add(slug);
    onChange(next);
  };

  const setCategory = (items: EquipmentCatalogItem[], selected: boolean) => {
    const next = new Set(selectedSlugs);
    for (const eq of items) {
      if (selected) next.add(eq.slug);
      else next.delete(eq.slug);
    }
    onChange(next);
  };

  return (
    <View className="gap-4">
      <View className="flex-row items-center gap-3">
        <Input
          className="flex-1"
          icon={Search}
          placeholder="Tìm thiết bị..."
          value={search}
          onChangeText={setSearch}
          autoCapitalize="none"
        />
        <Text className="font-body text-xs text-muted-foreground">
          Đã chọn {selectedSlugs.size}
        </Text>
      </View>

      {grouped.length === 0 ? (
        <Text className="py-6 text-center font-body text-xs text-muted-foreground">
          Không tìm thấy thiết bị phù hợp.
        </Text>
      ) : null}

      {grouped.map(({ category, items }) => (
        <View key={category}>
          <View className="mb-2 flex-row items-center justify-between">
            <Text className="font-body-semibold text-[11px] uppercase text-muted-foreground">
              {CATEGORY_LABELS[category] ?? category}
            </Text>
            <View className="flex-row items-center gap-4">
              <Text
                className="font-body-medium text-[11px] text-primary"
                onPress={() => setCategory(items, true)}
              >
                Chọn tất cả
              </Text>
              <Text
                className="font-body-medium text-[11px] text-muted-foreground"
                onPress={() => setCategory(items, false)}
              >
                Bỏ chọn
              </Text>
            </View>
          </View>

          <View className="gap-1.5">
            {items.map((eq) => {
              const checked = selectedSlugs.has(eq.slug);
              return (
                <Tappable
                  key={eq.id}
                  onPress={() => toggle(eq.slug)}
                  className={`flex-row items-center gap-2.5 rounded-xl border px-3 py-2.5 ${
                    checked ? "border-primary bg-primary/10" : "border-border bg-card"
                  }`}
                >
                  <View
                    className={`h-4 w-4 items-center justify-center rounded border ${
                      checked ? "border-primary bg-primary" : "border-border"
                    }`}
                  >
                    {checked ? <Check size={11} strokeWidth={3} color={accent.onPrimary} /> : null}
                  </View>
                  <Text
                    className={`flex-1 font-body text-xs ${checked ? "text-primary" : "text-muted-foreground"}`}
                    numberOfLines={1}
                  >
                    {eq.name}
                  </Text>
                </Tappable>
              );
            })}
          </View>
        </View>
      ))}
    </View>
  );
}

/** Pill row for picking a training location preset — applies once, never persists itself. */
export function TrainingLocationPresetRow({ onApply }: { onApply: (slugs: string[]) => void }) {
  const accent = useWorkspaceAccent();
  const [applied, setApplied] = useState<string | null>(null);
  const appliedPreset = TRAINING_LOCATION_PRESETS.find((p) => p.key === applied);

  return (
    <View>
      <View className="flex-row flex-wrap gap-2">
        {TRAINING_LOCATION_PRESETS.map((preset) => {
          const active = applied === preset.key;
          return (
            <Tappable
              key={preset.key}
              onPress={() => {
                setApplied(preset.key);
                onApply(preset.slugs);
              }}
              className={`rounded-full border px-3.5 py-2 ${
                active ? "border-primary bg-primary/10" : "border-border bg-card"
              }`}
            >
              <Text
                className={`font-body-medium text-xs ${active ? "text-primary" : "text-muted-foreground"}`}
              >
                {preset.label}
              </Text>
            </Tappable>
          );
        })}
        {applied ? (
          <Tappable
            onPress={() => setApplied(null)}
            className="flex-row items-center gap-1 rounded-full px-2.5 py-2"
          >
            <X size={12} color={accent.primary} />
            <Text className="font-body-medium text-xs text-muted-foreground">Bỏ gợi ý</Text>
          </Tappable>
        ) : null}
      </View>
      {/* Web shows this as a hover tooltip, which a phone does not have. */}
      {appliedPreset ? (
        <Text className="mt-2 font-body text-[11px] leading-4 text-muted-foreground">
          {appliedPreset.description}
        </Text>
      ) : null}
    </View>
  );
}
