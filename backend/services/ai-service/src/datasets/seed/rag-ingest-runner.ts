/**
 * RAG ingest runner (M9.6-T5). Argument parsing + the ingest loop, with the vector store and the embedding function INJECTED, so it is fully testable offline and its `--dry-run` path
 * never imports (let alone calls) AWS, Bedrock, Cohere or OpenSearch: this file imports only rag-ingest-core and node. src/ingest.ts wires the real store / embedder lazily and only
 * when a non-dry run is requested.
 *
 *   --dataset=exercises,knowledge,faq,evidence | all   (legacy alias: --collection=<index name>)   default: demo → exercises,knowledge,evidence; full → exercises,knowledge,faq
 *   --profile=demo|full        demo = the small auditable demo corpus (see rag-ingest-core.ts); full = every valid record (the previous behaviour). Default full; --canary implies demo.
 *   --limit=N                  at most N documents PER DATASET (after selection, deterministic order)
 *   --dry-run                  parse, select, build the manifest; no store, no embedding, no AWS
 *   --check-empty              skip an index that already holds documents (an index whose count cannot be read is treated as populated: never risk a duplicate)
 *   --manifest=PATH            write the manifest JSON (also printed as a summary)
 *   --canary                   exactly ONE document of exactly ONE dataset, into `<index>_canary` (override with --index-suffix): proves mapping, stable id, upsert and read-after-write
 *   --index-suffix=SUFFIX      append to every index name
 *   --export-corpus=PATH       write the selected documents (id, key, text, payload, hashes — no vectors) as JSONL
 *   --corpus-file=PATH         ingest from a corpus exported earlier instead of reading the source files (reviewed, hash-checked input for the AWS window)
 *   --embed-price-per-1k=USD   override the assumed embedding price used for the cost estimate
 *   --verify                   after the writes: wait out NextGen's ~5 s read-after-write latency, count each index, and look up up to 3 ingested documents by their OWN vector — the top hit must be that
 *                              document's stable id (proves the document, the vector and the id round-trip). With --dry-run it is ignored.
 *   --ensure-empty-indexes     also create (mapping only, no documents) the index of a selected dataset that has no documents — e.g. fitness_faq in the demo profile, which V1 queries on every chat turn
 *   --yes                      required for any write against OpenSearch (the local Qdrant flow does not need it)
 */
import { createHash } from "node:crypto";
import * as fs from "node:fs";
import * as path from "node:path";
import {
  ALL_DATASETS, INDEX_OF, LEGACY_COLLECTION_TO_DATASET, LOADERS, buildManifest, resolveDataRoot, selectDocs, sha256,
  type DatasetName, type IngestDoc, type IngestManifest, type IngestProfile, type LoadedDataset, type SelectionResult,
} from "./rag-ingest-core";

export interface IngestArgs {
  datasets: DatasetName[]; profile: IngestProfile; limit?: number; dryRun: boolean; checkEmpty: boolean; manifestPath?: string; canary: boolean; indexSuffix: string;
  exportCorpusPath?: string; corpusFile?: string; embedPricePer1k: number; yes: boolean; verify: boolean; ensureEmptyIndexes: boolean;
}
/** Assumed Cohere Embed v3 list price, USD per 1 000 input tokens. NOT verified against the AWS Pricing API — it only sizes the estimate. */
export const DEFAULT_EMBED_PRICE_PER_1K_USD = 0.0001;

