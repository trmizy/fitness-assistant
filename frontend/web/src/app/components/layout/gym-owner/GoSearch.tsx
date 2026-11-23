/**
 * 13 input-clear-dissolve for the search boxes of the Gym Owner workspace. A port of the snippet's JS routine: a real <input>
 * (text drawn by a mirror while it has a value), a fake placeholder, and a glow layer whose per-word radial gradients are written
 * from JS during the clear. Clearing lets the typed text fly down + blur + fade while the placeholder falls in from above.
 *
 * Differences from the snippet, on purpose:
 *  - controlled (`value` / `onChange`): the clear calls `onChange("")` at once, so the list under the box is never behind the text;
 *  - reduced motion: the clear is instant, no mirror, no glow;
 *  - the input keeps its own accessible name (`ariaLabel`); the mirror / placeholder / glow are `aria-hidden`.
 * Timing and geometry come from the `--clear-*` / `--glow-*` tokens in gym-owner.css (read on each clear).
 */
import { useCallback, useLayoutEffect, useRef, useState } from "react";
import { MagnifyingGlassIcon, XIcon } from "@phosphor-icons/react";

const reduced = () => typeof window !== "undefined" && typeof window.matchMedia === "function" && window.matchMedia("(prefers-reduced-motion: reduce)").matches;

function bezier(str: string): (t: number) => number {
  const m = String(str).match(/cubic-bezier\(([-\d.]+),\s*([-\d.]+),\s*([-\d.]+),\s*([-\d.]+)\)/);
  if (!m) return (t) => t;
  const [x1, y1, x2, y2] = m.slice(1).map(parseFloat);
  const cx = 3 * x1;
  const bx = 3 * (x2 - x1) - cx;
  const ax = 1 - cx - bx;
  const cy = 3 * y1;
  const by = 3 * (y2 - y1) - cy;
  const ay = 1 - cy - by;
  return (t) => {
    if (t <= 0) return 0;
    if (t >= 1) return 1;
    let s = t;
    for (let i = 0; i < 8; i++) {
      const dx = ((ax * s + bx) * s + cx) * s - t;
      const d = (3 * ax * s + 2 * bx) * s + cx;
      if (Math.abs(dx) < 1e-6 || d === 0) break;
      s -= dx / d;
    }
    return ((ay * s + by) * s + cy) * s;
  };
}

