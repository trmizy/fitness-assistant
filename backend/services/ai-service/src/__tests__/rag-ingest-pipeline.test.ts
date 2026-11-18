/**
 * M9.6-T5 — local RAG ingest pipeline. TEST FIXTURE / CODE AUDIT of the local source files: no AWS, no Bedrock / Cohere, no OpenSearch, no network. The vector store and the embedder are
 * in-memory fakes; the real data files are read (they are part of the repo).
 * Covers: CSV / JSONL validation, argument parsing, stable ids, the demo selection (counts, exclusions, provenance rule), duplicate detection, manifest content, --dry-run purity,
 * idempotent re-ingest, --check-empty, --canary, the --yes guard, corpus export / tamper detection, and the OpenSearch mapping profiles + countDocuments.
 * Run: FITNESS_DISABLE_REDIS=true npx tsx --test src/__tests__/rag-ingest-pipeline.test.ts
 */
import test from "node:test";
import assert from "node:assert/strict";
import * as fs from "node:fs";
import * as os from "node:os";
import * as path from "node:path";
import { execFileSync } from "node:child_process";
import {
  DEMO_QUOTAS, INDEX_OF, LOADERS, estimateTokens, parseCsv, resolveDataRoot, selectDocs, sha256, stableId, type IngestDoc,
} from "../datasets/seed/rag-ingest-core";
import { DEFAULT_EMBED_PRICE_PER_1K_USD, parseIngestArgs, readCorpusFile, runIngest, type IngestStore } from "../datasets/seed/rag-ingest-runner";
import { OpenSearchVectorStore, buildOpenSearchIndexBody, resolveOpenSearchIndexProfile } from "../vector-store/opensearch-vector-store";

const ROOT = resolveDataRoot(__dirname);
const silent = () => undefined;
const DIM = 1024;
const fakeVector = (text: string): number[] => { const h = sha256(text); return Array.from({ length: DIM }, (_, i) => (parseInt(h[i % 64], 16) - 7.5) / 8); };
const fakeEmbed = async (texts: string[]) => texts.map(fakeVector);
function fakeStore() {
  const indexes = new Map<string, Map<string, { vector: number[]; payload: Record<string, unknown> }>>(); const calls = { ensure: 0, upsert: 0, status: 0, embed: 0 };
  const store: IngestStore = {
    provider: "fake",
    async ensureIndex(index) { calls.ensure++; if (!indexes.has(index)) indexes.set(index, new Map()); return { size: DIM, created: true }; },
    async upsert(index, points) { calls.upsert++; const m = indexes.get(index)!; for (const p of points) m.set(p.id, { vector: p.vector, payload: p.payload }); },
    async getIndexStatus(index) { calls.status++; return indexes.has(index) ? { kind: "ok" as const } : { kind: "missing" as const }; },
    async countDocuments(index) { return indexes.has(index) ? indexes.get(index)!.size : null; },
    async search(index, { vector }) { const cos = (a: number[], b: number[]) => { let d = 0, na = 0, nb = 0; for (let i = 0; i < a.length; i++) { d += a[i] * b[i]; na += a[i] * a[i]; nb += b[i] * b[i]; } return d / Math.sqrt(na * nb); }; return [...(indexes.get(index) ?? new Map()).entries()].map(([id, v]) => ({ id, similarity: cos(vector, v.vector) })).sort((a, b) => b.similarity - a.similarity).slice(0, 1); },
  };
  return { store, indexes, calls };
}
const counting = (calls: { embed: number }) => async (texts: string[]) => { calls.embed++; return fakeEmbed(texts); };

