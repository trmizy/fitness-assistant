/**
 * ingestEvidence.ts
 * ──────────────────
 * Ingests external research evidence into a dedicated Qdrant collection.
 *
 * Collection: fitness_evidence
 * Sources:
 *   - data/processed/evidence/*.jsonl  (ESPEN, ISSN, HHS, WHO papers)
 *   - data/processed/nhanes/merged_2017.jsonl  (body composition norms summary)
 *
 * Design decisions:
 *   - Uses UPSERT (not delete+recreate) so existing data is preserved.
 *   - Stable string IDs derived from chunk "id" field prevent duplicates.
 *   - Creates collection if not exists; never deletes existing collection.
 *   - NHANES rows ingested as aggregated summary statistics (not raw rows)
 *     to keep vector DB lean and semantically useful.
 *
 * Usage:
 *   npm run data:ingest
 *   npm run data:ingest -- --force          # re-embed all
 *   npm run data:ingest -- --nhanes         # include NHANES norms
 *   npm run data:ingest -- --collection=fitness_evidence
 */

import { QdrantClient } from "@qdrant/js-client-rest";
import axios from "axios";
import fs from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";

// ── Config ────────────────────────────────────────────────────────────────────

const QDRANT_HOST = process.env.QDRANT_HOST || "localhost";
const QDRANT_PORT = process.env.QDRANT_PORT || "6333";
const LLM_BASE_URL = process.env.LLM_BASE_URL || "http://localhost:11434";
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || "nomic-embed-text";
const COLLECTION = "fitness_evidence";
const VECTOR_SIZE = 768;
const BATCH_SIZE = 10;

const ROOT = path.resolve(process.cwd(), "..", "..", "..", "data");
const EVIDENCE = path.join(ROOT, "processed", "evidence");
const NHANES = path.join(ROOT, "processed", "nhanes");

const FORCE = process.argv.includes("--force");
const INCLUDE_NHANES = process.argv.includes("--nhanes");

const qdrant = new QdrantClient({
  url: `http://${QDRANT_HOST}:${QDRANT_PORT}`,
  checkCompatibility: false,
});

// ── Helpers ───────────────────────────────────────────────────────────────────

async function embed(text: string): Promise<number[]> {
  const r = await axios.post(
    `${LLM_BASE_URL}/api/embeddings`,
    {
      model: EMBEDDING_MODEL,
      prompt: text,
    },
    { timeout: 30000 },
  );
  if (!Array.isArray(r.data?.embedding) || r.data.embedding.length === 0) {
    throw new Error("Empty embedding returned");
  }
  return r.data.embedding;
}

/** Stable deterministic UUID v5-like ID from a string. */
function stableId(s: string): string {
  return createHash("sha256").update(s).digest("hex").slice(0, 32);
}

async function ensureCollection() {
  try {
    await qdrant.getCollection(COLLECTION);
    console.log(`  ✓ Collection '${COLLECTION}' already exists`);
  } catch {
    await qdrant.createCollection(COLLECTION, {
      vectors: { size: VECTOR_SIZE, distance: "Cosine" },
    });
    console.log(`  ✓ Created collection '${COLLECTION}'`);
  }
}

async function upsertBatch(
  points: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }>,
  _label: string,
) {
  // Qdrant upsert accepts string UUIDs — we use sha256 hex as stable IDs
  await qdrant.upsert(COLLECTION, {
    wait: true,
    points: points.map((p) => ({
      id: p.id, // Qdrant supports UUIDs and unsigned ints; use integer hash for stability
      vector: p.vector,
      payload: p.payload,
    })),
  });
  process.stdout.write(`.`);
}

// ── Evidence JSONL ingestion ───────────────────────────────────────────────────

interface EvidenceChunk {
  id: string;
  title: string;
  source_type: string;
  category: string;
  content: string;
  source_url?: string;
  evidence_level?: string;
  tags?: string[];
  chunk_index?: number;
  total_chunks?: number;
  extraction_method?: string;
}

