import { CaretRightIcon as ChevronRight } from "@phosphor-icons/react";
import { useNavigate } from "react-router";
import type { Icon as LucideIcon } from "@phosphor-icons/react";

/** A compact "goes to a real, already-working page" row — the entry
 * points into TrainingEquipmentSettingsPage, ExportDataPage,
 * NotificationPreferencesPage, etc. that Settings links into rather than
 * reimplementing (impact analysis §9: "link-in, not reimplemented"). */
export function LinkRow({
  icon: Icon,
  label,
  description,
  to,
  testId,
}: {
  icon: LucideIcon;
  label: string;
  description?: string;
  to: string;
  testId?: string;
}) {
  const navigate = useNavigate();
  return (
    <button
      type="button"
      data-testid={testId}
      onClick={() => navigate(to)}
      className="w-full flex items-center justify-between gap-3 rounded-lg border border-zinc-800/60 bg-zinc-950/40 hover:border-zinc-700 hover:bg-zinc-900 p-3 transition-all text-left"
    >
      <div className="flex items-center gap-3 min-w-0">
        <Icon className="w-4 h-4 text-zinc-400 flex-shrink-0" />
        <div className="min-w-0">
          <div className="text-sm font-semibold text-zinc-200 truncate">{label}</div>
          {description && (
            <div className="text-xs text-zinc-600 mt-0.5">{description}</div>
          )}
        </div>
      </div>
      <ChevronRight className="w-4 h-4 text-zinc-600 flex-shrink-0" />
    </button>
  );
}