export function parseIngestArgs(argv: string[]): IngestArgs {
  const flags = new Map<string, string | true>();
  for (const a of argv) {
    if (!a.startsWith("--")) throw new Error(`Unexpected argument "${a}". Flags look like --name or --name=value.`);
    const eq = a.indexOf("="); flags.set(eq < 0 ? a.slice(2) : a.slice(2, eq), eq < 0 ? true : a.slice(eq + 1));
  }
  const KNOWN = new Set(["dataset", "collection", "profile", "limit", "dry-run", "check-empty", "manifest", "canary", "index-suffix", "export-corpus", "corpus-file", "embed-price-per-1k", "yes", "verify", "ensure-empty-indexes"]);
  for (const k of flags.keys()) if (!KNOWN.has(k)) throw new Error(`Unknown flag --${k}. Known: ${[...KNOWN].map((x) => `--${x}`).join(" ")}`);
  const str = (k: string): string | undefined => { const v = flags.get(k); if (v === undefined) return undefined; if (v === true) throw new Error(`--${k} needs a value (--${k}=...)`); return v; };
  const bool = (k: string): boolean => { const v = flags.get(k); if (v === undefined) return false; if (v !== true) throw new Error(`--${k} takes no value`); return true; };

  const canary = bool("canary");
  const profileRaw = str("profile") ?? (canary ? "demo" : "full");
  if (profileRaw !== "demo" && profileRaw !== "full") throw new Error(`--profile must be "demo" or "full", got "${profileRaw}"`);
  const profile = profileRaw as IngestProfile;

  const raw = str("dataset") ?? str("collection") ?? "all"; let datasets: DatasetName[];
  if (raw === "all") datasets = profile === "demo" ? ["exercises", "knowledge", "faq", "evidence"] : ["exercises", "knowledge", "faq"]; // full "all" stays the legacy three: evidence never was part of it
  else datasets = raw.split(",").map((n) => { const t = n.trim(); const d = (ALL_DATASETS as readonly string[]).includes(t) ? (t as DatasetName) : LEGACY_COLLECTION_TO_DATASET[t]; if (!d) throw new Error(`Unknown dataset "${t}". Use ${ALL_DATASETS.join(", ")} or all.`); return d; });
  datasets = [...new Set(datasets)];
  if (canary && datasets.length !== 1) throw new Error("--canary ingests exactly one document of exactly one dataset: pass --dataset=<one name>");

  let limit: number | undefined; const l = str("limit");
  if (l !== undefined) { limit = Number(l); if (!Number.isInteger(limit) || limit < 1) throw new Error(`--limit must be a positive integer, got "${l}"`); }
  if (canary) limit = 1;
  const price = str("embed-price-per-1k"); const embedPricePer1k = price === undefined ? DEFAULT_EMBED_PRICE_PER_1K_USD : Number(price);
  if (!Number.isFinite(embedPricePer1k) || embedPricePer1k < 0) throw new Error(`--embed-price-per-1k must be a non-negative number, got "${price}"`);
  return {
    datasets, profile, limit, dryRun: bool("dry-run"), checkEmpty: bool("check-empty"), manifestPath: str("manifest"), canary, indexSuffix: str("index-suffix") ?? (canary ? "_canary" : ""),
    exportCorpusPath: str("export-corpus"), corpusFile: str("corpus-file"), embedPricePer1k, yes: bool("yes"), verify: bool("verify"), ensureEmptyIndexes: bool("ensure-empty-indexes"),
  };
}

export interface IngestStore {
  readonly provider: string;
  ensureIndex(index: string, size?: number): Promise<{ size: number; created: boolean }>;
  upsert(index: string, points: Array<{ id: string; vector: number[]; payload: Record<string, unknown> }>): Promise<void>;
  getIndexStatus(index: string, size?: number): Promise<{ kind: string; pointsCount?: number }>;
  countDocuments?(index: string): Promise<number | null>;
  search?(index: string, args: { vector: number[]; limit: number }): Promise<Array<{ id: string; similarity: number }>>;
}
export interface RunDeps {
  store?: IngestStore; embed?: (texts: string[]) => Promise<number[][]>; log?: (line: string) => void; root?: string; now?: Date; batchSize?: number; dimension?: number;
  embeddingModel?: string; /** wait used by --verify before reading (NextGen refresh_interval is 5 s); tests pass 0 */ verifyWaitMs?: number; /** true when a write would touch OpenSearch (AWS) → `--yes` is required */ requireConfirmation?: boolean;
}
export interface IndexVerification { expected: number; count: number | null; countMatches: boolean | null; samples: Array<{ id: string; topHitId: string | null; similarity: number | null; ok: boolean }>; ok: boolean }
export interface RunResult { manifest: IngestManifest; written: Record<string, number>; skipped: Record<string, string>; exportedCorpus?: string; verified?: Record<string, IndexVerification> }

