import { useEffect, useRef } from "react";
import { useReducedMotion } from "motion/react";
import { useSettings } from "../../context/SettingsContext";

/**
 * TempoField — Gymini's hero particle field ("Nhịp tập").
 *
 * Dashes sit on concentric rings (a weight plate seen face-on). The whole field
 * breathes at rep tempo — 1.2 s concentric (rings draw in), 1.8 s eccentric
 * (rings release) — instead of drifting randomly. The pointer pushes dashes
 * aside within a small radius; touch devices get the tempo only.
 *
 * Budget rules (so the hero never costs LCP or INP):
 *  - Canvas 2D, no WebGL, no library. DPR capped at 1.5.
 *  - Dash count scales with area: ≤ 640 desktop, ≤ 220 at 390px.
 *  - Paused when off-screen (IntersectionObserver) or tab hidden.
 *  - Reduced motion: one static frame, no loop, no pointer response.
 *  - First frame is drawn after the headline paints (requestIdleCallback), and the
 *    canvas is aria-hidden + pointer-events:none so it never blocks a click.
 *  - Colours are read from theme tokens, so the light theme just works.
 */
type Dash = { ring: number; a: number; r: number; len: number; w: number; hue: 0 | 1 | 2; ox: number; oy: number };

const CONCENTRIC = 1200;
const ECCENTRIC = 1800;
const CYCLE = CONCENTRIC + ECCENTRIC;

function tempo(t: number) {
  // 0 → 1 (contract) over 1.2 s, 1 → 0 (release) over 1.8 s, eased both ways.
  const p = t % CYCLE;
  if (p < CONCENTRIC) { const x = p / CONCENTRIC; return 1 - Math.pow(1 - x, 3); }
  const x = (p - CONCENTRIC) / ECCENTRIC; return 1 - (x * x * (3 - 2 * x));
}