// ── CSV / JSONL validation ──────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RAG-1 parseCsv is RFC 4180: quoted commas, doubled quotes, quoted NEWLINES, CRLF and a BOM", () => {
  const rows = parseCsv('﻿a,b,c\r\n1,"x, y","he said ""hi"""\r\n2,"line1\nline2",z\r\n');
  assert.deepEqual(rows, [["a", "b", "c"], ["1", "x, y", 'he said "hi"'], ["2", "line1\nline2", "z"]]);
});
test("RAG-2 the real source files validate: record counts match the audit, no missing keys, no duplicate keys, no malformed evidence line", () => {
  const ex = LOADERS.exercises(ROOT), kn = LOADERS.knowledge(ROOT), fq = LOADERS.faq(ROOT), ev = LOADERS.evidence(ROOT);
  assert.deepEqual([ex.docs.length, kn.docs.length, fq.docs.length, ev.docs.length], [207, 7072, 5946, 83]);
  for (const l of [ex, kn, fq, ev]) { assert.equal(l.excluded.duplicate_key ?? 0, 0, `${l.dataset}: duplicate keys`); assert.equal(l.excluded.unparsable_line ?? 0, 0); assert.equal(l.excluded.missing_key ?? 0, 0); assert.equal(new Set(l.docs.map((d) => d.id)).size, l.docs.length, `${l.dataset}: ids unique`); assert.match(l.sourceFileSha256, /^[0-9a-f]{64}$/); }
  assert.ok(fq.docs.every((d) => (d.payload as { source_group?: string }).source_group === "synthetic_knowledge"), "every FAQ row is declared synthetic in its own data");
});

// ── arguments ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RAG-3 argument parsing: defaults keep the legacy behaviour; canary / profile / limit / errors", () => {
  const legacy = parseIngestArgs([]); assert.deepEqual([legacy.profile, legacy.datasets, legacy.dryRun, legacy.canary, legacy.indexSuffix], ["full", ["exercises", "knowledge", "faq"], false, false, ""]);
  assert.deepEqual(parseIngestArgs(["--collection=fitness_knowledge"]).datasets, ["knowledge"]); assert.deepEqual(parseIngestArgs(["--dataset=evidence,exercises"]).datasets, ["evidence", "exercises"]);
  assert.deepEqual(parseIngestArgs(["--profile=demo"]).datasets, ["exercises", "knowledge", "faq", "evidence"]);
  const c = parseIngestArgs(["--canary", "--dataset=exercises"]); assert.deepEqual([c.profile, c.limit, c.indexSuffix], ["demo", 1, "_canary"]);
  assert.equal(parseIngestArgs(["--limit=5", "--dry-run", "--check-empty", "--manifest=m.json", "--yes"]).limit, 5);
  assert.equal(parseIngestArgs([]).embedPricePer1k, DEFAULT_EMBED_PRICE_PER_1K_USD);
  for (const bad of [["--limit=0"], ["--limit=x"], ["--nope"], ["--profile=other"], ["--dataset=bogus"], ["--canary"], ["--canary", "--dataset=exercises,knowledge"], ["--manifest"], ["--dry-run=1"], ["stray"], ["--embed-price-per-1k=-1"]]) assert.throws(() => parseIngestArgs(bad), Error, JSON.stringify(bad));
});

// ── stable ids ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RAG-4 stable ids: UUID-shaped, deterministic, per dataset, independent of order / limit / content", () => {
  assert.equal(stableId("exercises", "Squat"), stableId("exercises", "Squat")); assert.notEqual(stableId("exercises", "Squat"), stableId("knowledge", "Squat")); assert.notEqual(stableId("exercises", "Squat"), stableId("exercises", "squat"));
  assert.match(stableId("faq", "FAQ-1"), /^[0-9a-f]{8}-[0-9a-f]{4}-5[0-9a-f]{3}-a[0-9a-f]{3}-[0-9a-f]{12}$/);
  const a = LOADERS.exercises(ROOT).docs, b = LOADERS.exercises(ROOT).docs;
  assert.deepEqual(a.map((d) => d.id), b.map((d) => d.id), "two loads give the same ids");
  const reordered = [...a].reverse().map((d) => stableId("exercises", d.key)); assert.deepEqual(new Set(reordered), new Set(a.map((d) => d.id)));
  assert.ok(a.every((d) => d.id === stableId("exercises", d.key) && d.payload.id === d.id && d.payload.document_id === d.key), "payload carries the id and the source key");
});

