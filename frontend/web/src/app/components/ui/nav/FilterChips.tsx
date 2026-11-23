/*
 * Level 3 — filter chips: narrow a list. Single-select (one filter at a time) or multi-select (toggle set).
 * ARIA: a labelled group of toggle buttons with aria-pressed (state is always exposed). ONE row only: if the chips do
 * not fit they scroll sideways (never wrap onto 2+ rows); > ~6 options should use a <select> instead.
 * Selected look: quiet tinted surface + hairline in the accent (not a solid green slab), same in every list.
 */
import { CheckIcon } from "@phosphor-icons/react";

export type ChipOption<T extends string> = { value: T; label: string; badge?: number; testId?: string; dot?: string /* series colour, only when the colour itself is a legend */ };

export function FilterChips<T extends string>(props: {
  label: string;
  options: ReadonlyArray<ChipOption<T>>;
  testId?: string;
  className?: string;
  wrap?: boolean; // multi-select pickers (e.g. equipment) may wrap: they are choices, not a filter bar
} & ({ multiple?: false; value: T; onChange: (v: T) => void } | { multiple: true; value: ReadonlyArray<T>; onChange: (v: T) => void })) {
  const { label, options, testId, className = "", wrap = false } = props;
  const isOn = (v: T) => (props.multiple ? props.value.includes(v) : props.value === v);
  return (
    <div role="group" aria-label={label} className={`gw-chips ${wrap ? "gw-chips-wrap" : ""} ${className}`} data-testid={testId}>
      {options.map((o) => {
        const on = isOn(o.value);
        return (
          <button key={o.value} type="button" aria-pressed={on} onClick={() => props.onChange(o.value)} className="gw-chip" data-testid={o.testId}>
            {props.multiple && <span className="gw-chip-check" aria-hidden="true">{on && <CheckIcon weight="bold" className="h-3 w-3" />}</span>}
            {o.dot && <span aria-hidden="true" className="inline-block h-2.5 w-2.5 rounded-full" style={{ backgroundColor: o.dot }} />}
            <span>{o.label}</span>
            {o.badge ? <span className="gw-count" aria-label={`${o.badge} mục`}>{o.badge}</span> : null}
          </button>
        );
      })}
    </div>
  );
}
