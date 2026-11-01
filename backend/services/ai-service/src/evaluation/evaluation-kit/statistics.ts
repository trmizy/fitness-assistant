/** Pure arithmetic. Callers must establish label authority before reporting scientific metrics. */
export type Category = string | number | boolean | null;
export function cohensKappa(pairs: readonly (readonly [Category, Category])[], ordered?: readonly Category[]) {
  if (pairs.some((p) => p.length !== 2 || p.some((v) => v !== null && !["string", "boolean", "number"].includes(typeof v) || typeof v === "number" && !Number.isFinite(v)))) throw new Error("InvalidKappaInput");
  const usable = pairs.filter(([a, b]) => a !== null && b !== null && a !== "NOT_EVALUATED" && b !== "NOT_EVALUATED");
  const n = usable.length, agreement = n ? usable.filter(([a, b]) => a === b).length / n : null;
  if (!n) return { pairs: 0, excluded: pairs.length, agreement, kappa: null, reason: "NO_PAIRED_LABELS" };
  const key = (v: Category) => JSON.stringify(v);
  const categories = ordered ? [...ordered] : [...new Map(usable.flatMap((p) => p.map((v) => [key(v), v] as const))).values()];
  if (new Set(categories.map(key)).size !== categories.length || usable.some((p) => p.some((v) => !categories.includes(v)))) throw new Error("InvalidKappaCategories");
  const left = categories.map((c) => usable.filter(([a]) => a === c).length), right = categories.map((c) => usable.filter(([, b]) => b === c).length);
  const weight = (i: number, j: number) => ordered ? (categories.length < 2 ? 0 : ((i - j) / (categories.length - 1)) ** 2) : Number(i !== j);
  const observed = usable.reduce((s, [a, b]) => s + weight(categories.indexOf(a), categories.indexOf(b)), 0) / n;
  let expected = 0;
  for (let i = 0; i < categories.length; i++) for (let j = 0; j < categories.length; j++) expected += weight(i, j) * left[i] * right[j] / (n * n);
  return { pairs: n, excluded: pairs.length - n, agreement, kappa: expected === 0 ? null : 1 - observed / expected, reason: expected === 0 ? "DEGENERATE_MARGINALS" : null };
}
export type CaseCell = { caseKey: string; arm: string; policy: string; value: number | null };
function average(v: number[]) { return v.reduce((a, b) => a + b, 0) / v.length; }
function quantile(sorted: number[], q: number) { const x = (sorted.length - 1) * q, lo = Math.floor(x); return sorted[lo] + (sorted[Math.ceil(x)] - sorted[lo]) * (x - lo); }
export function pairedClusterBootstrap(cells: readonly CaseCell[], armA: string, armB: string, policy: string, options: { resamples?: number; samplerSeed?: number; confidence?: number } = {}) {
  const resamples = options.resamples ?? 10000, confidence = options.confidence ?? 0.95, samplerSeed = options.samplerSeed ?? 20261102;
  if (!Number.isInteger(resamples) || resamples < 100 || resamples > 1000000 || !(confidence > 0 && confidence < 1) || !Number.isInteger(samplerSeed) || samplerSeed < 0 || samplerSeed > 0xffffffff || armA === armB) throw new Error("InvalidBootstrapConfiguration");
  const selected = cells.filter((c) => c.policy === policy && (c.arm === armA || c.arm === armB));
  const keys = selected.map((c) => JSON.stringify([c.caseKey, c.arm]));
  if (new Set(keys).size !== keys.length || selected.some((c) => c.value !== null && !Number.isFinite(c.value))) throw new Error("CellsMustBeAggregatedByCaseArmPolicy");
  const cases = [...new Set(selected.map((c) => c.caseKey))].sort(), differences: number[] = [];
  for (const id of cases) {
    const a = selected.find((c) => c.caseKey === id && c.arm === armA)?.value, b = selected.find((c) => c.caseKey === id && c.arm === armB)?.value;
    if (a !== undefined && a !== null && b !== undefined && b !== null) differences.push(a - b);
  }
  const result = { cluster: "CASE", equalCaseWeight: true, policy, armA, armB, caseCount: differences.length, excludedUnpairedCases: cases.length - differences.length, estimate: differences.length ? average(differences) : null,
    confidence, interval: null as null | [number, number], method: "PAIRED_CASE_CLUSTER_PERCENTILE", resamples, samplerSeed, pValue: null, reason: null as null | string };
  if (differences.length < 2) return { ...result, reason: "INSUFFICIENT_CASE_CLUSTERS" };
  // Seed is only for the statistical resampler, never a provider/model seed.
  let state = samplerSeed >>> 0;
  const random = () => { state = (state + 0x6d2b79f5) >>> 0; let t = Math.imul(state ^ (state >>> 15), state | 1); t ^= t + Math.imul(t ^ (t >>> 7), t | 61); return ((t ^ (t >>> 14)) >>> 0) / 4294967296; };
  const sampled: number[] = [];
  for (let b = 0; b < resamples; b++) { let sum = 0; for (let i = 0; i < differences.length; i++) sum += differences[Math.floor(random() * differences.length)]; sampled.push(sum / differences.length); }
  sampled.sort((a, b) => a - b);
  if (sampled[0] === sampled.at(-1)) return { ...result, reason: "DEGENERATE_BOOTSTRAP_DISTRIBUTION" };
  result.interval = [quantile(sampled, (1 - confidence) / 2), quantile(sampled, (1 + confidence) / 2)]; return result;
}