// ── demo selection ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RAG-5 demo corpus: 100–200 documents; exercises 40, knowledge 50, evidence 74, FAQ 0; exclusions as specified", () => {
  const sel = (d: "exercises" | "knowledge" | "faq" | "evidence") => selectDocs(LOADERS[d](ROOT), "demo");
  const ex = sel("exercises"), kn = sel("knowledge"), fq = sel("faq"), ev = sel("evidence");
  assert.deepEqual([ex.docs.length, kn.docs.length, fq.docs.length, ev.docs.length], [40, 50, 0, 74]);
  const total = ex.docs.length + kn.docs.length + ev.docs.length; assert.ok(total >= 100 && total <= 200, `total ${total}`);
  assert.deepEqual(kn.docs.reduce<Record<string, number>>((a, d) => ((a[d.group] = (a[d.group] ?? 0) + 1), a), {}), DEMO_QUOTAS.knowledge, "knowledge quotas met exactly");
  for (const forbidden of ["faq", "health_guidance", "exercise", "workout_day"]) assert.ok(!kn.docs.some((d) => d.group === forbidden), `knowledge must not contain ${forbidden}`);
  assert.equal(kn.excluded["demo_excluded_doc_type:faq"], 5946, "the 5 946 duplicated synthetic FAQ rows are excluded from fitness_knowledge");
  assert.ok(ev.docs.every((d) => /^https?:\/\//.test(String((d.payload as { source_url?: unknown }).source_url))), "every evidence chunk cites a source URL");
  assert.equal(ev.excluded.no_source_url, 9, "the 9 chunks with no source are excluded");
  assert.equal(fq.excluded.demo_profile_excludes_synthetic_faq, 5946);
  const all = [...ex.docs, ...kn.docs, ...ev.docs]; assert.equal(new Set(all.map((d) => `${d.index}:${d.id}`)).size, all.length, "no duplicate id inside the demo corpus");
  for (const d of all) { assert.ok(d.text.trim().length >= 40, `${d.key}: text`); assert.ok(d.tokenEstimate > 0); }
  assert.equal(new Set(kn.docs.map((d) => sha256(String((d.payload as { contentVi?: string }).contentVi).toLowerCase().replace(/\s+/g, " ").trim()))).size, kn.docs.length, "no duplicate knowledge content");
  assert.deepEqual(sel("knowledge").docs.map((d) => d.id), kn.docs.map((d) => d.id), "the selection is deterministic");
});
test("RAG-6 provenance honesty: knowledge / faq payloads are labelled synthetic, evidence keeps its source and level, exercises are a catalogue", () => {
  const kn = selectDocs(LOADERS.knowledge(ROOT), "demo").docs, ev = selectDocs(LOADERS.evidence(ROOT), "demo").docs, ex = selectDocs(LOADERS.exercises(ROOT), "demo").docs;
  assert.ok(kn.every((d) => d.payload.source_type === "synthetic_domain_dataset" && !("evidence_level" in d.payload)), "synthetic knowledge is not given an evidence level");
  assert.ok(ex.every((d) => d.payload.source_type === "exercise_catalog"));
  assert.ok(ev.every((d) => d.payload.created_from === "external_evidence_dataset" && typeof d.payload.evidence_level === "string" && d.payload.source_file && d.payload.title && d.payload.content));
});
test("RAG-7 duplicate detection: a duplicated key / content in a synthetic source is reported, not silently written twice", () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rag-dup-")); fs.mkdirSync(path.join(tmp, "data/processed/rag"), { recursive: true });
  fs.writeFileSync(path.join(tmp, "data/processed/rag/exercises.csv"), "id,exercise_name,type_of_activity,type_of_equipment,body_part,type,muscle_groups_activated,instructions\n1,Squat,Strength,Barbell,Legs,Compound,Quads,\"Stand with the bar on your back, squat down and stand up again.\"\n2,squat,Strength,Barbell,Legs,Compound,Quads,\"Stand with the bar on your back, squat down and stand up again.\"\n3,Plank,Core,None,Core,Isometric,Abs,short\n4,,Core,None,Core,Isometric,Abs,\"Hold the position for thirty seconds with a straight back.\"\n");
  const l = LOADERS.exercises(tmp); assert.equal(l.docs.length, 1); assert.deepEqual(l.excluded, { duplicate_key: 1, missing_or_short_instructions: 1, missing_name: 1 });
});

