/*
 * Body figure (front/back anatomical SVG) — split out of BodyAnalysis so the `body-muscles` path data (large) is a
 * separate chunk loaded lazily after first paint (OB-2). BodyAnalysis reserves the exact box with
 * <BodyFigureFallback/>, so nothing moves when the figure arrives.
 */
import { useLayoutEffect, useRef, useState } from "react";
import { FRONT_MUSCLES, BACK_MUSCLES } from "body-muscles";
import { regionAnatomyCode, regionSegment, type SegmentKey } from "../../utils/bodySegments";

export type Mode = "lean" | "fat" | "anatomy";
export type Sel = { kind: "segment"; key: SegmentKey } | { kind: "muscle"; code: string };

// Padded viewBoxes leave room for the printout callout beside the figure.
const VIEW = { FRONT: { box: "-10 -1 55 95", muscles: FRONT_MUSCLES }, BACK: { box: "27 -1 55 95", muscles: BACK_MUSCLES } } as const;

export default function Figure({
  side, mode, selected, hover, onPick, onHover, callout,
}: {
  side: "FRONT" | "BACK";
  mode: Mode;
  selected: Sel | null;
  hover: Sel | null;
  onPick: (s: Sel) => void;
  onHover: (s: Sel | null) => void;
  callout: { key: SegmentKey; text: string } | null;
}) {
  const v = VIEW[side];
  const gRef = useRef<SVGGElement>(null);
  const [anchor, setAnchor] = useState<{ x: number; y: number; toRight: boolean } | null>(null);
  const unitOf = (id: string): Sel | null => {
    if (mode === "anatomy") { const c = regionAnatomyCode(id); return c ? { kind: "muscle", code: c } : null; }
    const s = regionSegment(id); return s ? { kind: "segment", key: s } : null;
  };
  const same = (a: Sel | null, b: Sel | null) => !!a && !!b && (a.kind === "segment" && b.kind === "segment" ? a.key === b.key : a.kind === "muscle" && b.kind === "muscle" && a.code === b.code);

  // Callout anchor = centre of the selected segment's paths on THIS view (measured, not hard-coded).
  useLayoutEffect(() => {
    if (!callout || !gRef.current) { setAnchor(null); return; }
    const els = gRef.current.querySelectorAll<SVGPathElement>(`[data-seg="${callout.key}"]`);
    if (!els.length) { setAnchor(null); return; }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    els.forEach((el) => { const b = el.getBBox(); x0 = Math.min(x0, b.x); y0 = Math.min(y0, b.y); x1 = Math.max(x1, b.x + b.width); y1 = Math.max(y1, b.y + b.height); });
    const mid = side === "FRONT" ? 17.5 : 54.5;
    const cx = (x0 + x1) / 2;
    setAnchor({ x: cx, y: (y0 + y1) / 2, toRight: cx >= mid });
  }, [callout, side]);

  const edgeX = anchor ? (anchor.toRight ? (side === "FRONT" ? 44 : 81) : (side === "FRONT" ? -9 : 28)) : 0;
  return (
    <svg viewBox={v.box} className="block h-full w-auto max-w-full" aria-hidden="true" focusable="false">
      <g ref={gRef}>
        {v.muscles.map((m) => {
          const unit = unitOf(m.id);
          const on = same(unit, selected);
          const hov = !on && same(unit, hover);
          const seg = regionSegment(m.id);
          return (
            <path
              key={m.id}
              d={m.path}
              data-seg={seg ?? undefined}
              className={`ob-body-part${unit ? " ob-body-hit" : ""}`}
              data-on={on || undefined}
              data-hover={hov || undefined}
              data-quiet={!unit || undefined}
              onPointerEnter={unit ? () => onHover(unit) : undefined}
              onPointerLeave={unit ? () => onHover(null) : undefined}
              onClick={unit ? () => onPick(unit) : undefined}
            />
          );
        })}
      </g>
      {anchor && callout && (
        <g className="pointer-events-none">
          <line x1={anchor.x} y1={anchor.y} x2={edgeX + (anchor.toRight ? -0.6 : 0.6)} y2={anchor.y} stroke="var(--ob-text-3)" strokeWidth="0.18" strokeDasharray="0.6 0.5" />
          <circle cx={anchor.x} cy={anchor.y} r="0.7" fill="var(--ob-text)" />
          <text x={edgeX} y={anchor.y - 1.4} textAnchor={anchor.toRight ? "end" : "start"} fontSize="3.4" fontWeight="600" fill="var(--ob-text)" className="ob-num">{callout.text}</text>
        </g>
      )}
    </svg>
  );
}
