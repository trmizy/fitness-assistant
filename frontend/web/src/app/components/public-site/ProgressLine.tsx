import { useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode } from "react";

/**
 * "Đường tiến" — chữ ký chuyển động của Gymini.
 * Một đường đi lên theo từng bậc (mỗi bậc = một chặng/chu kỳ). Một chấm sáng chạy theo nhịp
 * của một lần nâng tạ: đi (900ms) — giữ (650ms) — đi tiếp.
 *
 * - Đường dựng theo kích thước THẬT của khung (ResizeObserver) → không méo ở mọi breakpoint.
 * - Chỉ MỘT phần tử chuyển động mỗi frame (nhóm chấm, transform) — không re-render React.
 * - Dừng khi ra khỏi màn hình / tab ẩn. prefers-reduced-motion: vẽ sẵn, chấm đứng yên ở đích.
 */
export type PLNode = { x: number; y: number };

type Props = {
  nodes: PLNode[]; // toạ độ phân số 0..1 trong khung
  start?: PLNode;
  end?: PLNode;
  mode?: "loop" | "controlled" | "static";
  active?: number;
  color?: string;
  nodeFill?: string;
  strokeWidth?: number;
  className?: string;
  renderLabel?: (i: number) => ReactNode;
};

const TRAVEL = 900;
const HOLD = 650;
const ease = (t: number) => (t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2);

function buildPath(pts: { x: number; y: number }[]) {
  let d = `M ${pts[0].x} ${pts[0].y}`;
  for (let i = 1; i < pts.length; i++) {
    const a = pts[i - 1], b = pts[i];
    const dx = b.x - a.x;
    const m = a.x + dx * 0.32; // đoạn bằng (plateau) trước khi lên bậc
    d += ` L ${m} ${a.y} C ${m + dx * 0.34} ${a.y} ${b.x - dx * 0.16} ${b.y} ${b.x} ${b.y}`;
  }
  return d;
}

