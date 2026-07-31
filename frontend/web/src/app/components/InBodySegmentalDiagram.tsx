/**
 * Visual body-silhouette diagram for InBody segmental analysis (left/right
 * arms, trunk, left/right legs) — mirrors the layout of a real InBody
 * printout's "Segmental Lean/Fat Analysis" section instead of a plain table.
 */
type SegmentalValues = {
  leftArm?: number;
  rightArm?: number;
  trunk?: number;
  leftLeg?: number;
  rightLeg?: number;
};

type SegmentalNorms = {
  arm: number;
  trunk: number;
  leg: number;
};

type Tone = "muscle" | "fat";

const TONE_STYLES: Record<
  Tone,
  { text: string; barTrack: string; barFill: string; silhouette: string }
> = {
  muscle: {
    text: "text-green-400",
    barTrack: "bg-green-950/60",
    barFill: "bg-green-500",
    silhouette: "fill-zinc-800/70 stroke-zinc-700",
  },
  fat: {
    text: "text-amber-400",
    barTrack: "bg-amber-950/60",
    barFill: "bg-amber-500",
    silhouette: "fill-zinc-800/70 stroke-zinc-700",
  },
};

function evaluate(value: number | undefined, norm: number) {
  if (!value || !norm) return { pct: null as number | null, label: "--" };
  const pct = Math.round((value / norm) * 100);
  const label = pct < 90 ? "Under" : pct > 110 ? "Over" : "Normal";
  return { pct, label };
}

function SegmentBadge({
  label,
  value,
  norm,
  tone,
  align,
}: {
  label: string;
  value: number | undefined;
  norm: number;
  tone: Tone;
  align: "left" | "right" | "center";
}) {
  const styles = TONE_STYLES[tone];
  const { pct, label: evalLabel } = evaluate(value, norm);
  const alignClass =
    align === "left"
      ? "items-start text-left"
      : align === "right"
        ? "items-end text-right"
        : "items-center text-center";

  return (
    <div className={`flex flex-col ${alignClass} min-w-[64px]`}>
      <span className="text-[11px] text-zinc-500">{label}</span>
      <span className={`text-sm font-bold ${styles.text}`}>
        {value != null ? `${value.toFixed(2)}kg` : "--"}
      </span>
      {pct != null && (
        <>
          <span className="text-[11px] text-zinc-500">{pct}%</span>
          <span
            className={`text-[10px] font-semibold ${
              evalLabel === "Normal"
                ? "text-zinc-400"
                : evalLabel === "Over"
                  ? "text-amber-400"
                  : "text-red-400"
            }`}
          >
            {evalLabel === "Normal"
              ? "Bình thường"
              : evalLabel === "Over"
                ? "Cao"
                : evalLabel === "Under"
                  ? "Thấp"
                  : evalLabel}
          </span>
        </>
      )}
    </div>
  );
}

export function InBodySegmentalDiagram({
  title,
  tone,
  values,
  norms,
}: {
  title: string;
  tone: Tone;
  values: SegmentalValues;
  norms: SegmentalNorms;
}) {
  const styles = TONE_STYLES[tone];

  return (
    <div>
      <h4
        className={`text-xs font-bold uppercase tracking-wider mb-3 ${
          tone === "muscle" ? "text-green-400/80" : "text-amber-400/80"
        }`}
      >
        {title}
      </h4>
      <div className="flex items-center justify-center gap-3 sm:gap-6">
        {/* Left-side arm/leg labels (screen-left = person's right side, but we
            keep it simple: "Trái" always renders on the left of the diagram,
            matching how the InBody printout itself is read facing the page). */}
        <div className="flex flex-col items-start gap-10 sm:gap-14 pt-6">
          <SegmentBadge
            label="Tay trái"
            value={values.leftArm}
            norm={norms.arm}
            tone={tone}
            align="left"
          />
          <SegmentBadge
            label="Chân trái"
            value={values.leftLeg}
            norm={norms.leg}
            tone={tone}
            align="left"
          />
        </div>

        {/* Body silhouette */}
        <svg
          viewBox="0 0 100 220"
          className="w-16 sm:w-20 shrink-0"
          aria-hidden="true"
        >
          <circle cx="50" cy="18" r="14" className={styles.silhouette} strokeWidth="1.5" />
          <rect
            x="30"
            y="34"
            width="40"
            height="70"
            rx="14"
            className={styles.silhouette}
            strokeWidth="1.5"
          />
          <rect
            x="10"
            y="38"
            width="16"
            height="68"
            rx="8"
            className={styles.silhouette}
            strokeWidth="1.5"
          />
          <rect
            x="74"
            y="38"
            width="16"
            height="68"
            rx="8"
            className={styles.silhouette}
            strokeWidth="1.5"
          />
          <rect
            x="32"
            y="106"
            width="16"
            height="98"
            rx="8"
            className={styles.silhouette}
            strokeWidth="1.5"
          />
          <rect
            x="52"
            y="106"
            width="16"
            height="98"
            rx="8"
            className={styles.silhouette}
            strokeWidth="1.5"
          />
        </svg>

        {/* Right-side arm/leg labels */}
        <div className="flex flex-col items-end gap-10 sm:gap-14 pt-6">
          <SegmentBadge
            label="Tay phải"
            value={values.rightArm}
            norm={norms.arm}
            tone={tone}
            align="right"
          />
          <SegmentBadge
            label="Chân phải"
            value={values.rightLeg}
            norm={norms.leg}
            tone={tone}
            align="right"
          />
        </div>
      </div>

      {/* Trunk — centered below/behind the silhouette's torso row */}
      <div className="flex justify-center mt-2">
        <SegmentBadge
          label="Thân mình"
          value={values.trunk}
          norm={norms.trunk}
          tone={tone}
          align="center"
        />
      </div>
    </div>
  );
}
