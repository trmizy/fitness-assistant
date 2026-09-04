import fs from "fs";
import path from "path";
import dotenv from "dotenv";
import { getQdrantClient } from "../repositories/qdrant";
import { llmService } from "../services/llm.service";
import { retrievalDocumentFromPayload } from "../llm/retriever";

dotenv.config();

type EvalCase = {
  expectedId: string;
  question: string;
};

type FailedQuery = {
  question: string;
  expectedId: string;
  topIds: string[];
  topScore: number | null;
};

const DEFAULT_DATASET = "data/eval/retrieval/ground-truth-retrieval.csv";
const DATASET_PATH = process.env.RAG_RETRIEVAL_EVAL_DATASET || DEFAULT_DATASET;
const COLLECTION = process.env.RAG_RETRIEVAL_EVAL_COLLECTION || "exercises";
const K = Number(
  process.env.RAG_RETRIEVAL_EVAL_K || process.env.RAG_TOP_K || "5",
);
const MAX_CASES = Number(process.env.RAG_RETRIEVAL_EVAL_LIMIT || "100");
const MIN_HIT_AT_K = Number(process.env.RAG_RETRIEVAL_EVAL_MIN_HIT || "0.8");
const MIN_MRR = Number(process.env.RAG_RETRIEVAL_EVAL_MIN_MRR || "0.5");

function parseCsvLine(line: string): string[] {
  const fields: string[] = [];
  let current = "";
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (char === "," && !inQuotes) {
      fields.push(current.trim());
      current = "";
    } else {
      current += char;
    }
  }

  fields.push(current.trim());
  return fields;
}

function resolveDatasetPath(filePath: string): string {
  const candidates = [
    path.resolve(process.cwd(), filePath),
    path.resolve(process.cwd(), "../../..", filePath),
    path.resolve(__dirname, "../../../..", filePath),
  ];
  const found = candidates.find((candidate) => fs.existsSync(candidate));
  if (!found) {
    throw new Error(
      `Cannot find retrieval eval dataset. Checked: ${candidates.join(", ")}`,
    );
  }
  return found;
}

function loadEvalCases(filePath: string): EvalCase[] {
  const resolved = resolveDatasetPath(filePath);
  const lines = fs
    .readFileSync(resolved, "utf8")
    .split(/\r?\n/)
    .filter((line) => line.trim());

  if (lines.length < 2) {
    throw new Error(`Retrieval eval dataset has no rows: ${resolved}`);
  }

  const header = parseCsvLine(lines[0]).map((item) => item.toLowerCase());
  const idIndex = header.indexOf("id");
  const questionIndex = header.findIndex(
    (item) =>
      item === "question" || item.includes("question") || item.includes("cau"),
  );

  if (idIndex < 0 || questionIndex < 0) {
    throw new Error(
      `Retrieval eval dataset must contain id and question columns: ${resolved}`,
    );
  }

  return lines
    .slice(1)
    .map(parseCsvLine)
    .map((parts) => ({
      expectedId: parts[idIndex],
      question: parts[questionIndex],
    }))
    .filter((item) => item.expectedId && item.question)
    .slice(0, MAX_CASES);
}

function normalizeExpectedDocId(
  collection: string,
  expectedId: string,
): string {
  return expectedId.startsWith(`${collection}_`)
    ? expectedId
    : `${collection}_${expectedId}`;
}

async function evaluateCase(testCase: EvalCase): Promise<{
  hit: boolean;
  reciprocalRank: number;
  topScore: number | null;
  failed?: FailedQuery;
}> {
  const vector = await llmService.generateEmbedding(testCase.question);
  const matches = await getQdrantClient().search(COLLECTION, {
    vector,
    limit: K,
    with_payload: true,
  });

  const docs = matches.map((match) =>
    retrievalDocumentFromPayload(
      COLLECTION,
      (match.payload || {}) as Record<string, unknown>,
      typeof match.score === "number" ? match.score : 0,
      String(match.id),
    ),
  );

  const expectedDocId = normalizeExpectedDocId(COLLECTION, testCase.expectedId);
  const rank = docs.findIndex((doc) => doc.id === expectedDocId);
  const hit = rank >= 0;
  const topScore = docs[0]?.score ?? null;

  return {
    hit,
    reciprocalRank: hit ? 1 / (rank + 1) : 0,
    topScore,
    failed: hit
      ? undefined
      : {
          question: testCase.question,
          expectedId: expectedDocId,
          topIds: docs.map((doc) => doc.id),
          topScore,
        },
  };
}

async function main(): Promise<void> {
  if (!Number.isFinite(K) || K <= 0) {
    throw new Error(`Invalid RAG_RETRIEVAL_EVAL_K: ${K}`);
  }
  if (!Number.isFinite(MIN_HIT_AT_K) || MIN_HIT_AT_K < 0 || MIN_HIT_AT_K > 1) {
    throw new Error(`Invalid RAG_RETRIEVAL_EVAL_MIN_HIT: ${MIN_HIT_AT_K}`);
  }
  if (!Number.isFinite(MIN_MRR) || MIN_MRR < 0 || MIN_MRR > 1) {
    throw new Error(`Invalid RAG_RETRIEVAL_EVAL_MIN_MRR: ${MIN_MRR}`);
  }

  const llmHealth = await llmService.getHealthStatus();
  if (!llmHealth.llmAvailable) {
    throw new Error(
      `LLM unavailable for retrieval eval: ${llmHealth.error || "missing model or provider unreachable"} (${llmHealth.llmUrl})`,
    );
  }

  try {
    await getQdrantClient().getCollection(COLLECTION);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    throw new Error(
      `Qdrant collection unavailable for retrieval eval: ${COLLECTION}. ${message}`,
    );
  }

  const cases = loadEvalCases(DATASET_PATH);
  if (cases.length === 0) {
    throw new Error("No retrieval eval cases loaded.");
  }

  const results = [];
  for (const testCase of cases) {
    results.push(await evaluateCase(testCase));
  }

  const hits = results.filter((result) => result.hit).length;
  const failed = results
    .map((result) => result.failed)
    .filter((item): item is FailedQuery => Boolean(item));
  const averageRetrievalScore =
    results.reduce((sum, result) => sum + (result.topScore ?? 0), 0) /
    results.length;
  const mrr =
    results.reduce((sum, result) => sum + result.reciprocalRank, 0) /
    results.length;
  const hitAtK = hits / results.length;
  const passed = hitAtK >= MIN_HIT_AT_K && mrr >= MIN_MRR;

  console.log(
    JSON.stringify(
      {
        status: passed ? "PASS" : "FAIL",
        dataset: DATASET_PATH,
        collection: COLLECTION,
        cases: results.length,
        k: K,
        thresholds: {
          minHitAtK: MIN_HIT_AT_K,
          minMrr: MIN_MRR,
        },
        hitAtK,
        recallAtK: hitAtK,
        mrr,
        averageRetrievalScore,
        failedQueries: failed.slice(0, 20),
      },
      null,
      2,
    ),
  );

  if (!passed) process.exitCode = 1;
}

main().catch((err) => {
  console.error("FAIL ai:eval:retrieval");
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
