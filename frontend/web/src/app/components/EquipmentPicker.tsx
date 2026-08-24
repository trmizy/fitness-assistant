import { useMemo, useState } from "react";
import { Search, Check, X } from "lucide-react";
import type { EquipmentCatalogItem } from "../services/api";

// Internal-only fallback catalog entries — never meant to be picked by a
// user directly (see backend/services/fitness-service/prisma/
// seed_equipment.ts's audit notes: "generic-machine" is an unclassified-
// machine fallback, "specialty-strongman" is a niche catch-all).
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

// Hand-picked Vietnamese search terms for items whose category label alone
// wouldn't surface them (e.g. resistance-band lives in OTHER, which has no
// distinctive Vietnamese keyword of its own). Not a full translation of the
// catalog — just enough to cover the common search terms a Vietnamese-
// speaking user would actually type.
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

// Training-location presets — UX prefill only, never persisted as-is (the
// user's final checkbox state is always what gets saved). Slugs must match
// backend/services/fitness-service/prisma/seed_equipment.ts's catalog.
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
    // Deliberately NOT every machine a large gym *might* have — auto-
    // recommending a rare/specialized machine just because "most big gyms
    // have something like it" produces false confidence (§17: "avoid
    // assuming every commercial gym contains highly specialized machines").
    // This is the COMMON tier only; hip-adduction-abduction-machine,
    // glute-machine, assisted-pullup-dip-machine, pec-deck-machine,
    // bicep/tricep isolation machines, ab-crunch-machine, stair-climber,
    // elliptical etc. stay manually selectable rather than pre-checked.
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
            // The rest of this UI (and every label a user sees) is
            // Vietnamese, but the catalog's own name/aliases are English —
            // confirmed live that searching "máy" (machine) returned
            // nothing despite ~20 machine items existing. Category labels
            // are already Vietnamese, so matching against those too covers
            // the common case ("máy" -> any *_MACHINES category, "tạ" ->
            // "Tạ tự do", "ghế" -> "Ghế / Giá đỡ") without needing to
            // hand-translate all 44 individual item names.
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

  const selectAllInCategory = (items: EquipmentCatalogItem[]) => {
    const next = new Set(selectedSlugs);
    for (const eq of items) next.add(eq.slug);
    onChange(next);
  };
  const clearCategory = (items: EquipmentCatalogItem[]) => {
    const next = new Set(selectedSlugs);
    for (const eq of items) next.delete(eq.slug);
    onChange(next);
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="relative flex-1">
          <Search className="absolute left-2.5 top-1/2 -translate-y-1/2 w-3.5 h-3.5 text-zinc-600" />
          <input
            type="text"
            data-testid="equipment-search-input"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Tìm thiết bị..."
            className="w-full pl-8 pr-3 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-lg text-xs text-zinc-200 focus:outline-none focus:ring-2 focus:ring-green-500/40 placeholder-zinc-600"
          />
        </div>
        <span data-testid="equipment-selected-count" className="text-[11px] text-zinc-500 whitespace-nowrap flex-shrink-0">
          Đã chọn {selectedSlugs.size}
        </span>
      </div>

      <div data-testid="equipment-picker-results" className="space-y-4 max-h-[420px] overflow-y-auto pr-1">
        {grouped.length === 0 && (
          <p data-testid="equipment-empty-state" className="text-xs text-zinc-600 text-center py-6">Không tìm thấy thiết bị phù hợp.</p>
        )}
        {grouped.map(({ category, items }) => (
          <div key={category} data-testid={`equipment-category-${category}`}>
            <div className="flex items-center justify-between mb-1.5">
              <span className="text-[11px] font-semibold text-zinc-400 uppercase tracking-wider">
                {CATEGORY_LABELS[category] ?? category}
              </span>
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  data-testid={`equipment-category-select-all-${category}`}
                  onClick={() => selectAllInCategory(items)}
                  className="text-[10px] text-green-400 hover:text-green-300"
                >
                  Chọn tất cả
                </button>
                <button
                  type="button"
                  data-testid={`equipment-category-clear-${category}`}
                  onClick={() => clearCategory(items)}
                  className="text-[10px] text-zinc-500 hover:text-zinc-300"
                >
                  Bỏ chọn
                </button>
              </div>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-1.5">
              {items.map((eq) => {
                const checked = selectedSlugs.has(eq.slug);
                return (
                  <button
                    key={eq.id}
                    type="button"
                    data-testid={`equipment-item-${eq.slug}`}
                    data-checked={checked}
                    onClick={() => toggle(eq.slug)}
                    className={`flex items-center gap-2 px-3 py-2 rounded-lg border text-left text-xs transition-all ${
                      checked
                        ? "border-green-500 bg-green-500/10 text-green-400"
                        : "border-zinc-700/60 text-zinc-400 hover:border-zinc-600"
                    }`}
                  >
                    <span
                      className={`flex-shrink-0 w-4 h-4 rounded flex items-center justify-center border ${
                        checked ? "bg-green-500 border-green-500" : "border-zinc-600"
                      }`}
                    >
                      {checked && <Check className="w-3 h-3 text-black" />}
                    </span>
                    <span className="truncate">{eq.name}</span>
                  </button>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

// Gym-onboarding project follow-up §11 — existing-user upgrade flow. A
// STRICT alias dictionary from the OLD onboarding wizard's flat 7-value
// vocabulary (frontend/web/src/app/pages/client/OnboardingWizardPage.tsx,
// pre-catalog version) to the new catalog slugs. Deliberately excludes
// "machines" and "cables" pairings that could mean many different specific
// machines — only maps values with exactly one reasonable interpretation.
// Used ONLY to PRE-CHECK boxes in the picker; the user still has to press
// "Save" themselves before this becomes real UserEquipment truth (§11: "the
// user must confirm before normalized UserEquipment becomes truth").
const LEGACY_EQUIPMENT_ALIAS: Record<string, string> = {
  barbell: "barbell",
  dumbbells: "dumbbell",
  dumbbell: "dumbbell",
  bodyweight: "bodyweight",
  resistance_bands: "resistance-band",
  kettlebell: "kettlebell",
  cables: "cable-machine",
  // "machines" intentionally omitted — too ambiguous to safely preselect.
};

export function preselectFromLegacyEquipment(legacyValues: string[]): Set<string> {
  const slugs = new Set<string>();
  for (const raw of legacyValues) {
    const mapped = LEGACY_EQUIPMENT_ALIAS[raw.trim().toLowerCase()];
    if (mapped) slugs.add(mapped);
  }
  return slugs;
}

/** Small pill row for picking a training location preset — applies once,
 * doesn't persist itself (§35: presets are suggestions, not truth). */
export function TrainingLocationPresetRow({
  onApply,
}: {
  onApply: (slugs: string[]) => void;
}) {
  const [applied, setApplied] = useState<string | null>(null);
  return (
    <div>
      <label className="text-xs text-zinc-500 mb-1.5 block">
        Bạn thường tập ở đâu? (gợi ý sẵn thiết bị bên dưới, bạn vẫn chỉnh được)
      </label>
      <div className="flex flex-wrap gap-1.5">
        {TRAINING_LOCATION_PRESETS.map((p) => (
          <button
            key={p.key}
            type="button"
            data-testid={`training-location-preset-${p.key}`}
            onClick={() => {
              setApplied(p.key);
              onApply(p.slugs);
            }}
            title={p.description}
            className={`px-3 py-1.5 rounded-full text-[11px] font-medium border transition-all ${
              applied === p.key
                ? "border-green-500 bg-green-500/10 text-green-400"
                : "border-zinc-700/60 text-zinc-400 hover:border-zinc-600"
            }`}
          >
            {p.label}
          </button>
        ))}
        {applied && (
          <button
            type="button"
            onClick={() => setApplied(null)}
            className="px-2 py-1.5 rounded-full text-[11px] text-zinc-600 hover:text-zinc-400 flex items-center gap-1"
          >
            <X className="w-3 h-3" /> Bỏ gợi ý
          </button>
        )}
      </div>
    </div>
  );
}
