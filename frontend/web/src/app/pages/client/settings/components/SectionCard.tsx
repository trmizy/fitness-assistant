import type { ReactNode } from "react";
import type { Icon as LucideIcon } from "@phosphor-icons/react";

/**
 * Settings Center — one collapsible-free content card per settings section
 * (Account, Appearance, Units, ...). Deliberately not an accordion: on a
 * 390px viewport a vertical stack of clearly-headed cards scrolls fine and
 * needs no extra tap-to-expand step (spec §28's "no desktop-only hover
 * dependency" — an accordion needing state for 11 sections adds
 * interaction cost for no real benefit).
 */
export function SectionCard({
  id,
  icon: Icon,
  iconColor = "text-emerald-400",
  iconBg = "bg-emerald-500/10 border-emerald-500/20",
  title,
  description,
  children,
}: {
  id: string;
  icon: LucideIcon;
  iconColor?: string;
  iconBg?: string;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      data-testid={`settings-section-${id}`}
      className="bg-zinc-900 border border-zinc-800/60 rounded-xl p-4 md:p-5 scroll-mt-20"
    >
      <div className="flex items-start gap-3 mb-4">
        <div
          className={`w-9 h-9 rounded-xl border flex items-center justify-center flex-shrink-0 ${iconBg}`}
        >
          <Icon className={`w-4.5 h-4.5 ${iconColor}`} />
        </div>
        <div className="min-w-0">
          <h2 className="text-sm font-bold text-zinc-100">{title}</h2>
          {description && (
            <p className="text-xs text-zinc-500 mt-0.5">{description}</p>
          )}
        </div>
      </div>
      <div className="space-y-3">{children}</div>
    </section>
  );
}
