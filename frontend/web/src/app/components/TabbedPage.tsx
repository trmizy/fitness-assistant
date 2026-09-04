import { useEffect, useState, type ReactNode } from "react";

export interface TabbedPageTab {
  value: string;
  label: string;
  icon?: React.ElementType;
  content: ReactNode;
}

/**
 * Combines two or more previously-separate pages under one nav entry as
 * pill tabs. Each tab's page component is rendered as-is (unmounted when
 * inactive) — this only changes navigation grouping, not page internals.
 */
export function TabbedPage({
  tabs,
  defaultTab,
}: {
  tabs: TabbedPageTab[];
  defaultTab?: string;
}) {
  const [active, setActive] = useState(defaultTab ?? tabs[0]?.value);
  const activeTab = tabs.find((t) => t.value === active) ?? tabs[0];

  // React Router can reuse the same page component when a legacy alias changes
  // (for example /contracts -> /booking). Keep the selected tab aligned with
  // that route instead of retaining stale local state from the previous URL.
  useEffect(() => {
    if (defaultTab) setActive(defaultTab);
  }, [defaultTab]);

  return (
    <div className="flex flex-col h-full">
      <div className="flex-none flex gap-2 overflow-x-auto px-4 md:px-6 pt-4 pb-2">
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            data-testid={`page-tab-${t.value}`}
            onClick={() => setActive(t.value)}
            className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold whitespace-nowrap transition-all border ${
              active === t.value
                ? "bg-green-500 text-black border-green-500"
                : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40"
            }`}
          >
            {t.icon && <t.icon className="h-3.5 w-3.5" />}
            {t.label}
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0">
        {activeTab?.content}
      </div>
    </div>
  );
}
