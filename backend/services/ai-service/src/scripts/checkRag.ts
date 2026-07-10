import dotenv from "dotenv";
import { getQdrantClient } from "../repositories/qdrant";

dotenv.config();

const COLLECTIONS = [
  "exercises",
  "fitness_knowledge",
  "fitness_faq",
  "fitness_evidence",
] as const;

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function readCount(value: unknown): number {
  const data = asRecord(value);
  const count = Number(
    data.points_count ?? data.vectors_count ?? data.indexed_vectors_count ?? 0,
  );
  return Number.isFinite(count) ? count : 0;
}

async function main(): Promise<void> {
  const qdrant = getQdrantClient();
  const results = [];

  for (const collection of COLLECTIONS) {
    try {
      const info = await qdrant.getCollection(collection);
      results.push({
        collection,
        exists: true,
        points: readCount(info),
      });
    } catch (err) {
      results.push({
        collection,
        exists: false,
        points: 0,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }

  const passed = results.every((item) => item.exists && item.points > 0);
  console.log(
    JSON.stringify(
      {
        status: passed ? "PASS" : "FAIL",
        collections: results,
        repairCommands: passed
          ? []
          : [
              "pnpm --filter @gym-coach/ai-service run ai:test:seed-rag",
              "pnpm --filter @gym-coach/ai-service run ai:reindex",
            ],
      },
      null,
      2,
    ),
  );

  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FAIL ai:check:rag");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
