// Deterministic RNG utilities, non-secret structural checksum (v2.2 §4), and memory/time telemetry.
import { createHash } from "node:crypto";
import { makeHelpers, normalizeVi, rngFrom, sha256, slugify } from "../util.mjs";

export { makeHelpers, normalizeVi, rngFrom, sha256, slugify };

/** Recursively canonicalizes JSON keys so structural checksums are byte-stable. */
export function canonicalJson(value) {
  if (value === null || typeof value !== "object") return JSON.stringify(value);
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
  const keys = Object.keys(value).sort();
  return `{${keys.map((k) => `${JSON.stringify(k)}:${canonicalJson(value[k])}`).join(",")}}`;
}

/**
 * Deterministic SHA-256 structural checksum over planned entities.
 * Secret columns (password, tokens, ephemeral secrets) and wall-clock timestamps are NEVER included.
 */
export function computeStructuralChecksum(projection) {
  const hash = createHash("sha256");
  hash.update(canonicalJson(projection));
  return hash.digest("hex");
}

/** Captures per-phase wall-clock duration, rows/sec, and process.memoryUsage() RSS/Heap metrics. */
export class ScaleMetricsTracker {
  constructor(scaleFactor, namespace) {
    this.startedAt = Date.now();
    this.scaleFactor = scaleFactor;
    this.namespace = namespace;
    this.phases = [];
    this.peakRssBytes = process.memoryUsage().rss;
    this.peakHeapUsedBytes = process.memoryUsage().heapUsed;
    this.totals = { rowsWritten: 0, s3ObjectsCopied: 0, avatarsWritten: 0 };
  }

  sampleMemory() {
    const m = process.memoryUsage();
    if (m.rss > this.peakRssBytes) this.peakRssBytes = m.rss;
    if (m.heapUsed > this.peakHeapUsedBytes) this.peakHeapUsedBytes = m.heapUsed;
    return m;
  }

  async trackPhase(name, fn) {
    const t0 = process.hrtime.bigint();
    const memBefore = this.sampleMemory();
    const result = await fn();
    const memAfter = this.sampleMemory();
    const elapsedMs = Number(process.hrtime.bigint() - t0) / 1e6;
    const rows = typeof result?.rows === "number" ? result.rows : 0;
    this.totals.rowsWritten += rows;
    const entry = {
      name,
      elapsedMs: Math.round(elapsedMs),
      rows,
      rowsPerSec: elapsedMs > 0 && rows > 0 ? Math.round((rows * 1000) / elapsedMs) : 0,
      rssMbBefore: Number((memBefore.rss / 1048576).toFixed(1)),
      rssMbAfter: Number((memAfter.rss / 1048576).toFixed(1)),
      heapMbAfter: Number((memAfter.heapUsed / 1048576).toFixed(1)),
    };
    this.phases.push(entry);
    return { result, entry };
  }

  summary(extra = {}) {
    this.sampleMemory();
    return {
      scaleFactor: this.scaleFactor,
      namespace: this.namespace,
      totalElapsedMs: Date.now() - this.startedAt,
      peakRssBytes: this.peakRssBytes,
      peakRssMb: Number((this.peakRssBytes / 1048576).toFixed(1)),
      peakHeapUsedMb: Number((this.peakHeapUsedBytes / 1048576).toFixed(1)),
      totals: this.totals,
      phases: this.phases,
      ...extra,
    };
  }
}

