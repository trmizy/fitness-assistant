/*
 * Level 3 — segmented control: ONE choice among 2–5 view modes / ranges that change what the same content shows.
 * Not for navigation (use links) and not for switching content panels (use ContentTabs).
 * ARIA: radiogroup + radio, roving tabindex, arrows/Home/End move AND select (the APG radio-group model).
 * Motion: one sliding surface (motion layoutId), critically damped, instant under reduced motion.
 */
import { useId, useRef } from "react";
import { motion, useReducedMotion } from "motion/react";

export type SegmentOption<T extends string> = { value: T; label: string; testId?: string };

export function SegmentedControl<T extends string>({
  label, value, options, onChange, className = "", testId,
}: { label: string; value: T; options: ReadonlyArray<SegmentOption<T>>; onChange: (v: T) => void; className?: string; testId?: string }) {
  const reduce = useReducedMotion();
  const group = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = Math.max(0, options.findIndex((o) => o.value === value));
  const move = (n: number) => { const i = (n + options.length) % options.length; onChange(options[i].value); refs.current[i]?.focus(); };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowRight" || e.key === "ArrowDown") { e.preventDefault(); move(idx + 1); }
    else if (e.key === "ArrowLeft" || e.key === "ArrowUp") { e.preventDefault(); move(idx - 1); }
    else if (e.key === "Home") { e.preventDefault(); move(0); }
    else if (e.key === "End") { e.preventDefault(); move(options.length - 1); }
  };
  return (
    <div role="radiogroup" aria-label={label} className={`gw-seg ${className}`} onKeyDown={onKeyDown} data-testid={testId}>
      {options.map((o, i) => {
        const on = o.value === value;
        return (
          <button key={o.value} ref={(el) => { refs.current[i] = el; }} type="button" role="radio" aria-checked={on} tabIndex={on ? 0 : -1} onClick={() => onChange(o.value)} className="gw-seg-opt" data-testid={o.testId}>
            {on && <motion.span layoutId={`gw-seg-${group}`} className="gw-seg-pill" aria-hidden="true" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 560, damping: 46 }} />}
            {o.label}
          </button>
        );
      })}
    </div>
  );
}