export function GoSearch({
  value,
  onChange,
  placeholder,
  ariaLabel,
  testId,
  className = "",
}: {
  value: string;
  onChange: (next: string) => void;
  placeholder: string;
  ariaLabel: string;
  testId?: string;
  className?: string;
}) {
  const wrap = useRef<HTMLDivElement>(null);
  const input = useRef<HTMLInputElement>(null);
  const mirror = useRef<HTMLDivElement>(null);
  const phold = useRef<HTMLDivElement>(null);
  const glow = useRef<HTMLDivElement>(null);
  const clearing = useRef(false);
  const raf = useRef(0);
  // The class lives in React state: an imperative classList.add would be wiped by the next render of this component.
  const [isClearing, setIsClearing] = useState(false);

  // While the box has a value the mirror draws it; during a clear the mirror keeps the OLD text for the animation.
  useLayoutEffect(() => {
    if (!clearing.current && mirror.current) mirror.current.textContent = value.replace(/ /g, " ");
  }, [value]);
  useLayoutEffect(() => () => cancelAnimationFrame(raf.current), []);

  const clear = useCallback(() => {
    const w = wrap.current;
    const inp = input.current;
    const mir = mirror.current;
    const ph = phold.current;
    const gl = glow.current;
    if (!w || !inp || !mir || !ph || !gl || clearing.current || !value) return;
    if (reduced()) {
      onChange("");
      inp.focus({ preventScroll: true });
      return;
    }
    clearing.current = true;
    const root = document.documentElement;
    const cs = getComputedStyle(root);
    const n = (name: string, fb: number) => {
      const v = parseFloat(cs.getPropertyValue(name));
      return Number.isFinite(v) ? v : fb;
    };
    const total = n("--clear-dur", 1000);
    const outDur = n("--clear-out-dur", 400);
    const inDur = n("--clear-in-dur", 400);
    const outFly = n("--clear-out-fly", 12);
    const inFly = n("--clear-in-fly", 12);
    const blur = n("--clear-blur", 2);
    const delay = n("--glow-delay", 50);
    const peakAt = n("--glow-peak-at", 0.15);
    const gOp = n("--glow-opacity", 0.42);
    const spread = n("--glow-spread", 1.5);
    const easeOut = bezier(cs.getPropertyValue("--clear-out-ease"));
    const easeIn = bezier(cs.getPropertyValue("--clear-in-ease"));
    const text = value.replace(/ /g, " ");
    mir.textContent = text;
    const dark = root.getAttribute("data-theme") === "dark" || root.classList.contains("dark");
    gl.style.mixBlendMode = dark ? "screen" : "multiply";

    // One streak per word (per-word radial gradient stack), measured with the input's own font.
    const ctx = document.createElement("canvas").getContext("2d");
    const layers: string[] = [];
    if (ctx) {
      const ics = getComputedStyle(inp);
      ctx.font = ics.font;
      const rgb = dark ? "255,255,255" : "0,0,0";
      const width = w.clientWidth || 280;
      const padLeft = parseFloat(ics.paddingLeft) || 12;
      let x = 0;
      value.split(/(\s+)/).forEach((seg) => {
        const segW = ctx.measureText(seg).width;
        if (seg.trim()) {
          const cx = padLeft + x + segW / 2;
          const hw = Math.max(segW * 0.45, 8) * spread;
          const a = dark ? 1.9 : 1;
          ([[0, 0.8, 7, 0.22], [hw * 0.45, 0.55, 8, 0.18], [-hw * 0.4, 0.65, 6, 0.16], [hw * 0.15, 0.9, 5, 0.14]] as const).forEach(([dx, rwm, rh, al]) => {
            const lx = (((cx + dx) / width) * 100).toFixed(2);
            layers.push(`radial-gradient(ellipse ${Math.max(hw * rwm, 2).toFixed(1)}px ${rh}px at ${lx}% 100%, rgba(${rgb},${Math.min(al * a, 1).toFixed(2)}), transparent)`);
          });
        }
        x += segW;
      });
    }
    gl.style.background = layers.join(", ");
    gl.style.opacity = "0";
    setIsClearing(true);
    ph.style.transform = `translateY(-${inFly}px)`;
    ph.style.opacity = "0.9";
    ph.style.filter = `blur(${blur}px)`;
    onChange(""); // the list is updated at once; only the box dissolves

    const t0 = performance.now();
    const tick = (now: number) => {
      const el = now - t0;
      const eo = easeOut(Math.min(1, el / outDur));
      mir.style.transform = `translateY(${(eo * outFly).toFixed(1)}px)`;
      mir.style.opacity = (1 - eo).toFixed(3);
      mir.style.filter = `blur(${(eo * blur).toFixed(1)}px)`;
      const ei = easeIn(Math.min(1, el / inDur));
      ph.style.transform = `translateY(${(-inFly + ei * inFly).toFixed(1)}px)`;
      ph.style.opacity = (0.9 + ei * 0.1).toFixed(3);
      ph.style.filter = `blur(${(blur - ei * blur).toFixed(1)}px)`;
      let g = 0;
      if (el > delay) {
        const gp = Math.min(1, (el - delay) / Math.max(1, total - delay));
        g = gp < peakAt ? gp / peakAt : 1 - (gp - peakAt) / (1 - peakAt);
      }
      gl.style.opacity = (g * gOp).toFixed(3);
      if (el < total) {
        raf.current = requestAnimationFrame(tick);
      } else {
        setIsClearing(false);
        mir.style.cssText = "";
        ph.style.cssText = "";
        mir.textContent = "";
        gl.style.opacity = "0";
        gl.style.background = "";
        clearing.current = false;
        inp.focus({ preventScroll: true });
      }
    };
    raf.current = requestAnimationFrame(tick);
  }, [value, onChange]);

  const hasValue = value.length > 0;
  return (
    <div ref={wrap} className={`t-clear go-search${hasValue ? " has-value" : ""}${isClearing ? " is-clearing" : ""} ${className}`} role="search" data-testid={testId}>
      <MagnifyingGlassIcon className="go-search-ico" aria-hidden="true" />
      <input
        ref={input}
        type="text"
        className="go-search-input"
        aria-label={ariaLabel}
        autoComplete="off"
        spellCheck={false}
        value={value}
        onChange={(e) => onChange(e.target.value)}
      />
      <div ref={mirror} className="t-clear-mirror" aria-hidden="true" />
      <div ref={phold} className="t-clear-placeholder" aria-hidden="true">{placeholder}</div>
      <div ref={glow} className="t-clear-glow" aria-hidden="true" />
      {hasValue && (
        <button
          type="button"
          className="t-clear-btn go-search-clear"
          aria-label="Xoá nội dung ô tìm"
          onPointerDown={(e) => {
            if (document.activeElement === input.current) e.preventDefault(); // keep the caret in the box
          }}
          onClick={clear}
        >
          <XIcon aria-hidden="true" />
        </button>
      )}
    </div>
  );
}