// ── manifest ────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RAG-8 --dry-run: writes the manifest + corpus, never touches the store or the embedder; the manifest carries index, dataset, counts, ids, hashes, tokens, model and cost", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rag-man-")); const f = fakeStore(); const calls = { embed: 0 };
  const args = parseIngestArgs(["--dry-run", "--profile=demo", `--manifest=${path.join(tmp, "m.json")}`, `--export-corpus=${path.join(tmp, "c.jsonl")}`]);
  const r = await runIngest(args, { store: f.store, embed: counting(calls), log: silent, now: new Date("2026-11-17T00:00:00Z") });
  assert.deepEqual([f.calls.ensure, f.calls.upsert, f.calls.status, calls.embed, Object.keys(r.written).length], [0, 0, 0, 0, 0]);
  const m = JSON.parse(fs.readFileSync(path.join(tmp, "m.json"), "utf8"));
  assert.equal(m.schema, "gymini-rag-ingest-manifest/1"); assert.equal(m.totals.documents, 164); assert.equal(m.embedding.model, "cohere.embed-multilingual-v3"); assert.equal(m.embedding.dimension, 1024);
  assert.match(m.embedding.priceSource, /ASSUMPTION/); assert.match(m.tokenEstimateMethod, /NOT a Cohere tokenizer/);
  assert.deepEqual(m.indexes.map((i: { index: string; documents: number }) => [i.index, i.documents]), [["exercises", 40], ["fitness_knowledge", 50], ["fitness_faq", 0], ["fitness_evidence", 74]]);
  for (const i of m.indexes) { assert.equal(i.documentsDetail.length, i.documents); assert.ok(i.documentsDetail.every((d: { id: string; contentHash: string; tokenEstimate: number }) => /^[0-9a-f-]{36}$/.test(d.id) && /^[0-9a-f]{64}$/.test(d.contentHash) && d.tokenEstimate > 0)); assert.ok(i.selectionRule && i.sourceFile && /^[0-9a-f]{64}$/.test(i.sourceFileSha256)); }
  assert.equal(m.totals.tokenEstimate, m.indexes.reduce((a: number, i: { tokenEstimate: number }) => a + i.tokenEstimate, 0)); assert.ok(m.totals.estimatedEmbeddingCostUsd > 0 && m.totals.estimatedEmbeddingCostUsd < 0.01);
  assert.ok(m.provenanceNotes.some((n: string) => /SYNTHETIC/.test(n) && /NOT verified scientific evidence/.test(n)));
  assert.equal(fs.readFileSync(path.join(tmp, "c.jsonl"), "utf8").trim().split("\n").length, 164);
  assert.equal(estimateTokens("a".repeat(32)), 10);
});
test("RAG-9 the real CLI in --dry-run loads NO AWS / OpenSearch / Bedrock module (a require hook throws if one is loaded) and exits 0", () => {
  const hook = path.join(os.tmpdir(), `rag-hook-${process.pid}.cjs`);
  fs.writeFileSync(hook, "const M=require('module');const o=M._load;M._load=function(r,...a){if(/@aws-sdk|@opensearch-project|bedrock\\.client|opensearch-vector-store|qdrant/i.test(String(r)))throw new Error('FORBIDDEN LOAD: '+r);return o.call(this,r,...a)};");
  const out = execFileSync(process.execPath, ["--require", hook, "--import", "tsx", path.join(__dirname, "../ingest.ts"), "--dry-run", "--profile=demo"], { encoding: "utf8", env: { ...process.env, FITNESS_DISABLE_REDIS: "true" } });
  assert.match(out, /TOTAL 164 docs/); assert.match(out, /DRY RUN: nothing was embedded/);
});

