/*
 * OBSIDIAN dashboard hero — InBody body analysis on an anatomical front + back figure.
 *
 * Data honesty (see utils/bodySegments.ts): the figure only ever lights the ONE segment the user selected; it is
 * never a heatmap, never coloured good/bad, never a per-muscle score. Values are the machine's kg per segment.
 * The "Nhóm cơ" layer is neutral anatomy for exploring (links to the muscle library) — explicitly not a result.
 *
 * Interaction model:
 * - Figure (SVG, role="img" with a summary name): mouse/touch hover + tap select a segment or muscle group.
 *   Its paths are NOT focusable (no hidden buttons inside an image — the A11Y-4 lesson).
 * - Keyboard / screen reader path: the readout rows (real <button aria-pressed>) and the muscle-group buttons
 *   select the same thing; hovering a row lights the figure, hovering the figure lights the row.
 * - Segmented control (radiogroup) switches Khối nạc / Khối mỡ / Nhóm cơ; tabs exist only for data that exists.
 */
import { Suspense, lazy, useId, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router";
import { AnimatePresence, motion, useReducedMotion } from "motion/react";
import { ArrowRightIcon, UploadSimpleIcon, ArrowClockwiseIcon, InfoIcon } from "@phosphor-icons/react";
import { useSettings } from "../../context/SettingsContext";
import SpotlightCard from "../reactbits/SpotlightCard/SpotlightCard";
import { muscleCodeLabel } from "../../utils/labels.vi";
import { isBackViewMuscle } from "../../constants/muscleRegionMap";
import { DASHBOARD_ERROR_TEXT } from "../../utils/dashboardDataState";
import {
  SEGMENTS, ANATOMY_CODES, availableMetrics, fmtKg, limbBalance, segmentValues,
  type SegmentKey,
} from "../../utils/bodySegments";
import type { Mode, Sel } from "./BodyFigure";
// OB-2: the figure's path data (body-muscles) loads after first paint; the box below is reserved meanwhile.
const Figure = lazy(() => import("./BodyFigure"));

/** Same box the figure occupies (viewBox 55x95, full height of its slot): no layout shift when it arrives. */
function BodyFigureFallback() {
  return <div aria-hidden="true" data-testid="ob-figure-placeholder" className="h-full" style={{ aspectRatio: "55 / 95", maxWidth: "100%" }} />;
}
const MODE_LABEL: Record<Mode, string> = { lean: "Khối nạc", fat: "Khối mỡ", anatomy: "Nhóm cơ" };
const EASE = [0.22, 1, 0.36, 1] as const;

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: Array<{ value: T; label: string }>; onChange: (v: T) => void; label: string }) {
  const reduce = useReducedMotion();
  const id = useId();
  const refs = useRef<Array<HTMLButtonElement | null>>([]);
  const idx = options.findIndex((o) => o.value === value);
  const onKey = (e: React.KeyboardEvent) => {
    const d = e.key === "ArrowRight" || e.key === "ArrowDown" ? 1 : e.key === "ArrowLeft" || e.key === "ArrowUp" ? -1 : 0;
    if (!d) return;
    e.preventDefault();
    const n = (idx + d + options.length) % options.length;
    onChange(options[n].value);
    refs.current[n]?.focus();
  };
  return (
    <div role="radiogroup" aria-label={label} className="ob-seg" onKeyDown={onKey}>
      {options.map((o, i) => (
        <button
          key={o.value}
          ref={(el) => { refs.current[i] = el; }}
          type="button"
          role="radio"
          aria-checked={o.value === value}
          tabIndex={o.value === value ? 0 : -1}
          onClick={() => onChange(o.value)}
          className="ob-seg-btn"
        >
          {o.value === value && <motion.span layoutId={`seg-${id}`} className="ob-seg-pill" aria-hidden="true" transition={reduce ? { duration: 0 } : { type: "spring", stiffness: 560, damping: 46 }} />}
          {o.label}
        </button>
      ))}
    </div>
  );
}

export type BodyAnalysisProps = {
  state: "loading" | "error" | "empty" | "ready";
  latest: Record<string, unknown> | null;
  prev: Record<string, unknown> | null;
  measuredLabel: string | null;
  onRetry: () => void;
  retrying: boolean;
};

