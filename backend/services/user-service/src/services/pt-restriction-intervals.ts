/**
 * Pure interval maths for the time a PT restriction gives back (no database, no clock).
 *
 * WHY THIS EXISTS. Since the contract-scope slice one contract can be blocked by several episodes at once:
 * the PT's account-level suspension AND a restriction on that very contract, overlapping, lifted in
 * either order, or one raised into the other. Adding "lift − start" per episode would count the overlap
 * twice. The rule here is the owner's: a contract is extended by the LENGTH OF THE UNION of the
 * intervals during which it was actually blocked — each blocked instant is paid back once.
 *
 * All values are instants in epoch milliseconds (UTC); a span is the half-open [start, end).
 */

export interface Span {
  start: number;
  end: number;
}

/** Sorted, non-empty, non-overlapping spans (touching spans are merged). */
export function mergeSpans(spans: Span[]): Span[] {
  const sorted = spans.filter((s) => s.end > s.start).sort((a, b) => a.start - b.start || a.end - b.end);
  const out: Span[] = [];
  for (const s of sorted) {
    const last = out[out.length - 1];
    if (last && s.start <= last.end) last.end = Math.max(last.end, s.end);
    else out.push({ start: s.start, end: s.end });
  }
  return out;
}

/** Length of `span` that is NOT covered by any of `covered` (the part nobody has been paid for yet). */
export function uncoveredMs(span: Span, covered: Span[]): number {
  if (span.end <= span.start) return 0;
  let free = span.end - span.start;
  for (const c of mergeSpans(covered)) {
    const overlap = Math.min(span.end, c.end) - Math.max(span.start, c.start);
    if (overlap > 0) free -= overlap;
  }
  return Math.max(free, 0);
}

/**
 * How many milliseconds a contract's end date must have moved, in total, once `closed` (the closed
 * episodes that applied to it) are all given back.
 *
 *   · each span is clipped to start no earlier than the contract's activation (nothing before it ran);
 *   · overlapping/touching spans are merged — the union is what was blocked;
 *   · walking the merged spans in time order, a span only counts if the contract was still running
 *     when it began: its start must be before the end date as moved so far. A span that begins at or
 *     after that moment found the contract already finished its run; extending it would revive a
 *     contract that had ended (the single-episode rule of the first suspension slice, generalised).
 *
 * `originalEnd` is the end date WITHOUT any give-back (current end date − everything already granted).
 *
 * Worked example (days): activated 0, original end 30. Contract restriction [1, 11), account
 * restriction [5, 21) → union [1, 21) = 20 days → new end 50. Counting each episode on its own would
 * give 10 + 16 = 26.
 */
export function totalGiveBackMs(originalEnd: number, activation: number, closed: Span[]): number {
  const clipped = closed.map((s) => ({ start: Math.max(s.start, activation), end: s.end }));
  let end = originalEnd;
  for (const span of mergeSpans(clipped)) {
    if (span.start >= end) break; // the contract had already run out when this block began
    end += span.end - span.start;
  }
  return end - originalEnd;
}
