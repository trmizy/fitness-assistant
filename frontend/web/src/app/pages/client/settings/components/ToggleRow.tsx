import { useId } from "react";
import type { Icon as LucideIcon } from "@phosphor-icons/react";

export function ToggleRow({
  icon: Icon,
  label,
  description,
  checked,
  onChange,
  disabled,
  testId,
}: {
  icon?: LucideIcon;
  label: string;
  description?: string;
  checked: boolean;
  onChange: () => void;
  disabled?: boolean;
  testId?: string;
}) {
  // A11Y-1: the switch takes its accessible name from the visible label and its description from the helper text,
  // so a screen reader says "<label>, switch, on/off, <description>" instead of an unnamed "switch, on".
  // Role + aria-checked were already right; a native <button> keeps Space/Enter and focus.
  const id = useId();
  const labelId = `${id}-label`;
  const descId = `${id}-desc`;
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
      <div className="min-w-0 flex items-start gap-3">
        {Icon && (
          <Icon aria-hidden="true" className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p id={labelId} className="text-sm text-zinc-200 font-semibold">{label}</p>
          {description && (
            <p id={descId} className="text-xs text-zinc-500 mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
        aria-labelledby={labelId}
        aria-describedby={description ? descId : undefined}
        disabled={disabled}
        data-testid={testId}
        onClick={onChange}
        className={`relative w-11 h-6 rounded-full transition-colors shrink-0 disabled:opacity-40 ${
          checked ? "bg-emerald-500" : "bg-zinc-700"
        }`}
      >
        {/* left-0: without it the absolute thumb sat at its static (centred) position and translate-x-5 pushed it out of the
            track; bg-switch-thumb (theme token, white in both themes): .bg-white is remapped in dark, the zinc palette is inverted in light. 2026-11-09 */}
        <span
          aria-hidden="true"
          className={`absolute left-0 top-0.5 w-5 h-5 rounded-full bg-switch-thumb shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