export function BodyAnalysis({ state, latest, prev, measuredLabel, onRetry, retrying }: BodyAnalysisProps) {
  const navigate = useNavigate();
  const reduce = useReducedMotion();
  const { effectiveTheme } = useSettings();
  const metrics = useMemo(() => (state === "ready" ? availableMetrics(latest) : []), [state, latest]);
  const modes: Mode[] = [...metrics, "anatomy"];
  const [modePick, setMode] = useState<Mode | null>(null);
  const mode: Mode = modePick && modes.includes(modePick) ? modePick : modes[0];
  const [selPick, setSel] = useState<Sel | null>(null);
  const [hover, setHover] = useState<Sel | null>(null);

  const values = mode !== "anatomy" ? segmentValues(latest, mode, prev) : [];
  const firstWithValue = values.find((v) => v.kg != null)?.key ?? null;
  const selected: Sel | null =
    mode === "anatomy"
      ? selPick?.kind === "muscle" ? selPick : null
      : selPick?.kind === "segment" ? selPick : firstWithValue ? { kind: "segment", key: firstWithValue } : null;
  const selValue = selected?.kind === "segment" ? values.find((v) => v.key === selected.key) : undefined;
  const callout = selected?.kind === "segment" && selValue?.kg != null ? { key: selected.key, text: `${fmtKg(selValue.kg)} kg` } : null;

  const val = (k: SegmentKey) => values.find((v) => v.key === k)?.kg ?? null;
  const armBal = mode === "lean" ? limbBalance(val("rightArm"), val("leftArm")) : null;
  const legBal = mode === "lean" ? limbBalance(val("rightLeg"), val("leftLeg")) : null;

  const figureName =
    state === "ready" && mode !== "anatomy"
      ? `Hình cơ thể mặt trước và mặt sau, ${MODE_LABEL[mode].toLowerCase()} theo vùng. ${values.map((v) => `${v.label} ${v.kg != null ? fmtKg(v.kg) + " kg" : "không có số đo"}`).join(", ")}.`
      : mode === "anatomy"
        ? `Hình giải phẫu mặt trước và mặt sau${selected?.kind === "muscle" ? `, đang chọn ${muscleCodeLabel(selected.code)}` : ""}.`
        : "Hình cơ thể mặt trước và mặt sau, chưa có số đo.";

  const pick = (s: Sel) => setSel(s);
  const body = (
    <div className="grid grid-cols-2 gap-1" style={{ height: "clamp(300px, 46vw, 460px)" }}>
      {(["FRONT", "BACK"] as const).map((side) => (
        <figure key={side} className="flex min-h-0 flex-col items-center">
          <div className="min-h-0 w-full flex-1 flex justify-center">
            <Suspense fallback={<BodyFigureFallback />}><Figure side={side} mode={state === "ready" ? mode : "anatomy"} selected={state === "ready" ? selected : null} hover={state === "ready" ? hover : null} onPick={state === "ready" ? pick : () => {}} onHover={state === "ready" ? setHover : () => {}} callout={side === "FRONT" ? callout : null} /></Suspense>
          </div>
          <figcaption className="mt-1 text-xs text-[var(--ob-text-3)]">{side === "FRONT" ? "Mặt trước" : "Mặt sau"}</figcaption>
        </figure>
      ))}
    </div>
  );

  return (
    <SpotlightCard
      theme={effectiveTheme === "light" ? "light" : "dark"}
      spotlightColor={effectiveTheme === "light" ? "#16a34a" : "#22c55e"}
      intensity={0.05}
      borderGlow={0.35}
      spotlightSize={320}
      proximity={0}
      flare={false}
      className="ob-glass ob-hero !rounded-[24px] !p-0"
      style={{ "--spotlight-card-surface": "transparent", "--spotlight-card-border": "transparent", "--spotlight-card-shadow": "none" } as React.CSSProperties}
    >
      <section aria-labelledby="ob-body-h" className="p-5 md:p-6" aria-busy={state === "loading" || undefined}>
        <header className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="ob-body-h" className="text-lg font-semibold text-[var(--ob-text)]">Phân tích cơ thể</h2>
            <p className="mt-0.5 text-sm text-[var(--ob-text-2)]">
              {state === "ready" && measuredLabel ? <>Phiếu InBody đo ngày <span className="ob-num">{measuredLabel}</span></> : state === "loading" ? "Đang tải số đo" : state === "error" ? "Chưa tải được số đo" : "Chưa có phiếu InBody"}
            </p>
          </div>
          {state === "ready" && <Segmented label="Chế độ phân tích" value={mode} options={modes.map((m) => ({ value: m, label: MODE_LABEL[m] }))} onChange={(m) => { setMode(m); setSel(null); setHover(null); }} />}
        </header>

        <div className="mt-5 grid grid-cols-1 gap-6 md:grid-cols-[minmax(0,1.35fr)_minmax(0,1fr)] md:items-center">
          <div role="img" aria-label={figureName} className={state === "loading" ? "animate-pulse opacity-60" : state !== "ready" ? "opacity-70" : ""}>
            {body}
          </div>

          <div className="min-w-0">
            {state === "loading" && (
              <div className="space-y-2" aria-hidden="true">
                {SEGMENTS.map((s) => <div key={s.key} className="h-14 rounded-xl bg-[var(--ob-surface-2)]" />)}
              </div>
            )}

            {state === "error" && (
              <div role="alert" data-testid="ob-body-error" className="rounded-2xl border border-st-warning-border bg-st-warning-bg p-4 text-sm text-st-warning">
                <p>{DASHBOARD_ERROR_TEXT.body}</p>
                <button type="button" onClick={onRetry} disabled={retrying} className="mt-3 inline-flex min-h-11 items-center gap-2 rounded-xl border border-current px-4 font-semibold disabled:opacity-60">
                  <ArrowClockwiseIcon className="h-4 w-4" aria-hidden="true" />
                  {retrying ? DASHBOARD_ERROR_TEXT.retrying : DASHBOARD_ERROR_TEXT.retry}
                </button>
              </div>
            )}

            {state === "empty" && (
              <div data-testid="ob-body-empty">
                <p className="text-base font-medium text-[var(--ob-text)]">Tải phiếu InBody để xem cơ thể theo từng vùng</p>
                <p className="mt-1 text-sm text-[var(--ob-text-2)]">Gymini đọc khối nạc và khối mỡ của hai tay, thân và hai chân từ phiếu, rồi hiện lên hình này.</p>
                <button type="button" onClick={() => navigate("/client/inbody")} className="mt-4 inline-flex min-h-11 items-center gap-2 rounded-xl bg-[var(--ob-accent)] px-5 text-sm font-semibold text-[var(--ob-on-accent)] transition-colors hover:brightness-110">
                  <UploadSimpleIcon className="h-4 w-4" aria-hidden="true" /> Tải InBody
                </button>
              </div>
            )}

            {state === "ready" && mode !== "anatomy" && (
              <>
                <ul className="space-y-1" aria-label={`${MODE_LABEL[mode]} theo vùng`}>
                  {values.map((v) => {
                    const on = selected?.kind === "segment" && selected.key === v.key;
                    const hov = hover?.kind === "segment" && hover.key === v.key;
                    return (
                      <li key={v.key}>
                        <button
                          type="button"
                          aria-pressed={on}
                          disabled={v.kg == null}
                          onClick={() => setSel({ kind: "segment", key: v.key })}
                          onPointerEnter={() => setHover({ kind: "segment", key: v.key })}
                          onPointerLeave={() => setHover(null)}
                          onFocus={() => setHover({ kind: "segment", key: v.key })}
                          onBlur={() => setHover(null)}
                          data-hover={hov || undefined}
                          className="ob-readout disabled:cursor-default disabled:opacity-70"
                          data-testid="ob-readout"
                        >
                          <span className="ob-readout-name">{v.label}</span>
                          <span className="ob-readout-val ob-num">
                            <AnimatePresence mode="popLayout" initial={false}>
                              <motion.span key={`${mode}-${v.kg}`} initial={reduce ? false : { opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={reduce ? undefined : { opacity: 0, y: -4 }} transition={{ duration: 0.16, ease: EASE }} className="inline-block">
                                {v.kg != null ? <>{fmtKg(v.kg)}<span className="ml-1 text-sm font-medium text-[var(--ob-text-2)]">kg</span></> : <span className="text-sm font-medium text-[var(--ob-text-3)]">Không có trên phiếu</span>}
                              </motion.span>
                            </AnimatePresence>
                          </span>
                          {v.deltaKg != null && <span className="ob-readout-sub ob-num">{v.deltaKg === 0 ? "Không đổi" : <>{v.deltaKg > 0 ? "+" : ""}{fmtKg(v.deltaKg)} kg</>} so với lần đo trước</span>}
                        </button>
                      </li>
                    );
                  })}
                </ul>
                {(armBal || legBal) && (
                  <dl className="ob-inset mt-3 grid grid-cols-1 gap-2 p-3 text-sm" data-testid="ob-balance">
                    {[["Hai tay", armBal], ["Hai chân", legBal]].map(([k, b]) => b && typeof b === "object" ? (
                      <div key={k as string}>
                        <dt className="text-xs text-[var(--ob-text-3)]">{k as string}</dt>
                        <dd className={`mt-0.5 ob-num ${b.tone === "normal" ? "text-[var(--ob-text)]" : "text-st-warning"}`}>{b.label}</dd>
                      </div>
                    ) : null)}
                  </dl>
                )}
                <p className="mt-3 flex gap-1.5 text-xs text-[var(--ob-text-3)]">
                  <InfoIcon className="mt-px h-3.5 w-3.5 shrink-0" aria-hidden="true" />
                  <span>Số kg là của cả vùng do máy InBody đo. Ranh giới vùng trên hình chỉ để minh hoạ{mode === "lean" ? "; mức lệch dưới 5% giữa hai bên là bình thường" : ""}.</span>
                </p>
              </>
            )}

            {state === "ready" && mode === "anatomy" && (
              <div data-testid="ob-anatomy">
                <p className="text-xs text-[var(--ob-text-3)]">Lớp giải phẫu để khám phá các nhóm cơ — không phải kết quả đo của bạn.</p>
                {metrics.length === 0 && <p className="mt-2 text-sm text-[var(--ob-text-2)]">Phiếu InBody gần nhất không có phân tích theo vùng, nên chưa có số đo để hiện lên hình.</p>}
                <div className="mt-3 flex flex-wrap gap-1.5" role="group" aria-label="Nhóm cơ">
                  {ANATOMY_CODES.map((code) => {
                    const on = selected?.kind === "muscle" && selected.code === code;
                    return (
                      <button
                        key={code}
                        type="button"
                        aria-pressed={on}
                        onClick={() => setSel({ kind: "muscle", code })}
                        onPointerEnter={() => setHover({ kind: "muscle", code })}
                        onPointerLeave={() => setHover(null)}
                        onFocus={() => setHover({ kind: "muscle", code })}
                        onBlur={() => setHover(null)}
                        className={`inline-flex min-h-11 items-center rounded-xl border px-3 text-sm transition-colors ${on ? "border-[var(--ob-accent-line)] bg-[var(--ob-accent-soft)] text-[var(--ob-text)]" : "border-[var(--ob-hair)] text-[var(--ob-text-2)] hover:bg-[var(--ob-surface-2)] hover:text-[var(--ob-text)]"}`}
                      >
                        {muscleCodeLabel(code)}
                      </button>
                    );
                  })}
                </div>
                {selected?.kind === "muscle" && (
                  <div className="ob-inset mt-3 flex flex-wrap items-center justify-between gap-3 p-3" aria-live="polite">
                    <div>
                      <p className="font-medium text-[var(--ob-text)]">{muscleCodeLabel(selected.code)}</p>
                      <p className="text-xs text-[var(--ob-text-3)]">{isBackViewMuscle(selected.code) ? "Nhìn rõ ở mặt sau" : "Nhìn rõ ở mặt trước"}</p>
                    </div>
                    <button type="button" onClick={() => navigate(`/client/muscles/${selected.code}`)} className="inline-flex min-h-11 items-center gap-1.5 rounded-xl px-3 text-sm font-semibold ob-link">
                      Xem bài tập cho nhóm cơ này <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
                    </button>
                  </div>
                )}
              </div>
            )}
          </div>
        </div>

        {state === "ready" && (
          <button type="button" onClick={() => navigate("/client/inbody")} className="ob-cta mt-5 flex min-h-12 w-full items-center justify-between gap-2 rounded-2xl px-4 text-sm font-semibold">
            <span>Xem báo cáo InBody đầy đủ</span>
            <ArrowRightIcon className="h-4 w-4" aria-hidden="true" />
          </button>
        )}
      </section>
    </SpotlightCard>
  );
}
