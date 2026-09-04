import { logger } from "@gym-coach/shared";
import { llmService } from "../services/llm.service";
import { getQdrantClient } from "../repositories/qdrant";
import type { RetrievalDocument, RetrievalResult } from "./types";

// Chat may use semantic exercise data. AI Plan generation must not use the
// Qdrant exercises collection for exercise selection; it receives exercises
// only from fitness-service DB catalogs and may retrieve evidence only.
const CHAT_COLLECTIONS = [
  "exercises",
  "fitness_knowledge",
  "fitness_faq",
  "fitness_evidence",
] as const;
const PLAN_EVIDENCE_COLLECTIONS = ["fitness_evidence"] as const;
export const RETRIEVER_COLLECTION_SCOPES = {
  chat: CHAT_COLLECTIONS,
  planEvidence: PLAN_EVIDENCE_COLLECTIONS,
} as const;
const MIN_SCORE = Number(process.env.RAG_MIN_SCORE || "0.35");
const TOP_K = Number(process.env.RAG_TOP_K || "5");
const DEBUG_RAG = process.env.DEBUG_RAG === "true";
const RAG_EMBEDDING_TIMEOUT_MS = Number(
  process.env.RAG_EMBEDDING_TIMEOUT_MS ||
    process.env.EMBEDDING_TIMEOUT_MS ||
    "8000",
);
// Max chars for instructions field - long how-to text bloats the prompt without adding value for the LLM
const INSTRUCTION_MAX_CHARS = 120;

function safeQueryPreview(query: string): string {
  return query
    .replace(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, "[email]")
    .replace(/\b\d{8,}\b/g, "[number]")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
}

function debugRag(event: string, data: Record<string, unknown>): void {
  if (!DEBUG_RAG) return;
  logger.debug(data, event);
}

function readPayloadString(
  payload: Record<string, unknown>,
  keys: string[],
  fallback = "",
): string {
  for (const key of keys) {
    const value = payload[key];
    if (typeof value === "string" && value.trim()) return value.trim();
    if (typeof value === "number" && Number.isFinite(value))
      return String(value);
  }
  return fallback;
}

function readPayloadUrl(payload: Record<string, unknown>): string | null {
  const value = readPayloadString(payload, ["source_url", "url", "base_url"]);
  return /^https?:\/\//i.test(value) ? value : null;
}

function foldVietnameseForQuery(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/[đĐ]/g, "d");
}

// Equipment values that require gym-only machines/free weights, observed in
// the `exercises` collection's real payload (confirmed via direct Qdrant
// scroll — this collection has its own equipment vocabulary, distinct from
// fitness-service's DB enum used for plan generation). When a chat question
// signals "home / no equipment", these are excluded via a Qdrant filter so
// RAG doesn't surface a barbell/machine exercise as the answer.
const GYM_ONLY_EQUIPMENT = [
  "Barbell",
  "Cable Machine",
  "Machine",
  "Smith Machine",
  "Sled",
  "Treadmill",
];

export function detectHomeOnlyConstraint(question: string): boolean {
  const q = foldVietnameseForQuery(question);
  return /(tap o nha|tai nha|khong co ta|khong co dung cu|khong dung cu|home workout|no equipment|bodyweight only|without equipment)/i.test(
    q,
  );
}