// ── idempotent ingest, check-empty, canary, guards ──────────────────────────────────────────────────────────────────────────────────────
test("RAG-10 re-ingest is idempotent: the same stable ids overwrite — counts do not grow; a --limit run is a subset of the full run", async () => {
  const f = fakeStore(); const args = parseIngestArgs(["--profile=demo"]); const sizes = () => Object.fromEntries([...f.indexes].map(([k, v]) => [k, v.size]));
  await runIngest(args, { store: f.store, embed: fakeEmbed, log: silent }); const first = sizes(); const ids1 = new Map([...f.indexes].map(([k, v]) => [k, [...v.keys()].sort()]));
  await runIngest(args, { store: f.store, embed: fakeEmbed, log: silent }); assert.deepEqual(sizes(), first, "second run adds nothing");
  assert.deepEqual(first, { exercises: 40, fitness_knowledge: 50, fitness_evidence: 74 }); assert.ok(!f.indexes.has("fitness_faq"), "no FAQ index is even created in the demo profile");
  for (const [k, v] of f.indexes) assert.deepEqual([...v.keys()].sort(), ids1.get(k));
  const g = fakeStore(); await runIngest(parseIngestArgs(["--profile=demo", "--limit=5"]), { store: g.store, embed: fakeEmbed, log: silent });
  assert.deepEqual(Object.values(Object.fromEntries([...g.indexes].map(([k, v]) => [k, v.size]))), [5, 5, 5]);
  for (const [k, v] of g.indexes) for (const id of v.keys()) assert.ok(f.indexes.get(k)!.has(id), `limit run id ${id} is in the full run`);
  await runIngest(parseIngestArgs(["--profile=demo", "--limit=5"]), { store: g.store, embed: fakeEmbed, log: silent }); assert.deepEqual(Object.values(Object.fromEntries([...g.indexes].map(([k, v]) => [k, v.size]))), [5, 5, 5]);
});
test("RAG-11 a changed document keeps its id (overwritten, not duplicated) and gets a new content hash", () => {
  const mk = (instr: string) => { const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rag-chg-")); fs.mkdirSync(path.join(tmp, "data/processed/rag"), { recursive: true });
    fs.writeFileSync(path.join(tmp, "data/processed/rag/exercises.csv"), `id,exercise_name,type_of_activity,type_of_equipment,body_part,type,muscle_groups_activated,instructions
1,Squat,Strength,Barbell,Legs,Compound,Quads,"${instr}"
`); return LOADERS.exercises(tmp).docs[0]; };
  const v1 = mk("Stand with the bar on your back, squat down and stand up again."), v2 = mk("Stand with the bar on your back, squat to parallel and drive up through the heels.");
  assert.equal(v1.id, v2.id); assert.notEqual(v1.contentHash, v2.contentHash); assert.equal(v1.key, v2.key);
});
test("RAG-12 --check-empty: a populated index is skipped, an empty one is ingested, an index whose count is unknown is treated as populated", async () => {
  const f = fakeStore(); f.indexes.set("exercises", new Map([["x", { vector: [], payload: {} }]])); f.indexes.set("fitness_knowledge", new Map());
  const noCount = { ...f.store, countDocuments: undefined } as IngestStore; f.indexes.set("fitness_evidence", new Map());
  const r = await runIngest(parseIngestArgs(["--profile=demo", "--check-empty"]), { store: f.store, embed: fakeEmbed, log: silent });
  assert.match(r.skipped.exercises, /already holds 1 documents/); assert.equal(r.written.fitness_knowledge, 50); assert.equal(r.written.fitness_evidence, 74); assert.equal(f.indexes.get("exercises")!.size, 1, "the populated index was not touched");
  const g = fakeStore(); g.indexes.set("exercises", new Map()); const r2 = await runIngest(parseIngestArgs(["--profile=demo", "--check-empty", "--dataset=exercises"]), { store: { ...noCount, ensureIndex: g.store.ensureIndex, upsert: g.store.upsert, getIndexStatus: g.store.getIndexStatus }, embed: fakeEmbed, log: silent });
  assert.match(r2.skipped.exercises, /count unavailable/); assert.equal(g.indexes.get("exercises")!.size, 0);
});
test("RAG-13 --canary: ONE document of ONE dataset into <index>_canary; its id equals the demo manifest's id for that document", async () => {
  const f = fakeStore(); const calls = { embed: 0 };
  const r = await runIngest(parseIngestArgs(["--canary", "--dataset=exercises"]), { store: f.store, embed: counting(calls), log: silent });
  assert.deepEqual([...f.indexes.keys()], ["exercises_canary"]); assert.equal(f.indexes.get("exercises_canary")!.size, 1); assert.equal(calls.embed, 1); assert.equal(r.manifest.canary, true);
  const [canaryId] = [...f.indexes.get("exercises_canary")!.keys()]; const demo = selectDocs(LOADERS.exercises(ROOT), "demo").docs; assert.equal(canaryId, demo[0].id);
  const again = await runIngest(parseIngestArgs(["--canary", "--dataset=exercises"]), { store: f.store, embed: fakeEmbed, log: silent }); assert.equal(f.indexes.get("exercises_canary")!.size, 1, "re-running the canary is idempotent"); assert.ok(again.written.exercises_canary === 1);
});
test("RAG-14 --yes guard: a write that would call Bedrock / write to OpenSearch is refused without --yes, before any embedding or store call; --dry-run needs none", async () => {
  const f = fakeStore(); const calls = { embed: 0 };
  await assert.rejects(runIngest(parseIngestArgs(["--profile=demo"]), { store: f.store, embed: counting(calls), log: silent, requireConfirmation: true }), /Refusing to write/);
  assert.deepEqual([f.calls.ensure, f.calls.upsert, calls.embed], [0, 0, 0]);
  await runIngest(parseIngestArgs(["--profile=demo", "--dry-run"]), { requireConfirmation: true, log: silent });
  await runIngest(parseIngestArgs(["--profile=demo", "--yes", "--dataset=exercises", "--limit=2"]), { store: f.store, embed: fakeEmbed, log: silent, requireConfirmation: true }); assert.equal(f.indexes.get("exercises")!.size, 2);
  await assert.rejects(runIngest(parseIngestArgs(["--profile=demo", "--yes"]), { log: silent }), /needs a vector store and an embedder/);
});
test("RAG-15 an embedder that returns the wrong number of vectors or the wrong dimension is rejected before anything is written", async () => {
  const f = fakeStore();
  await assert.rejects(runIngest(parseIngestArgs(["--profile=demo", "--dataset=exercises", "--limit=3"]), { store: f.store, embed: async (t) => t.slice(1).map(fakeVector), log: silent }), /does not match/);
  await assert.rejects(runIngest(parseIngestArgs(["--profile=demo", "--dataset=exercises", "--limit=3"]), { store: f.store, embed: async (t) => t.map(() => [1, 2, 3]), log: silent }), /does not match/);
  assert.equal(f.calls.upsert, 0);
});
test("RAG-16 an exported corpus round-trips with its hashes and ingests to the same ids; a tampered corpus is refused", async () => {
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rag-corp-")); const p = path.join(tmp, "c.jsonl");
  await runIngest(parseIngestArgs(["--dry-run", "--profile=demo", `--export-corpus=${p}`]), { log: silent });
  const loaded = readCorpusFile(p); assert.equal(loaded.reduce((a, l) => a + l.docs.length, 0), 164);
  const f = fakeStore(); await runIngest(parseIngestArgs(["--profile=demo", `--corpus-file=${p}`]), { store: f.store, embed: fakeEmbed, log: silent });
  const g = fakeStore(); await runIngest(parseIngestArgs(["--profile=demo"]), { store: g.store, embed: fakeEmbed, log: silent });
  for (const [k, v] of g.indexes) assert.deepEqual([...f.indexes.get(k)!.keys()].sort(), [...v.keys()].sort(), `${k}: corpus-file and source ingest produce the same ids`);
  const lines = fs.readFileSync(p, "utf8").split("\n").filter(Boolean); const bad = JSON.parse(lines[0]) as IngestDoc; bad.text += " TAMPERED"; lines[0] = JSON.stringify(bad); fs.writeFileSync(p, lines.join("\n") + "\n");
  assert.throws(() => readCorpusFile(p), /content hash mismatch/);
});

