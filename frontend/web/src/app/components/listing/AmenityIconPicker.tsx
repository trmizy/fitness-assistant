import { AMENITY_ICON_KEYS, AMENITY_ICON_LABEL_VI, isKnownAmenityIcon } from "../../utils/amenityIcons";
import { AmenityIcon } from "./AmenityIcon";
import { cn } from "../ui/utils";

/**
 * Picks one icon from the allowlist. The admin API returns its own list of keys (`iconKeys`); that wins, and a key
 * the web has no Phosphor mapping for yet still renders (a neutral icon) so the picker never hides an allowed key.
 */
export function AmenityIconPicker({ value, onChange, keys, disabled }: { value: string; onChange: (key: string) => void; keys?: string[]; disabled?: boolean }) {
  const list = keys && keys.length > 0 ? keys : [...AMENITY_ICON_KEYS];
  return (
    <div role="radiogroup" aria-label="Biểu tượng" className="grid grid-cols-5 gap-1.5 sm:grid-cols-6">
      {list.map((key) => {
        const name = isKnownAmenityIcon(key) ? AMENITY_ICON_LABEL_VI[key] : "Biểu tượng";
        return (
          <button
            key={key}
            type="button"
            role="radio"
            aria-checked={value === key}
            aria-label={name}
            title={name}
            disabled={disabled}
            onClick={() => onChange(key)}
            className={cn(
              "flex aspect-square min-h-11 items-center justify-center rounded-lg border transition-colors disabled:opacity-50",
              value === key ? "border-green-500/60 bg-green-500/15 text-green-300" : "border-zinc-700/60 bg-zinc-800/50 text-zinc-300 hover:border-zinc-500",
            )}
          >
            <AmenityIcon iconKey={key} className="size-5" />
          </button>
        );
      })}
    </div>
  );
}
