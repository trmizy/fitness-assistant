import { ElementType } from "react";

/**
 * GYM_MANAGEMENT master spec §54/§55 — "StatCard". Rather than typing out four raw class
 * props (bg/color/iconBg/border) at every call site, pass `tone` instead — kept as an
 * addition, not a replacement, so the three pre-existing callers (AdminAIObservability,
 * GymOwnerDashboard, PTDashboard) that already pass explicit classes need no changes.
 */
export type KpiCardTone = "success" | "warning" | "danger" | "info" | "neutral";

const TONE_PRESET: Record<KpiCardTone, { color: string; bg: string; iconBg: string; border: string }> = {
  success: { color: "text-green-400", bg: "bg-green-500/5", iconBg: "bg-green-500/10", border: "border-green-500/20" },
  warning: { color: "text-amber-400", bg: "bg-amber-500/5", iconBg: "bg-amber-500/10", border: "border-amber-500/20" },
  danger: { color: "text-red-400", bg: "bg-red-500/5", iconBg: "bg-red-500/10", border: "border-red-500/20" },
  info: { color: "text-blue-400", bg: "bg-blue-500/5", iconBg: "bg-blue-500/10", border: "border-blue-500/20" },
  neutral: { color: "text-zinc-400", bg: "bg-zinc-900/60", iconBg: "bg-zinc-800", border: "border-zinc-800" },
};

interface KpiCardProps {
  label: string;
  value: string | number;
  change?: string;
  icon: ElementType;
  tone?: KpiCardTone;
  color?: string;
  bg?: string;
  iconBg?: string;
  border?: string;
  loading?: boolean;
  /** One of the fixed `delay-*` classes from tw-animate-css, for a staggered load-in
   * across a KPI row. Omit for no delay. */
  animationDelayClass?: string;
}

export function KpiCard({
  label,
  value,
  change,
  icon: Icon,
  tone,
  color,
  bg,
  iconBg,
  border,
  loading,
  animationDelayClass = "",
}: KpiCardProps) {
  const preset = tone ? TONE_PRESET[tone] : undefined;
  color = color ?? preset?.color ?? TONE_PRESET.neutral.color;
  bg = bg ?? preset?.bg ?? TONE_PRESET.neutral.bg;
  iconBg = iconBg ?? preset?.iconBg ?? TONE_PRESET.neutral.iconBg;
  border = border ?? preset?.border ?? TONE_PRESET.neutral.border;
  return (
    <div
      className={`${bg} ${border} animate-in fade-in-0 slide-in-from-bottom-2 duration-500 fill-mode-both ${animationDelayClass} rounded-xl border p-4 transition-transform duration-300 ease-out hover:-translate-y-0.5`}
    >
      <div className="mb-3 flex items-start justify-between">
        <div
          className={`w-9 h-9 ${iconBg} rounded-lg flex items-center justify-center`}
        >
          <Icon className={`w-4 h-4 ${color}`} />
        </div>
        {change && (
          <span
            className={`text-xs font-bold ${color} bg-black/20 px-2 py-0.5 rounded-full`}
          >
            {change}
          </span>
        )}
      </div>
      {loading ? (
        <div className="h-7 w-12 bg-zinc-800 rounded animate-pulse mb-1" />
      ) : (
        // §54: money/counts use a mono font with tabular figures so multi-card rows align.
        <div className="text-xl font-bold text-zinc-100 font-mono tabular-nums">{value}</div>
      )}
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}