function expandQueries(question: string): string[] {
  const variants = new Set<string>([question]);
  const q = foldVietnameseForQuery(question);

  if (/(fat loss|giam mo|siet mo|giam can)/i.test(q)) {
    variants.add(`${question} calorie deficit high protein`);
  }
  if (/(muscle gain|tang co|hypertrophy|bulk)/i.test(q)) {
    variants.add(`${question} progressive overload hypertrophy`);
  }
  if (/(injury|pain|chan thuong|dau goi|dau lung)/i.test(q)) {
    variants.add(`${question} safe alternative low impact`);
  }
  if (/(equipment|dung cu|home|tai nha)/i.test(q)) {
    variants.add(`${question} bodyweight dumbbell resistance band`);
  }
  // Body composition evidence queries
  if (/(body fat|mo co the|beo phi|bodyfat|inbody|bia)/i.test(q)) {
    variants.add(
      `${question} body fat percentage BMI body composition assessment`,
    );
  }
  if (/(bmi|can nang|weight)/i.test(q)) {
    variants.add(`${question} BMI body weight body composition interpretation`);
  }
  if (/(protein|dam|macros)/i.test(q)) {
    variants.add(`${question} protein intake muscle resistance training g/kg`);
  }
  if (/(beginner|moi bat dau|nguoi moi)/i.test(q)) {
    variants.add(
      `${question} beginner progressive overload training volume frequency`,
    );
  }

  // Muscle group expansions for better English-centric embedding retrieval.
  if (/(nguc|chest)/i.test(q)) variants.add(`${question} chest pectorals`);
  if (/(lung|xo|back)/i.test(q)) variants.add(`${question} back lats`);
  if (/(vai|shoulder)/i.test(q)) variants.add(`${question} shoulders deltoids`);
  if (/(tay truoc|biceps)/i.test(q)) variants.add(`${question} biceps arms`);
  if (/(tay sau|triceps)/i.test(q)) variants.add(`${question} triceps arms`);
  if (/(mong|glutes)/i.test(q)) variants.add(`${question} glutes`);
  if (/(dui|chan|legs)/i.test(q))
    variants.add(`${question} legs quadriceps hamstrings`);
  if (/(bung|core)/i.test(q)) variants.add(`${question} abs core`);

  return Array.from(variants);
}
export function retrievalDocumentFromPayload(
  collection: string,
  payload: Record<string, unknown>,
  score: number,
  id: string,
): RetrievalDocument {
  if (collection === "exercises") {
    const exerciseName = String(payload.exerciseName || "Unknown exercise");
    const typeOfActivity = String(payload.typeOfActivity || "unknown");
    const typeOfEquipment = String(payload.typeOfEquipment || "unknown");
    const bodyPart = String(payload.bodyPart || "unknown");
    const movementType = String(payload.type || "unknown");
    const muscles = String(payload.muscleGroupsActivated || "unknown");
    const rawInstructions = String(payload.instructions || "No instructions");
    const instructions =
      rawInstructions.length > INSTRUCTION_MAX_CHARS
        ? rawInstructions.slice(0, INSTRUCTION_MAX_CHARS) + "..."
        : rawInstructions;

    return {
      id: `${collection}_${id}`,
      pageContent: [
        `Exercise: ${exerciseName}`,
        `Equipment: ${typeOfEquipment} | Activity: ${typeOfActivity} | Body Part: ${bodyPart}`,
        `Movement: ${movementType} | Muscles: ${muscles}`,
        `Instructions: ${instructions}`,
      ].join("\n"),
      score,
      source: `qdrant:${collection}`,
      category: "exercise_knowledge",
      metadata: {
        goal: movementType,
        level: "general",
        equipment: typeOfEquipment,
        source_file: "data/processed/rag/exercises.csv",
        chunk_id: id,
        body_part: bodyPart,
        type_of_activity: typeOfActivity,
      },
    };
  } else if (collection === "fitness_knowledge") {
    return {
      id: `${collection}_${id}`,
      pageContent: `Title: ${payload.titleVi}\nContent: ${payload.contentVi}`,
      score,
      source: `qdrant:${collection}`,
      category: String(payload.category || "general"),
      metadata: {
        source_file: "data/catalog/rag/gym_rag_master_dataset.csv",
        chunk_id: id,
      },
    };
  } else if (collection === "fitness_faq") {
    return {
      id: `${collection}_${id}`,
      pageContent: `Q: ${payload.questionVi}\nA: ${payload.answerVi}`,
      score,
      source: `qdrant:${collection}`,
      category: String(payload.category || "general"),
      metadata: { source_file: "data/catalog/qa/gym_faq_qa.csv", chunk_id: id },
    };
  }

  if (collection === "fitness_evidence") {
    const title = readPayloadString(payload, ["title"], "Untitled evidence");
    const sourceType = readPayloadString(
      payload,
      ["source_type", "sourceType"],
      "curated_summary",
    );
    const category = readPayloadString(
      payload,
      ["category", "topic"],
      "body_composition",
    ).toLowerCase();
    const evidenceLevel = readPayloadString(
      payload,
      ["evidence_level", "evidenceLevel"],
      "unknown",
    );
    const content = readPayloadString(payload, [
      "content",
      "text",
      "clean_text",
    ]);
    const sourceUrl = readPayloadUrl(payload);

    return {
      id: `${collection}_${id}`,
      pageContent: [
        `[${sourceType}] ${title}`,
        `Category: ${category} | Evidence level: ${evidenceLevel}`,
        content,
      ].join("\n"),
      score,
      source: `qdrant:${collection}`,
      category,
      metadata: {
        title,
        source_url: sourceUrl,
        source_type: sourceType,
        evidence_level: evidenceLevel,
        category,
        topic: readPayloadString(payload, ["topic"], category.toUpperCase()),
        tags: Array.isArray(payload.tags) ? payload.tags : [],
        created_from: String(
          payload.created_from ?? "external_evidence_dataset",
        ),
        source_file: String(payload.source_file ?? "data/processed/evidence"),
        chunk_id: String(payload.chunk_id ?? id),
        extraction_method: String(
          payload.extraction_method ?? "knowledge_curated",
        ),
        document_id:
          payload.document_id != null ? String(payload.document_id) : null,
        source_name:
          payload.source_name != null ? String(payload.source_name) : null,
        source_tier: payload.source_tier,
        trust_score: payload.trust_score,
        quality_score: payload.quality_score,
        language: payload.language != null ? String(payload.language) : null,
        published_at:
          payload.published_at != null ? String(payload.published_at) : null,
      },
    };
  }

  return {
    id: `${collection}_${id}`,
    pageContent: JSON.stringify(payload),
    score,
    source: `qdrant:${collection}`,
    category: "unknown",
    metadata: { source_file: "unknown", chunk_id: id },
  };
}

