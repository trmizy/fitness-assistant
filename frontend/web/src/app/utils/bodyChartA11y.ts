/**
 * A11Y-4: the third-party `body-muscles` BodyChart always renders every muscle path as role="button" tabindex="0"
 * INSIDE an aria-hidden <svg> INSIDE a role="img" wrapper. In Gymini every chart is display-only (no
 * onMuscleClick anywhere), so keyboard users tabbed through dozens of "buttons" that screen readers could not
 * announce (axe: aria-hidden-focus + nested-interactive).
 *
 * Fix at our boundary, not in the library: once the chart is built/updated, make the paths non-interactive and
 * give the single role="img" an accessible name that says WHAT is highlighted. Call after every create/update
 * (a view change can rebuild the paths).
 */
export function makeBodyChartStatic(container: HTMLElement | null, label: string): void {
  if (!container) return;
  const img = container.querySelector<HTMLElement>('[role="img"]');
  if (img) img.setAttribute("aria-label", label);
  container.querySelectorAll<SVGElement>(".body-chart-muscle").forEach((p) => {
    p.removeAttribute("role");
    p.removeAttribute("tabindex");
    p.setAttribute("focusable", "false");
  });
}

/** "A, B và C" — short Vietnamese list for an accessible name; empty when nothing to say. */
export function listVi(items: Array<string | null | undefined>, max = 6): string {
  const xs = [...new Set(items.filter((s): s is string => !!s && s.trim().length > 0))];
  if (xs.length === 0) return "";
  const shown = xs.slice(0, max);
  const more = xs.length - shown.length;
  const head = shown.length > 1 ? `${shown.slice(0, -1).join(", ")} và ${shown[shown.length - 1]}` : shown[0];
  return more > 0 ? `${head} (và ${more} nhóm khác)` : head;
}