export function TempoField({ className = "" }: { className?: string }) {
  const ref = useRef<HTMLCanvasElement>(null);
  const reduced = !!useReducedMotion();
  const { effectiveTheme: theme } = useSettings();

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d", { alpha: true });
    if (!ctx) return;

    let w = 0, h = 0, dpr = 1, cx = 0, cy = 0, maxR = 0;
    let dashes: Dash[] = [];
    let raf = 0, running = false, visible = true;
    const pointer = { x: -9999, y: -9999, active: false };

    const css = getComputedStyle(document.documentElement);
    const colPrimary = css.getPropertyValue("--primary").trim() || "#22c55e";
    const colMuted = css.getPropertyValue("--muted-foreground").trim() || "#71717a";
    const colChart2 = css.getPropertyValue("--chart-2").trim() || "#10b981";
    const palette = [colPrimary, colChart2, colMuted];

    const build = () => {
      const rect = canvas.getBoundingClientRect();
      w = rect.width; h = rect.height;
      dpr = Math.min(window.devicePixelRatio || 1, 1.5);
      canvas.width = Math.round(w * dpr); canvas.height = Math.round(h * dpr);
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      cx = w / 2; cy = h * 0.46;
      maxR = Math.hypot(Math.max(cx, w - cx), Math.max(cy, h - cy));
      const target = Math.min(w < 640 ? 220 : 640, Math.round((w * h) / 2100));
      const rings = w < 640 ? 9 : 14;
      dashes = [];
      for (let i = 0; i < target; i++) {
        const ring = Math.floor(Math.pow(Math.random(), 0.8) * rings);
        const r = (0.16 + (ring / rings) * 0.9) * maxR * (0.96 + Math.random() * 0.08);
        const hueRoll = Math.random();
        dashes.push({
          ring, r,
          a: Math.random() * Math.PI * 2,
          len: 3 + Math.random() * 6,
          w: 1 + Math.random() * 0.9,
          hue: hueRoll < 0.58 ? 2 : hueRoll < 0.9 ? 0 : 1,
          ox: 0, oy: 0,
        });
      }
    };

    const draw = (now: number) => {
      ctx.clearRect(0, 0, w, h);
      const k = reduced ? 0.35 : tempo(now);
      for (const d of dashes) {
        // Inner rings contract more than outer ones: reads as one breath travelling outward.
        const pull = (1 - d.ring / 14) * 0.07 * k;
        const spin = reduced ? 0 : now * 0.000018 * (d.ring % 2 ? 1 : -1);
        const a = d.a + spin;
        let x = cx + Math.cos(a) * d.r * (1 - pull);
        let y = cy + Math.sin(a) * d.r * (1 - pull) * 0.82;
        if (pointer.active && !reduced) {
          const dx = x - pointer.x, dy = y - pointer.y;
          const dist = Math.hypot(dx, dy);
          if (dist < 120) {
            const f = (1 - dist / 120) * 18;
            d.ox += ((dx / (dist || 1)) * f - d.ox) * 0.18;
            d.oy += ((dy / (dist || 1)) * f - d.oy) * 0.18;
          } else { d.ox *= 0.92; d.oy *= 0.92; }
        } else { d.ox *= 0.92; d.oy *= 0.92; }
        x += d.ox; y += d.oy;
        // Fade toward the centre so the headline always sits on calm ground.
        const centre = Math.hypot(x - cx, (y - cy) / 0.82) / maxR;
        const alpha = Math.max(0, Math.min(1, (centre - 0.18) * 2.2)) * (d.hue === 2 ? 0.55 : 0.85);
        if (alpha < 0.03) continue;
        const ang = a + Math.PI / 2; // tangent to the ring
        const hl = d.len * (0.7 + 0.3 * k);
        ctx.globalAlpha = alpha;
        ctx.strokeStyle = palette[d.hue];
        ctx.lineWidth = d.w;
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.moveTo(x - Math.cos(ang) * hl, y - Math.sin(ang) * hl);
        ctx.lineTo(x + Math.cos(ang) * hl, y + Math.sin(ang) * hl);
        ctx.stroke();
      }
      ctx.globalAlpha = 1;
    };

    const loop = (now: number) => {
      if (!running) return;
      draw(now);
      raf = requestAnimationFrame(loop);
    };
    const start = () => {
      if (reduced) { draw(0); return; }
      if (running || !visible || document.hidden) return;
      running = true; raf = requestAnimationFrame(loop);
    };
    const stop = () => { running = false; cancelAnimationFrame(raf); };

    build();
    const idle = (window as any).requestIdleCallback ?? ((f: () => void) => setTimeout(f, 60));
    const idleId = idle(() => { draw(performance.now()); start(); });

    const io = new IntersectionObserver(([e]) => { visible = e.isIntersecting; visible ? start() : stop(); });
    io.observe(canvas);
    const onVis = () => (document.hidden ? stop() : start());
    document.addEventListener("visibilitychange", onVis);
    let resizeT = 0;
    const onResize = () => { clearTimeout(resizeT); resizeT = window.setTimeout(() => { build(); if (reduced) draw(0); }, 120); };
    window.addEventListener("resize", onResize);
    const host = canvas.parentElement!;
    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "mouse") return;
      const r = canvas.getBoundingClientRect();
      pointer.x = e.clientX - r.left; pointer.y = e.clientY - r.top; pointer.active = true;
    };
    const onLeave = () => { pointer.active = false; };
    host.addEventListener("pointermove", onMove, { passive: true });
    host.addEventListener("pointerleave", onLeave);

    return () => {
      stop(); io.disconnect();
      (window as any).cancelIdleCallback?.(idleId);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", onResize);
      host.removeEventListener("pointermove", onMove);
      host.removeEventListener("pointerleave", onLeave);
    };
  }, [reduced, theme]);

  return <canvas ref={ref} aria-hidden="true" className={`pointer-events-none absolute inset-0 h-full w-full ${className}`} data-testid="tempo-field" />;
}