// ── OpenSearch / NextGen mapping ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RAG-17 mapping profiles: classic (DEFAULT, unchanged) vs nextgen (documented form); both 1024-dim cosine HNSW, knn on, same metadata fields; invalid profile rejected", () => {
  const classic = buildOpenSearchIndexBody(1024) as any, next = buildOpenSearchIndexBody(1024, "nextgen") as any;
  assert.deepEqual(classic.mappings.properties.vector, { type: "knn_vector", dimension: 1024, method: { name: "hnsw", engine: "faiss", space_type: "cosinesimil" } });
  assert.deepEqual(next.mappings.properties.vector, { type: "knn_vector", dimension: 1024, space_type: "cosinesimil", method: { name: "hnsw" } });
  assert.equal(next.mappings.properties.vector.method.engine, undefined, "NextGen needs no engine");
  for (const b of [classic, next]) { assert.equal(b.settings.index.knn, true); assert.equal(b.mappings.properties.vector.dimension, 1024); assert.equal(b.mappings.properties.document_id.type, "keyword"); assert.equal(b.mappings.properties.source_url.type, "keyword"); }
  assert.deepEqual({ ...classic.mappings.properties, vector: 0 }, { ...next.mappings.properties, vector: 0 }, "only the vector field differs");
  assert.equal(resolveOpenSearchIndexProfile({} as NodeJS.ProcessEnv), "classic"); assert.equal(resolveOpenSearchIndexProfile({ OPENSEARCH_INDEX_PROFILE: "NextGen" } as NodeJS.ProcessEnv), "nextgen");
  assert.throws(() => resolveOpenSearchIndexProfile({ OPENSEARCH_INDEX_PROFILE: "x" } as NodeJS.ProcessEnv), /Unsupported OPENSEARCH_INDEX_PROFILE/);
  assert.deepEqual(INDEX_OF, { exercises: "exercises", knowledge: "fitness_knowledge", faq: "fitness_faq", evidence: "fitness_evidence" });
});
test("RAG-18 upsert sends the stable id as the OpenSearch _id (so a re-ingest replaces the document), refresh:false; countDocuments returns the count or null without throwing", async () => {
  const sent: any[] = []; const client = { bulk: async (r: any) => { sent.push(r); return { body: { errors: false } }; }, count: async ({ index }: any) => (index === "gone" ? Promise.reject(new Error("index_not_found")) : { body: { count: 7 } }) };
  const store = new OpenSearchVectorStore(client as any); const id = stableId("exercises", "Squat");
  await store.upsert("exercises", [{ id, vector: fakeVector("x"), payload: { exerciseName: "Squat" } }]);
  assert.deepEqual(sent[0].body[0], { index: { _index: "exercises", _id: id } }); assert.equal(sent[0].refresh, false); assert.equal(sent[0].body[1].id, id); assert.deepEqual(sent[0].body[1].payload, { exerciseName: "Squat" });
  assert.equal(await store.countDocuments("exercises"), 7); assert.equal(await store.countDocuments("gone"), null);
});

