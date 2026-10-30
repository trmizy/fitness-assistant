import type { KeyboardEvent } from "react";

/**
 * WAI-ARIA Tabs pattern for the admin `role="tablist"` strips (B10): Left/Right/Home/End move focus
 * to the neighbouring tab AND select it (automatic activation — the same `onClick` the mouse uses),
 * and only the selected tab sits in the Tab order (roving tabindex), so Tab leaves the strip.
 * Attach `onTablistKeyDown` to the element carrying `role="tablist"` and spread `tabProps(selected)`
 * on each tab button.
 */
/** Index of the tab a key moves to (wraps at both ends), or `null` when the key is not a tablist key. */
export function nextTabIndex(key: string, current: number, count: number): number | null {
  if (count <= 0 || current < 0 || current >= count) return null;
  if (key === "ArrowRight") return (current + 1) % count;
  if (key === "ArrowLeft") return (current - 1 + count) % count;
  if (key === "Home") return 0;
  if (key === "End") return count - 1;
  return null;
}

export function onTablistKeyDown(e: KeyboardEvent<HTMLElement>) {
  if (e.key !== "ArrowRight" && e.key !== "ArrowLeft" && e.key !== "Home" && e.key !== "End") return;
  const tabs = Array.from(e.currentTarget.querySelectorAll<HTMLElement>('[role="tab"]:not([disabled])'));
  const current = tabs.indexOf(document.activeElement as HTMLElement);
  const next = nextTabIndex(e.key, current, tabs.length);
  if (next === null) return;
  e.preventDefault();
  if (next === current) return;
  tabs[next].focus();
  tabs[next].click();
}

/** `role`, `aria-selected` and the roving `tabIndex` of one tab button. */
export function tabProps(selected: boolean) {
  return { role: "tab" as const, "aria-selected": selected, tabIndex: selected ? 0 : -1 };
}