function dedupeAndSort(docs: RetrievalDocument[]): RetrievalDocument[] {
  const byId = new Map<string, RetrievalDocument>();
  for (const doc of docs) {
    const existing = byId.get(doc.id);
    if (!existing || existing.score < doc.score) {
      byId.set(doc.id, doc);
    }
  }
  return Array.from(byId.values())
    .sort((a, b) => b.score - a.score)
    .slice(0, TOP_K);
}

async function searchCollection(
  collection: string,
  vector: number[],
  filter?: Record<string, unknown>,
): Promise<RetrievalDocument[]> {
  try {
    const results = await getQdrantClient().search(collection, {
      vector,
      limit: TOP_K,
      with_payload: true,
      ...(filter ? { filter } : {}),
    });
    const docs: RetrievalDocument[] = [];
    for (const item of results) {
      const payload = (item.payload || {}) as Record<string, unknown>;
      const score = typeof item.score === "number" ? item.score : 0;
      if (score >= MIN_SCORE)
        docs.push(
          retrievalDocumentFromPayload(
            collection,
            payload,
            score,
            String(item.id),
          ),
        );
    }
    debugRag("RAG collection search completed", {
      collection,
      retrieved: docs.length,
      rawMatches: results.length,
      topScore: results[0]?.score,
      documentIds: docs.slice(0, 3).map((doc) => doc.id),
      sources: docs
        .slice(0, 3)
        .map(
          (doc) =>
            doc.metadata.source_url || doc.metadata.source_file || doc.source,
        ),
    });
    return docs;
  } catch (err) {
    logger.warn(
      { collection, err },
      "Failed to search collection (may not exist yet)",
    );
    return [];
  }
}