// ── temporary runner entry point ────────────────────────────────────────────────────────────────────────────────────────────────────────
test("RAG-19 the temp-runner Lambda handler: validates its event, runs the same dry-run from a prepared corpus (no data directory needed), returns counts only", async () => {
  const { handler } = await import("../ingest-lambda");
  const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "rag-lam-")); const corpus = path.join(tmp, "c.jsonl");
  await runIngest(parseIngestArgs(["--dry-run", "--profile=demo", `--export-corpus=${corpus}`]), { log: silent });
  const origLog = console.log; console.log = silent as typeof console.log;
  try {
    const out = await handler({ args: ["--dry-run", "--profile=demo", `--corpus-file=${corpus}`] }) as { totals: { documents: number }; indexes: Array<{ index: string; documents: number }>; written: Record<string, number> };
    assert.equal(out.totals.documents, 164); assert.deepEqual(out.written, {}); assert.deepEqual(out.indexes.map((i) => i.documents), [40, 50, 0, 74]);
    assert.ok(!JSON.stringify(out).includes("exerciseName") && !JSON.stringify(out).includes("contentVi"), "no document content in the response");
    await assert.rejects(handler({}), /event\.args must be an array/); await assert.rejects(handler({ args: [1] }), /event\.args must be an array/); await assert.rejects(handler({ args: ["--nope"] }), /Unknown flag/);
  } finally { console.log = origLog; }
});

test("RAG-20 --verify: after the writes it counts each index and finds each sampled document by its own vector (top hit = its stable id); a store that cannot find it is reported, not hidden", async () => {
  const f = fakeStore(); const r = await runIngest(parseIngestArgs(["--profile=demo", "--verify"]), { store: f.store, embed: fakeEmbed, log: silent, verifyWaitMs: 0 });
  assert.deepEqual(Object.keys(r.verified!), ["exercises", "fitness_knowledge", "fitness_evidence"]);
  for (const v of Object.values(r.verified!)) { assert.equal(v.ok, true); assert.equal(v.countMatches, true); assert.equal(v.samples.length, 3); assert.ok(v.samples.every((s) => s.ok && s.similarity! > 0.999)); }
  const broken = fakeStore(); const bad = { ...broken.store, async search() { return [{ id: "not-the-doc", similarity: 0.5 }]; } } as IngestStore;
  const r2 = await runIngest(parseIngestArgs(["--profile=demo", "--dataset=exercises", "--limit=3", "--verify"]), { store: { ...bad, ensureIndex: broken.store.ensureIndex, upsert: broken.store.upsert, countDocuments: broken.store.countDocuments }, embed: fakeEmbed, log: silent, verifyWaitMs: 0 });
  assert.equal(r2.verified!.exercises.ok, false); assert.equal(r2.verified!.exercises.samples[0].ok, false);
  const dry = await runIngest(parseIngestArgs(["--profile=demo", "--dry-run", "--verify"]), { log: silent }); assert.equal(dry.verified, undefined);
});