export function ProgressLine({
  nodes, start, end, mode = "loop", active = 0, color = "var(--ps-accent-bright)", nodeFill = "var(--ps-bg)",
  strokeWidth = 3, className = "", renderLabel,
}: Props) {
  const gid = useId().replace(/:/g, "");
  const boxRef = useRef<HTMLDivElement>(null);
  const pathRef = useRef<SVGPathElement>(null);
  const dotRef = useRef<SVGGElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });
  const [drawn, setDrawn] = useState(false);
  const stops = useRef<number[]>([]); // độ dài path tại mỗi node
  const total = useRef(0);
  const cur = useRef(0); // độ dài hiện tại của chấm
  const visible = useRef(false);
  const reduced = typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;

  useLayoutEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setSize({ w: e.contentRect.width, h: e.contentRect.height }));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const pts = [start, ...nodes, end].filter(Boolean).map((p) => ({ x: p!.x * size.w, y: p!.y * size.h }));
  const d = size.w ? buildPath(pts) : "";

  // Tính độ dài tại mỗi node bằng cách lấy mẫu dọc path.
  useLayoutEffect(() => {
    const path = pathRef.current;
    if (!path || !d) return;
    const L = path.getTotalLength();
    total.current = L;
    path.style.setProperty("--len", String(Math.ceil(L)));
    const samples: { l: number; x: number; y: number }[] = [];
    for (let i = 0; i <= 600; i++) { const l = (L * i) / 600; const p = path.getPointAtLength(l); samples.push({ l, x: p.x, y: p.y }); }
    stops.current = nodes.map((n) => {
      const nx = n.x * size.w, ny = n.y * size.h;
      let best = samples[0];
      for (const s of samples) if (Math.hypot(s.x - nx, s.y - ny) < Math.hypot(best.x - nx, best.y - ny)) best = s;
      return best.l;
    });
    place(cur.current || (reduced ? stops.current[mode === "controlled" ? active : stops.current.length - 1] ?? 0 : 0));
  }, [d]); // eslint-disable-line react-hooks/exhaustive-deps

  const place = (l: number) => {
    const path = pathRef.current, dot = dotRef.current;
    if (!path || !dot || !total.current) return;
    cur.current = l;
    const p = path.getPointAtLength(Math.max(0, Math.min(total.current, l)));
    dot.setAttribute("transform", `translate(${p.x} ${p.y})`);
  };

  // Vẽ đường khi khung vào tầm nhìn; theo dõi hiển thị để dừng vòng lặp.
  useEffect(() => {
    const el = boxRef.current;
    if (!el) return;
    const io = new IntersectionObserver(([e]) => {
      visible.current = e.isIntersecting;
      if (e.isIntersecting) setDrawn(true);
    }, { threshold: 0.25 });
    io.observe(el);
    return () => io.disconnect();
  }, []);

  // Vòng lặp nhịp nâng tạ.
  useEffect(() => {
    if (mode !== "loop" || reduced || !drawn || !size.w) return;
    let raf = 0, t0 = 0, idx = -1, from = 0, to = 0, phase: "wait" | "go" | "hold" = "wait", phaseStart = 0;
    const startDelay = 1300;
    const tick = (now: number) => {
      raf = requestAnimationFrame(tick);
      if (!visible.current || document.hidden) return; // tạm dừng khi khuất màn hình hoặc tab ẩn
      if (!t0) { t0 = now; phaseStart = now; }
      const el = now - phaseStart;
      if (phase === "wait") {
        if (now - t0 < startDelay) return;
        idx = 0; from = 0; to = stops.current[0]; phase = "go"; phaseStart = now; return;
      }
      if (phase === "go") {
        const k = Math.min(1, el / TRAVEL);
        place(from + (to - from) * ease(k));
        if (k >= 1) { phase = "hold"; phaseStart = now; }
        return;
      }
      if (phase === "hold") {
        const last = idx >= stops.current.length - 1;
        if (el < (last ? HOLD * 2.2 : HOLD)) return;
        if (last) { idx = 0; from = 0; to = stops.current[0]; place(0); }
        else { idx += 1; from = cur.current; to = stops.current[idx]; }
        phase = "go"; phaseStart = now;
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [mode, drawn, size.w, d]); // eslint-disable-line react-hooks/exhaustive-deps

  // Chế độ điều khiển: chấm trượt tới node đang active.
  useEffect(() => {
    if (mode !== "controlled" || !size.w) return;
    const target = stops.current[active] ?? 0;
    if (reduced || !drawn) { place(target); return; }
    let raf = 0; const from = cur.current; const t0 = performance.now();
    const tick = (now: number) => {
      const k = Math.min(1, (now - t0) / TRAVEL);
      place(from + (target - from) * ease(k));
      if (k < 1) raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [active, mode, drawn, size.w, d]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { if (mode === "static" && size.w) place(stops.current[stops.current.length - 1] ?? 0); }, [mode, size.w, d]); // eslint-disable-line react-hooks/exhaustive-deps

  return (
    <div ref={boxRef} className={`pointer-events-none absolute inset-0 ${className}`} aria-hidden="true">
      {size.w > 0 && (
        <svg width={size.w} height={size.h} className="absolute inset-0 overflow-visible">
          <defs>
            <linearGradient id={`g${gid}`} gradientUnits="userSpaceOnUse" x1="0" y1="0" x2={size.w} y2="0">
              <stop offset="0" stopColor={color} stopOpacity="0" />
              <stop offset="0.18" stopColor={color} stopOpacity="0.9" />
              <stop offset="1" stopColor={color} stopOpacity="1" />
            </linearGradient>
          </defs>
          <path d={d} fill="none" stroke={color} strokeOpacity="0.18" strokeWidth={strokeWidth * 5} strokeLinecap="round" strokeLinejoin="round"
            className={`ps-pl-path ${drawn ? "ps-is-drawn" : ""}`} />
          <path ref={pathRef} d={d} fill="none" stroke={`url(#g${gid})`} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round"
            className={`ps-pl-path ${drawn ? "ps-is-drawn" : ""}`} />
          {nodes.map((n, i) => (
            <circle key={i} cx={n.x * size.w} cy={n.y * size.h} r={strokeWidth * 2.4} fill={nodeFill} stroke={color} strokeWidth={strokeWidth}
              className={`ps-pl-node ${drawn ? "ps-is-on" : ""}`} style={{ ["--nd" as string]: `${500 + i * 220}ms` }} />
          ))}
          <g ref={dotRef} transform="translate(-100 -100)">
              <circle r={strokeWidth * 5} fill={color} className="ps-pl-dot-halo" opacity="0.4" />
              <circle r={strokeWidth * 2.6} fill={color} />
              <circle r={strokeWidth * 1.1} fill="#ffffff" />
            </g>
        </svg>
      )}
      {renderLabel && size.w > 0 && nodes.map((n, i) => (
        <div key={i} className="absolute" style={{ left: `${n.x * 100}%`, top: `${n.y * 100}%` }}>{renderLabel(i)}</div>
      ))}
    </div>
  );
}
