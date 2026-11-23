import { useEffect, useId, useState, type ReactNode } from "react";
import { motion, useReducedMotion } from "motion/react";
import { onTablistKeyDown, tabProps } from "../pages/admin/shared/tablistKeys";
import { isWebPresentation } from "../utils/webPresentation";

// WEB UI prototype: on the web the bar takes the shared content-tab look (underline indicator, gw tokens) so every
// Level-3 tab bar in the app reads the same; semantics/ids/test ids unchanged. The packaged app keeps the green pills.
const WEB_UI = isWebPresentation();

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
  const baseId = useId();
  const reduceMotion = useReducedMotion();

  // React Router can reuse the same page component when a legacy alias changes
  // (for example /contracts -> /booking). Keep the selected tab aligned with
  // that route instead of retaining stale local state from the previous URL.
  useEffect(() => {
    if (defaultTab) setActive(defaultTab);
  }, [defaultTab]);

  return (
    <div className="flex flex-col h-full">
      <div role="tablist" aria-label="Chuyển mục" onKeyDown={onTablistKeyDown} className={WEB_UI ? "gw-tabs flex-none mx-4 md:mx-6 mt-4" : "flex-none flex gap-2 overflow-x-auto g-scroll-x px-4 md:px-6 pt-4 pb-2"}>
        {tabs.map((t) => (
          <button
            key={t.value}
            type="button"
            id={`${baseId}-tab-${t.value}`}
            aria-controls={`${baseId}-panel`}
            {...tabProps(activeTab?.value === t.value)}
            data-testid={`page-tab-${t.value}`}
            onClick={() => setActive(t.value)}
            className={WEB_UI ? "gw-tab inline-flex items-center gap-1.5" : `relative inline-flex min-h-10 items-center gap-1.5 px-3.5 py-2 rounded-full text-xs font-semibold whitespace-nowrap transition-colors duration-150 border ${
              active === t.value
                ? "text-black border-transparent"
                : "bg-zinc-900 border-zinc-700/60 text-zinc-400 hover:border-green-500/40"
            }`}
          >
            {/* Frontend 2.0: one green pill slides to the chosen tab (same colour as before). */}
            {active === t.value && (
              <motion.span
                layoutId={`tab-pill-${baseId}`}
                aria-hidden
                className={WEB_UI ? "gw-tab-bar" : "absolute inset-0 rounded-full bg-green-500"}
                transition={reduceMotion ? { duration: 0 } : { type: "spring", stiffness: 520, damping: 44, mass: 0.9 }}
              />
            )}
            {t.icon && <t.icon className="relative h-3.5 w-3.5" aria-hidden="true" />}
            <span className="relative">{t.label}</span>
          </button>
        ))}
      </div>
      <div className="flex-1 min-h-0" role="tabpanel" id={`${baseId}-panel`} aria-labelledby={activeTab ? `${baseId}-tab-${activeTab.value}` : undefined}>
        {/* Panel swap: short fade + 4px rise, no exit wait (the new tab never waits on the old one). */}
        <motion.div
          key={activeTab?.value}
          className="h-full"
          initial={reduceMotion ? false : { opacity: 0, y: 4 }}
          animate={{ opacity: 1, y: 0 }}
          transition={{ duration: reduceMotion ? 0 : 0.18, ease: [0.22, 0.61, 0.36, 1] }}
        >
          {activeTab?.content}
        </motion.div>
      </div>
    </div>
  );
}
