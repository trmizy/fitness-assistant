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
  return (
    <div className="flex items-center justify-between gap-4 rounded-lg border border-zinc-800/60 bg-zinc-950/40 p-3">
      <div className="min-w-0 flex items-start gap-3">
        {Icon && (
          <Icon className="w-4 h-4 text-orange-400 mt-0.5 flex-shrink-0" />
        )}
        <div className="min-w-0">
          <p className="text-sm text-zinc-200 font-semibold">{label}</p>
          {description && (
            <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <button
        type="button"
        role="switch"
        aria-checked={checked}
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
          className={`absolute left-0 top-0.5 w-5 h-5 rounded-full bg-switch-thumb shadow transition-transform ${
            checked ? "translate-x-5" : "translate-x-0.5"
          }`}
        />
      </button>
    </div>
  );
}
