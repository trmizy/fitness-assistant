/*
 * Single choice among a few described options (e.g. a fitness goal). ARIA radiogroup/radio with roving tabindex;
 * arrows move and select. Icons come from the app's icon set (no emoji). Wraps in a responsive grid, never pills.
 */
import { useRef } from "react";

export type RadioCardOption<T extends string> = { value: T; label: string; description?: string; icon?: React.ElementType; testId?: string };

export function RadioCards<T extends string>({
  label, value, options, onChange, testId, columns = "sm:grid-cols-2 lg:grid-cols-3", disabled = false,
}: { disabled?: boolean; label: string; value: T | null | undefined; options: ReadonlyArray<RadioCardOption<T>>; onChange: (v: T) => void; testId?: string; columns?: string }) {
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = options.findIndex((o) => o.value === value);
  const focusIdx = idx < 0 ? 0 : idx;
  const move = (n: number) => { const i = (n + options.length) % options.length; onChange(options[i].value); refs.current[i]?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (disabled) return;
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(focusIdx + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(focusIdx - 1); }
  };
  return (
    <div role="radiogroup" aria-label={label} aria-disabled={disabled || undefined} className={`grid grid-cols-1 gap-2 ${columns}`} onKeyDown={onKeyDown} data-testid={testId}>
      {options.map((o, i) => {
        const on = o.value === value;
        const Icon = o.icon;
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} disabled={disabled} tabIndex={i === focusIdx ? 0 : -1} onClick={() => !disabled && onChange(o.value)} className="gw-radio-card" data-testid={o.testId}>
            {Icon && <span className="gw-radio-icon" aria-hidden="true"><Icon className="h-[18px] w-[18px]" weight={on ? "fill" : "regular"} /></span>}
            <span className="min-w-0 text-left">
              <span className="block text-sm font-medium text-[var(--gw-text)]">{o.label}</span>
              {o.description && <span className="block text-xs text-[var(--gw-text-3)]">{o.description}</span>}
            </span>
            <span className="gw-radio-dot" aria-hidden="true" />
          </button>
        );
      })}
    </div>
  );
}