async function ingestEvidenceJsonl(): Promise<{ ok: number; failed: number }> {
  if (!fs.existsSync(EVIDENCE)) {
    console.log("  ⚠  evidence/ dir not found — skipping");
    return { ok: 0, failed: 0 };
  }

  const files = fs.readdirSync(EVIDENCE).filter((f) => f.endsWith(".jsonl"));
  if (files.length === 0) {
    console.log("  ⚠  No .jsonl files in evidence/");
    return { ok: 0, failed: 0 };
  }

  let ok = 0,
    failed = 0;
  let batch: Array<{
    id: string;
    vector: number[];
    payload: Record<string, unknown>;
  }> = [];

  for (const file of files) {
    const lines = fs
      .readFileSync(path.join(EVIDENCE, file), "utf-8")
      .split("\n")
      .filter(Boolean);

    process.stdout.write(`  📄  ${file} (${lines.length} chunks) `);

    for (const line of lines) {
      let chunk: EvidenceChunk;
      try {
        chunk = JSON.parse(line);
      } catch {
        failed++;
        continue;
      }

      if (!chunk.content || chunk.content.length < 20) {
        failed++;
        continue;
      }

      const textForEmbed = [
        chunk.title,
        chunk.category,
        chunk.content,
        (chunk.tags ?? []).join(" "),
      ].join(" ");

      try {
        const vector = await embed(textForEmbed);
        const pointId = stableId(
          chunk.id || `${file}_${chunk.chunk_index ?? ok}`,
        );

        batch.push({
          id: pointId,
          vector,
          payload: {
            title: chunk.title,
            source_type: chunk.source_type || "curated_summary",
            category: chunk.category,
            content: chunk.content,
            source_url: chunk.source_url ?? null,
            evidence_level: chunk.evidence_level ?? "unknown",
            tags: chunk.tags ?? [],
            chunk_index: chunk.chunk_index ?? 0,
            total_chunks: chunk.total_chunks ?? 1,
            extraction_method: chunk.extraction_method ?? "knowledge_curated",
            created_from: "external_evidence_dataset",
            source_file: `data/processed/evidence/${file}`,
            chunk_id: chunk.id,
          },
        });

        if (batch.length >= BATCH_SIZE) {
          await upsertBatch(batch, file);
          batch = [];
        }
        ok++;
      } catch (err: any) {
        console.warn(
          `\n    ⚠  embed failed for chunk ${chunk.id}: ${err.message}`,
        );
        failed++;
      }
    }

    if (batch.length > 0) {
      await upsertBatch(batch, file);
      batch = [];
    }
    console.log(` ✅`);
  }

  return { ok, failed };
}

// ── NHANES norms — aggregate summary ingestion ──────────────────────────────

