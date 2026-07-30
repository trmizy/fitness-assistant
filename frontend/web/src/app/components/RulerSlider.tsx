import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { clampValue, resolveValue, stepIndex, valueFromDrag } from "./RulerSlider.utils";

const TICK_SPACING_PX = 14;
// Ticks rendered each side of the center — a fixed-size window regardless of
// the slider's total range, so a 0-300-step-0.5 ruler (600 ticks) never
// mounts more than ~50 DOM nodes at once.
const VISIBLE_TICK_RADIUS = 22;
// Ticks within this many steps of center get progressively taller/brighter.
const MAGNIFY_RADIUS_TICKS = 3;

function vibrate() {
  if (typeof navigator !== "undefined" && typeof navigator.vibrate === "function") {
    try {
      navigator.vibrate(8);
    } catch {
      // Unsupported/blocked — never let haptics break the interaction.
    }
  }
}

export function RulerSlider({
  value,
  onChange,
  min,
  max,
  step,
  unit,
  label,
  majorTickInterval,
  disabled = false,
  formatValue,
  className = "",
}: {
  value: number;
  onChange: (value: number) => void;
  min: number;
  max: number;
  step: number;
  unit?: string;
  label?: string;
  /** Spacing (in value units) between taller/brighter "major" ticks. Defaults to step*5. */
  majorTickInterval?: number;
  disabled?: boolean;
  formatValue?: (value: number) => string;
  className?: string;
}) {
  const resolvedValue = resolveValue(value, min, max, step);
  const [displayValue, setDisplayValue] = useState(resolvedValue);
  const [isDragging, setIsDragging] = useState(false);
  const draggingRef = useRef(false);
  const startXRef = useRef(0);
  const startValueRef = useRef(resolvedValue);
  const movedRef = useRef(false);

  // Stay in sync with an externally-changed `value` (e.g. loading a saved
  // workout's weight/RPE/RIR into the form) as long as the user isn't
  // actively dragging this exact slider.
  useEffect(() => {
    if (!draggingRef.current) setDisplayValue(resolvedValue);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resolvedValue]);

  const effectiveMajorInterval = majorTickInterval ?? step * 5;
  const currentIndex = stepIndex(displayValue, min, step);
  const totalSteps = Math.round((max - min) / step);

  const commit = useCallback(
    (next: number) => {
      const resolved = resolveValue(next, min, max, step);
      setDisplayValue(resolved);
      onChange(resolved);
    },
    [min, max, step, onChange],
  );

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (disabled) return;
    draggingRef.current = true;
    setIsDragging(true);
    movedRef.current = false;
    startXRef.current = e.clientX;
    startValueRef.current = displayValue;
    e.currentTarget.setPointerCapture(e.pointerId);
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current || disabled) return;
    const deltaPx = e.clientX - startXRef.current;
    if (Math.abs(deltaPx) > 2) movedRef.current = true;
    const next = valueFromDrag(startValueRef.current, deltaPx, TICK_SPACING_PX, min, max, step);
    if (next !== displayValue) {
      setDisplayValue(next);
      onChange(next);
    }
  };

  const endDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!draggingRef.current) return;
    draggingRef.current = false;
    setIsDragging(false);
    if (movedRef.current) vibrate();
    try {
      e.currentTarget.releasePointerCapture(e.pointerId);
    } catch {
      // Pointer capture may already be released (e.g. pointercancel) — safe to ignore.
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLDivElement>) => {
    if (disabled) return;
    switch (e.key) {
      case "ArrowRight":
      case "ArrowUp":
        e.preventDefault();
        commit(displayValue + step);
        break;
      case "ArrowLeft":
      case "ArrowDown":
        e.preventDefault();
        commit(displayValue - step);
        break;
      case "PageUp":
        e.preventDefault();
        commit(displayValue + effectiveMajorInterval);
        break;
      case "PageDown":
        e.preventDefault();
        commit(displayValue - effectiveMajorInterval);
        break;
      case "Home":
        e.preventDefault();
        commit(min);
        break;
      case "End":
        e.preventDefault();
        commit(max);
        break;
      default:
        return;
    }
  };

  const ticks = useMemo(() => {
    const startIdx = Math.max(0, currentIndex - VISIBLE_TICK_RADIUS);
    const endIdx = Math.min(totalSteps, currentIndex + VISIBLE_TICK_RADIUS);
    const arr: number[] = [];
    for (let i = startIdx; i <= endIdx; i++) arr.push(i);
    return arr;
  }, [currentIndex, totalSteps]);

  const display = formatValue
    ? formatValue(displayValue)
    : `${displayValue}${unit ? ` ${unit}` : ""}`;

  return (
    <div className={`min-w-0 ${className}`}>
      {label && (
        // min-h reserves space for up to 2 lines at text-xs (16px line-height
        // each) — when two RulerSliders sit side by side (e.g. RPE/RIR) with
        // labels of different lengths, this keeps their value/track rows
        // aligned regardless of which label happens to wrap at a given width.
        <div className="mb-1 min-h-8 text-xs text-zinc-400">{label}</div>
      )}
      <div className="mb-1.5 text-center text-lg font-bold tabular-nums text-emerald-400">
        {display}
      </div>
      <div
        role="slider"
        aria-label={label ?? "Trượt để chọn giá trị"}
        aria-valuemin={min}
        aria-valuemax={max}
        aria-valuenow={displayValue}
        aria-valuetext={display}
        aria-disabled={disabled}
        tabIndex={disabled ? -1 : 0}
        onKeyDown={handleKeyDown}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={endDrag}
        onPointerCancel={endDrag}
        style={{ touchAction: "pan-y" }}
        className={`relative h-16 select-none overflow-hidden rounded-2xl border border-zinc-700 bg-zinc-900 shadow-inner transition-opacity ${
          disabled ? "cursor-not-allowed opacity-40" : "cursor-grab active:cursor-grabbing"
        } focus:outline-none focus-visible:ring-2 focus-visible:ring-emerald-500/50`}
      >
        {/* Subtle highlight column behind the fixed center reading point. */}
        <div className="pointer-events-none absolute inset-y-0 left-1/2 w-12 -translate-x-1/2 bg-emerald-500/10" />

        {ticks.map((i) => {
          const tickValue = min + i * step;
          const offsetTicks = i - currentIndex;
          const offsetPx = offsetTicks * TICK_SPACING_PX;
          const distance = Math.abs(offsetTicks);
          const isMajor = Math.abs((tickValue - min) % effectiveMajorInterval) < step / 2;
          const isCenter = distance === 0;

          const baseHeight = isMajor ? 20 : 12;
          const magnify = Math.max(0, 1 - distance / MAGNIFY_RADIUS_TICKS);
          const height = isCenter ? 32 : baseHeight + magnify * 8;
          const opacity = isCenter ? 1 : 0.6 + magnify * 0.4;
          const color = isCenter ? "#34d399" /* emerald-400 */ : isMajor ? "#d4d4d8" /* zinc-300 */ : "#71717a" /* zinc-500 */;

          return (
            <div
              key={i}
              className="pointer-events-none absolute top-1/2 rounded-full"
              style={{
                left: "50%",
                width: isCenter ? 3 : 2,
                height,
                backgroundColor: color,
                opacity,
                boxShadow: isCenter ? "0 0 8px rgba(52,211,153,0.7)" : undefined,
                transform: `translate(${offsetPx}px, -50%)`,
                transition: isDragging
                  ? "none"
                  : "transform 120ms ease-out, height 120ms ease-out, opacity 120ms ease-out",
              }}
            />
          );
        })}
      </div>
    </div>
  );
}