/** A corpus exported by --export-corpus, read back as loaded datasets (the file's own sha256 is the "source file" hash). */
export function readCorpusFile(file: string): LoadedDataset[] { return parseCorpusText(fs.readFileSync(file, "utf8"), path.basename(file)); }
/** Same as readCorpusFile for corpus text already in memory (the temp runner receives it in the invoke event). Every line's content hash is re-checked. */
export function parseCorpusText(raw: string, label: string): LoadedDataset[] {
  const file = label; const sha = createHash("sha256").update(raw).digest("hex"); const by = new Map<DatasetName, IngestDoc[]>();
  for (const line of raw.split("\n").filter(Boolean)) {
    const d = JSON.parse(line) as IngestDoc; if (!d.dataset || !d.id || !d.text || !d.payload) throw new Error(`${file}: malformed corpus line`);
    if (sha256(`${d.text}\u0000${JSON.stringify(Object.fromEntries(Object.entries(d.payload).filter(([k]) => !["id", "document_id", "corpus_dataset"].includes(k))))}`) !== d.contentHash) throw new Error(`${file}: content hash mismatch for ${d.key} (the corpus file was modified after export)`);
    const list = by.get(d.dataset) ?? []; list.push(d); by.set(d.dataset, list);
  }
  return [...by.entries()].map(([dataset, docs]) => ({ dataset, sourceFile: `prepared-corpus:${label}`, sourceFileSha256: sha, docs, excluded: {}, totalSourceRecords: docs.length }));
}

