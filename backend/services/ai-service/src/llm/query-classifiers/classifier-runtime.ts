/**
 * Phase 4.7R5 — shared runtime for the two small query ROUTERS (personal-safety, programming-domain).
 *
 * Routers only: they output a routing bucket, never a diagnosis, prescription, scientific claim, source choice or state change.
 * Inference is pure TypeScript over a JSON artifact (weights / bias / Platt calibration / threshold). No pickle, no sklearn,
 * no LLM, no GPU. Any load / validation / inference failure yields `null` so callers fall back to the deterministic path.
 */
import fs from "node:fs";
import path from "node:path";
import crypto from "node:crypto";

/** accent-folded, lower-cased, alphanumeric-only token string (accented and unaccented typing map to the same features) */
export function foldQuery(s: string): string {
  return s.toLowerCase().normalize("NFD").replace(/[̀-ͯ]/g, "").replace(/đ/g, "d").replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export interface TfidfModel { vocab: Record<string, number>; idf: number[] }

/** word 1-2-grams + char 3-4-grams of padded words. With `model === null` returns raw term counts keyed by feature name (for df). */
export function tfidfFeatures(text: string, model: null): Map<string, number>;
export function tfidfFeatures(text: string, model: TfidfModel): Map<number, number>;
export function tfidfFeatures(text: string, model: TfidfModel | null): Map<string, number> | Map<number, number> {
  const words = foldQuery(text).split(" ").filter(Boolean);
  const counts = new Map<string, number>();
  const add = (f: string) => counts.set(f, (counts.get(f) ?? 0) + 1);
  for (let i = 0; i < words.length; i++) {
    add("w:" + words[i]);
    if (i + 1 < words.length) add("b:" + words[i] + "_" + words[i + 1]);
    const padded = ` ${words[i]} `;
    for (const n of [3, 4]) for (let j = 0; j + n <= padded.length; j++) add("c:" + padded.slice(j, j + n));
  }
  if (!model) return counts;
  const out = new Map<number, number>();
  let norm = 0;
  for (const [f, c] of counts) {
    const idx = model.vocab[f];
    if (idx === undefined) continue;
    const v = (1 + Math.log(c)) * model.idf[idx];
    out.set(idx, v); norm += v * v;
  }
  norm = Math.sqrt(norm) || 1;
  for (const [i, v] of out) out.set(i, v / norm);
  return out;
}

export interface RouterArtifact {
  version: string;
  task: string;
  featureType: "embedding" | "tfidf";
  classes: { positive: string; negative: string };
  dimensions: number;
  bias: number;
  weights: number[];
  calibration: { type: "platt"; a: number; c: number };
  threshold: number;
  datasetHash: string;
  splitManifestHash: string;
  trainConfigHash: string;
  embeddingModel?: string;
  vocab?: Record<string, number>;
  idf?: number[];
}

export interface LoadedRouter {
  artifact: RouterArtifact;
  /** sha256 of the artifact file bytes (reported in telemetry-free diagnostics / freeze records) */
  fileHash: string;
  needsEmbedding: boolean;
}

const cache = new Map<string, LoadedRouter | null>();

export function validateArtifact(a: any, task: string): a is RouterArtifact {
  return !!a && typeof a === "object" && a.task === task && typeof a.version === "string" && (a.featureType === "embedding" || a.featureType === "tfidf")
    && Array.isArray(a.weights) && a.weights.length === a.dimensions && Number.isFinite(a.bias)
    && a.calibration?.type === "platt" && Number.isFinite(a.calibration.a) && Number.isFinite(a.calibration.c)
    && Number.isFinite(a.threshold) && a.threshold > 0 && a.threshold < 1
    && typeof a.datasetHash === "string" && typeof a.trainConfigHash === "string"
    && (a.featureType === "embedding" ? typeof a.embeddingModel === "string" : !!a.vocab && Array.isArray(a.idf) && a.idf.length === a.dimensions);
}

export function loadRouter(task: string, file: string, dir = path.join(__dirname, "artifacts")): LoadedRouter | null {
  const key = path.join(dir, file);
  if (cache.has(key)) return cache.get(key)!;
  let loaded: LoadedRouter | null = null;
  try {
    const raw = fs.readFileSync(key);
    const a = JSON.parse(raw.toString("utf8"));
    if (validateArtifact(a, task)) loaded = { artifact: a, fileHash: crypto.createHash("sha256").update(raw).digest("hex"), needsEmbedding: a.featureType === "embedding" };
  } catch { loaded = null; }
  cache.set(key, loaded);
  return loaded;
}
export function resetRouterCacheForTests(): void { cache.clear(); }

export type ScoreBucket = "very_low" | "low" | "mid" | "high" | "very_high";
export const bucketOf = (p: number): ScoreBucket => (p < 0.1 ? "very_low" : p < 0.35 ? "low" : p < 0.65 ? "mid" : p < 0.9 ? "high" : "very_high");

export interface RouterScore { probability: number; positive: boolean; bucket: ScoreBucket }

/**
 * Score one query. `embedding` is required (and must have the trained dimensionality) only for embedding-feature artifacts;
 * a missing / wrong-sized embedding returns null (caller falls back) rather than guessing.
 */
export function scoreRouter(r: LoadedRouter, text: string, embedding?: number[] | null): RouterScore | null {
  try {
    const a = r.artifact;
    let z = a.bias;
    if (a.featureType === "embedding") {
      if (!embedding || embedding.length !== a.dimensions) return null;
      let n = 0; for (const x of embedding) n += x * x;
      n = Math.sqrt(n) || 1;
      for (let i = 0; i < embedding.length; i++) z += a.weights[i] * (embedding[i] / n);
    } else {
      const f = tfidfFeatures(text, { vocab: a.vocab!, idf: a.idf! });
      for (const [i, v] of f) z += a.weights[i] * v;
    }
    const p = 1 / (1 + Math.exp(-(a.calibration.a * z + a.calibration.c)));
    if (!Number.isFinite(p)) return null;
    return { probability: p, positive: p >= a.threshold, bucket: bucketOf(p) };
  } catch { return null; }
}

/** privacy-safe telemetry record: no raw text, no raw score */
export interface RouterTelemetry {
  classifierName: string;
  invoked: boolean;
  decision: string;
  scoreBucket: ScoreBucket | null;
  fallbackUsed: boolean;
  latencyMs: number;
}