function computeNhanesNorms(): EvidenceChunk[] {
  const mergedPath = path.join(NHANES, "merged_2017.jsonl");
  if (!fs.existsSync(mergedPath)) return [];

  const lines = fs
    .readFileSync(mergedPath, "utf-8")
    .split("\n")
    .filter(Boolean);
  const rows = lines
    .map((l) => {
      try {
        return JSON.parse(l);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  if (rows.length === 0) return [];

  // Compute gender-stratified percentile summaries for weight, BMI, BF%
  const stats: Record<
    string,
    { weights: number[]; bmis: number[]; bfpcts: number[] }
  > = {
    M: { weights: [], bmis: [], bfpcts: [] },
    F: { weights: [], bmis: [], bfpcts: [] },
    all: { weights: [], bmis: [], bfpcts: [] },
  };

  for (const r of rows) {
    const gender = r.gender === "M" ? "M" : r.gender === "F" ? "F" : null;
    const weight = typeof r.weight_kg === "number" ? r.weight_kg : null;
    const bmi = typeof r.bmi === "number" ? r.bmi : null;
    const bfpct = typeof r.body_fat_pct === "number" ? r.body_fat_pct : null;

    if (gender && weight && weight > 20 && weight < 300)
      stats[gender].weights.push(weight);
    if (gender && bmi && bmi > 10 && bmi < 80) stats[gender].bmis.push(bmi);
    if (gender && bfpct && bfpct >= 0 && bfpct <= 70)
      stats[gender].bfpcts.push(bfpct);
    if (weight) stats.all.weights.push(weight);
    if (bmi) stats.all.bmis.push(bmi);
    if (bfpct) stats.all.bfpcts.push(bfpct);
  }

  function pct(arr: number[], p: number) {
    if (arr.length === 0) return null;
    const sorted = [...arr].sort((a, b) => a - b);
    const idx = Math.floor((p / 100) * sorted.length);
    return Math.round(sorted[Math.min(idx, sorted.length - 1)] * 10) / 10;
  }
  function mean(arr: number[]) {
    if (arr.length === 0) return null;
    return Math.round((arr.reduce((a, b) => a + b, 0) / arr.length) * 10) / 10;
  }

  const chunks: EvidenceChunk[] = [];

  // Weight / BMI norms
  for (const g of ["M", "F"] as const) {
    const label = g === "M" ? "Nam (Male)" : "Nữ (Female)";
    const w = stats[g].weights;
    const b = stats[g].bmis;
    if (w.length < 10) continue;

    chunks.push({
      id: `nhanes-norms-weight-bmi-${g.toLowerCase()}`,
      title: `NHANES 2017-18 Body Weight & BMI Norms — ${label}`,
      source_type: "dataset",
      category: "body_composition",
      evidence_level: "population_normative",
      source_url: "https://www.cdc.gov/nchs/nhanes/",
      tags: [
        "NHANES",
        "body weight",
        "BMI",
        "population norm",
        g === "M" ? "male" : "female",
      ],
      extraction_method: "aggregated_statistics",
      content: [
        `NHANES 2017-2018 US population body composition norms — ${label} (n=${w.length}):`,
        `Body Weight (kg): P10=${pct(w, 10)}, P25=${pct(w, 25)}, P50=${pct(w, 50)} (median), P75=${pct(w, 75)}, P90=${pct(w, 90)}, mean=${mean(w)}`,
        `BMI (kg/m²): P10=${pct(b, 10)}, P25=${pct(b, 25)}, P50=${pct(b, 50)}, P75=${pct(b, 75)}, P90=${pct(b, 90)}, mean=${mean(b)}`,
        `Interpretation: BMI 18.5–24.9 = normal weight, 25–29.9 = overweight, ≥30 = obese.`,
        `Note: BMI does not distinguish fat from muscle. Use in conjunction with body fat % and waist circumference.`,
        `Source: US CDC NHANES 2017-18 Body Measures (BMX_J). Public domain.`,
      ].join("\n"),
    });
  }

  // Body fat % norms
  for (const g of ["M", "F"] as const) {
    const label = g === "M" ? "Nam (Male)" : "Nữ (Female)";
    const bf = stats[g].bfpcts;
    if (bf.length < 10) continue;

    const essentialFat = g === "M" ? "2–5%" : "10–13%";
    const athleteFat = g === "M" ? "6–13%" : "14–20%";
    const fitnessFat = g === "M" ? "14–17%" : "21–24%";
    const averageFat = g === "M" ? "18–24%" : "25–31%";
    const obeseFat = g === "M" ? ">25%" : ">32%";

    chunks.push({
      id: `nhanes-norms-bodyfat-${g.toLowerCase()}`,
      title: `NHANES 2017-18 Body Fat % (DXA) Norms — ${label}`,
      source_type: "dataset",
      category: "body_composition",
      evidence_level: "population_normative",
      source_url: "https://www.cdc.gov/nchs/nhanes/",
      tags: [
        "NHANES",
        "body fat",
        "DXA",
        "body composition",
        g === "M" ? "male" : "female",
      ],
      extraction_method: "aggregated_statistics",
      content: [
        `NHANES 2017-18 US population body fat % by DXA — ${label} (n=${bf.length}):`,
        `Body Fat %: P10=${pct(bf, 10)}, P25=${pct(bf, 25)}, P50=${pct(bf, 50)} (median), P75=${pct(bf, 75)}, P90=${pct(bf, 90)}, mean=${mean(bf)}`,
        `Classification (${label}): Essential fat=${essentialFat} | Athlete=${athleteFat} | Fitness=${fitnessFat} | Average=${averageFat} | Obese=${obeseFat}`,
        `High body fat (>${g === "M" ? "25" : "32"}%) combined with low lean mass indicates greater health risk and is a priority for resistance training + caloric deficit.`,
        `Source: US CDC NHANES 2017-18 DXA Body Composition (DXX_J). Public domain.`,
      ].join("\n"),
    });
  }

  return chunks;
}

async function ingestNhanesNorms(): Promise<{ ok: number; failed: number }> {
  const norms = computeNhanesNorms();
  if (norms.length === 0) {
    console.log(
      "  ⚠  No NHANES norms computed (merged_2017.jsonl missing or empty)",
    );
    return { ok: 0, failed: 0 };
  }

  let ok = 0,
    failed = 0;
  process.stdout.write(
    `  📊  NHANES body comp norms (${norms.length} summary chunks) `,
  );

  for (const chunk of norms) {
    try {
      const vector = await embed(
        [chunk.title, chunk.content, (chunk.tags ?? []).join(" ")].join(" "),
      );
      const pointId = stableId(chunk.id);
      await qdrant.upsert(COLLECTION, {
        wait: true,
        points: [
          {
            id: pointId,
            vector,
            payload: {
              title: chunk.title,
              source_type: chunk.source_type,
              category: chunk.category,
              content: chunk.content,
              source_url: chunk.source_url,
              evidence_level: chunk.evidence_level,
              tags: chunk.tags ?? [],
              extraction_method: chunk.extraction_method,
              created_from: "external_evidence_dataset",
              source_file: "data/processed/nhanes/merged_2017.jsonl",
              chunk_id: chunk.id,
            },
          },
        ],
      });
      process.stdout.write(".");
      ok++;
    } catch (err: any) {
      console.warn(`\n    ⚠  ${chunk.id}: ${err.message}`);
      failed++;
    }
  }
  console.log(" ✅");
  return { ok, failed };
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log("🧬  Evidence Ingest → Qdrant fitness_evidence collection");
  console.log(`    Qdrant: http://${QDRANT_HOST}:${QDRANT_PORT}`);
  console.log(`    Embed:  ${LLM_BASE_URL} / ${EMBEDDING_MODEL}`);
  console.log(`    Force:  ${FORCE} | NHANES norms: ${INCLUDE_NHANES}`);
  console.log("");

  // Test Qdrant connectivity
  try {
    await (qdrant as any).api("GET", "/healthz");
    console.log("  ✅  Qdrant connection OK");
  } catch {
    try {
      await qdrant.getCollections();
      console.log("  ✅  Qdrant connection OK");
    } catch (err: any) {
      console.error(
        `  ❌  Cannot connect to Qdrant at http://${QDRANT_HOST}:${QDRANT_PORT}: ${err.message}`,
      );
      process.exit(1);
    }
  }

  // Test embedding service
  try {
    await embed("test");
    console.log(`  ✅  Embedding service OK (${EMBEDDING_MODEL})`);
  } catch (err: any) {
    console.error(`  ❌  Embedding service unavailable: ${err.message}`);
    console.error(
      "    Start Ollama: ollama serve && ollama pull nomic-embed-text",
    );
    process.exit(1);
  }

  await ensureCollection();
  console.log("");

  // Ingest evidence JSONL
  const ev = await ingestEvidenceJsonl();

  // Optionally ingest NHANES norms
  let nh = { ok: 0, failed: 0 };
  if (INCLUDE_NHANES) {
    nh = await ingestNhanesNorms();
  }

  console.log("");
  console.log(`✅  Ingest complete:`);
  console.log(`    Evidence chunks: ${ev.ok} ok / ${ev.failed} failed`);
  if (INCLUDE_NHANES)
    console.log(`    NHANES norms:    ${nh.ok} ok / ${nh.failed} failed`);
  console.log(`    Collection: ${COLLECTION}`);

  if (ev.failed + nh.failed > 0) {
    console.warn(
      `⚠   ${ev.failed + nh.failed} items failed — check embedding service`,
    );
    process.exit(1);
  }
}

main().catch((err) => {
  console.error("❌  Fatal:", err.message);
  process.exit(1);
});