export const retriever = {
  /**
   * Retrieve evidence specifically from fitness_evidence collection using
   * body-composition-specific queries generated by the rule engine.
   */
  async retrieveEvidence(queries: string[]): Promise<RetrievalDocument[]> {
    if (queries.length === 0) return [];
    const collected: RetrievalDocument[] = [];

    for (const query of queries.slice(0, 5)) {
      try {
        debugRag("RAG evidence query started", {
          scope: "planEvidence",
          queryPreview: safeQueryPreview(query),
          collections: [...PLAN_EVIDENCE_COLLECTIONS],
        });
        const vector = await llmService.generateEmbedding(query, {
          timeoutMs: RAG_EMBEDDING_TIMEOUT_MS,
        });
        const collectionResults = await Promise.all(
          PLAN_EVIDENCE_COLLECTIONS.map((collection) =>
            searchCollection(collection, vector),
          ),
        );
        collected.push(...collectionResults.flat());
      } catch (err) {
        logger.debug({ err, query }, "Evidence retrieval query failed");
      }
    }

    return dedupeAndSort(collected).slice(0, 4);
  },

  async retrieveForChat(question: string): Promise<RetrievalResult> {
    const queries = expandQueries(question);
    const homeOnly = detectHomeOnlyConstraint(question);
    const exercisesFilter = homeOnly
      ? { must_not: [{ key: "typeOfEquipment", match: { any: GYM_ONLY_EQUIPMENT } }] }
      : undefined;
    debugRag("RAG chat query expanded", {
      scope: "chat",
      queryCount: queries.length,
      queryPreviews: queries.map(safeQueryPreview),
      collections: [...CHAT_COLLECTIONS],
      homeOnlyEquipmentFilter: homeOnly,
    });

    const collected: RetrievalDocument[] = [];

    // Search all variants across chat collections concurrently. This is the
    // only runtime path allowed to use qdrant:exercises.
    const searchPromises = queries.map(async (query) => {
      try {
        const vector = await llmService.generateEmbedding(query, {
          timeoutMs: RAG_EMBEDDING_TIMEOUT_MS,
        });
        const collectionPromises = CHAT_COLLECTIONS.map((col) =>
          searchCollection(
            col,
            vector,
            col === "exercises" ? exercisesFilter : undefined,
          ),
        );
        const collectionResults = await Promise.all(collectionPromises);
        return collectionResults.flat();
      } catch (err) {
        logger.warn(
          { error: err },
          "Embedding generation failed for query variant",
        );
        return [];
      }
    });

    const results = await Promise.allSettled(searchPromises);
    for (const result of results) {
      if (result.status === "fulfilled") {
        collected.push(...result.value);
      }
    }

    const documents = dedupeAndSort(collected);
    if (documents.length === 0) {
      return {
        documents: [],
        isEmpty: true,
        reason: "No document passed similarity threshold",
      };
    }

    return {
      documents,
      isEmpty: false,
    };
  },

  async retrieve(question: string): Promise<RetrievalResult> {
    return this.retrieveForChat(question);
  },

  /**
   * Narrow, single-collection exercise search for the `search_exercise_library`
   * tool call — the LLM supplies `equipment` explicitly (from the user's
   * stated constraint), instead of `retrieveForChat`'s regex-based
   * `detectHomeOnlyConstraint`.
   */
  async searchExercises(
    query: string,
    equipment?: string,
  ): Promise<RetrievalDocument[]> {
    try {
      const vector = await llmService.generateEmbedding(query, {
        timeoutMs: RAG_EMBEDDING_TIMEOUT_MS,
      });
      const filter =
        equipment === "none"
          ? {
              must_not: [
                { key: "typeOfEquipment", match: { any: GYM_ONLY_EQUIPMENT } },
              ],
            }
          : undefined;
      const docs = await searchCollection("exercises", vector, filter);
      return dedupeAndSort(docs).slice(0, 3);
    } catch (err) {
      logger.warn({ err, query }, "Tool searchExercises failed");
      return [];
    }
  },
};