export async function runIngest(args: IngestArgs, deps: RunDeps = {}): Promise<RunResult> {
  const log = deps.log ?? ((l: string) => console.log(l)); const dimension = deps.dimension ?? 1024; const model = deps.embeddingModel ?? process.env.BEDROCK_EMBEDDING_MODEL ?? "cohere.embed-multilingual-v3";
  if (!args.dryRun && deps.requireConfirmation && !args.yes) throw new Error("Refusing to write: this run would write to OpenSearch (and call the embedding model). Re-run with --yes after reviewing the manifest (use --dry-run first).");
  if (!args.dryRun && (!deps.store || !deps.embed)) throw new Error("A non-dry run needs a vector store and an embedder.");

  const root = deps.root ?? (args.corpusFile ? "" : resolveDataRoot());
  const sources: LoadedDataset[] = args.corpusFile ? readCorpusFile(args.corpusFile) : args.datasets.map((d) => LOADERS[d](root));
  const plan: Array<{ loaded: LoadedDataset; selection: SelectionResult; docs: IngestDoc[] }> = [];
  for (const d of args.datasets) {
    const loaded = sources.find((s) => s.dataset === d) ?? { dataset: d, sourceFile: "(none)", sourceFileSha256: "", docs: [], excluded: {}, totalSourceRecords: 0 };
    const selection = args.corpusFile ? { docs: loaded.docs, excluded: {}, rule: `prepared corpus (${loaded.sourceFile}); not re-selected` } : selectDocs(loaded, args.profile);
    plan.push({ loaded, selection, docs: args.limit ? selection.docs.slice(0, args.limit) : selection.docs });
  }
  const manifest = buildManifest(plan, { profile: args.profile, limit: args.limit, canary: args.canary, indexSuffix: args.indexSuffix, embeddingModel: model, dimension, pricePer1kTokensUsd: args.embedPricePer1k, now: deps.now });
  for (const i of manifest.indexes) log(`  ${i.index.padEnd(30)} ${String(i.documents).padStart(6)} docs  ~${String(i.tokenEstimate).padStart(8)} tokens  ~$${i.estimatedEmbeddingCostUsd.toFixed(4)}  (source records: ${i.sourceRecords}; excluded: ${JSON.stringify(i.excluded)})`);
  log(`  TOTAL ${manifest.totals.documents} docs, ~${manifest.totals.tokenEstimate} tokens, ~$${manifest.totals.estimatedEmbeddingCostUsd.toFixed(4)} embedding (assumed price)`);
  if (args.manifestPath) { fs.mkdirSync(path.dirname(path.resolve(args.manifestPath)), { recursive: true }); fs.writeFileSync(args.manifestPath, JSON.stringify(manifest, null, 2)); log(`  manifest → ${args.manifestPath}`); }
  let exportedCorpus: string | undefined;
  if (args.exportCorpusPath) {
    fs.mkdirSync(path.dirname(path.resolve(args.exportCorpusPath)), { recursive: true });
    fs.writeFileSync(args.exportCorpusPath, plan.flatMap((p) => p.docs).map((d) => JSON.stringify(d)).join("\n") + "\n"); exportedCorpus = args.exportCorpusPath; log(`  corpus → ${args.exportCorpusPath}`);
  }
  const written: Record<string, number> = {}; const skipped: Record<string, string> = {};
  if (args.dryRun) { log("  DRY RUN: nothing was embedded, nothing was written, no AWS call was made."); return { manifest, written, skipped, exportedCorpus }; }

  const store = deps.store!; const embed = deps.embed!; const batchSize = deps.batchSize ?? 64;
  for (const { loaded, docs } of plan) {
    if (docs.length === 0) {
      if (args.ensureEmptyIndexes) { const empty = `${INDEX_OF[loaded.dataset]}${args.indexSuffix}`; const r = await store.ensureIndex(empty, dimension); written[empty] = 0; log(`  ${empty}: empty index ${r.created ? "created" : "already present"} (mapping only)`); }
      continue;
    }
    const index = `${docs[0].index}${args.indexSuffix}`;
    if (args.checkEmpty) {
      const status = await store.getIndexStatus(index, dimension).catch(() => ({ kind: "missing" as const, pointsCount: undefined }));
      if (status.kind === "ok") {
        const count = (await store.countDocuments?.(index)) ?? status.pointsCount ?? null;
        if (count === null || count > 0) { skipped[index] = count === null ? "index exists; document count unavailable — treated as populated (no duplicate risk taken)" : `already holds ${count} documents`; log(`  skip ${index}: ${skipped[index]}`); continue; }
      }
    }
    await store.ensureIndex(index, dimension);
    for (let i = 0; i < docs.length; i += batchSize) {
      const batch = docs.slice(i, i + batchSize); const vectors = await embed(batch.map((d) => d.text));
      if (vectors.length !== batch.length || vectors.some((v) => v.length !== dimension)) throw new Error(`embedding result does not match ${batch.length} texts × ${dimension} dimensions`);
      await store.upsert(index, batch.map((d, k) => ({ id: d.id, vector: vectors[k], payload: d.payload })));
      written[index] = (written[index] ?? 0) + batch.length; log(`  ${index}: ${written[index]}/${docs.length}`);
    }
  }
  let verified: Record<string, IndexVerification> | undefined;
  if (args.verify) {
    verified = {}; await new Promise((r) => setTimeout(r, deps.verifyWaitMs ?? 6000));
    for (const { docs } of plan) {
      if (docs.length === 0 || !written[`${docs[0].index}${args.indexSuffix}`]) continue;
      const index = `${docs[0].index}${args.indexSuffix}`; const count = (await store.countDocuments?.(index)) ?? null; const samples: IndexVerification["samples"] = [];
      for (const d of docs.slice(0, 3)) {
        const [vector] = await embed([d.text]); const hits = store.search ? await store.search(index, { vector, limit: 1 }) : [];
        samples.push({ id: d.id, topHitId: hits[0]?.id ?? null, similarity: hits[0]?.similarity ?? null, ok: hits[0]?.id === d.id });
      }
      const countMatches = count === null ? null : count === docs.length; verified[index] = { expected: docs.length, count, countMatches, samples, ok: countMatches !== false && samples.every((x) => x.ok) };
      log(`  verify ${index}: count ${count}/${docs.length}; self-lookup ${samples.filter((x) => x.ok).length}/${samples.length}`);
    }
  }
  return { manifest, written, skipped, exportedCorpus, verified };
}
