import { ElementType } from "react";

interface KpiCardProps {
  label: string;
  value: string | number;
  change?: string;
  icon: ElementType;
  color: string;
  bg: string;
  iconBg: string;
  border: string;
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
  color,
  bg,
  iconBg,
  border,
  loading,
  animationDelayClass = "",
}: KpiCardProps) {
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
        <div className="text-xl font-bold text-zinc-100">{value}</div>
      )}
      <div className="text-xs text-zinc-500 mt-0.5">{label}</div>
    </div>
  );
}
