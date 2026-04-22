import { logger } from '@gym-coach/shared';
import { llmService } from '../services/llm.service';
import { getQdrantClient } from '../repositories/qdrant';
import type { RetrievalDocument, RetrievalResult } from './types';

const COLLECTION_NAME = 'exercises';
const MIN_SCORE = Number(process.env.RAG_MIN_SCORE || '0.35');
const TOP_K = Number(process.env.RAG_TOP_K || '5');
// Max chars for instructions field — long how-to text bloats the prompt without adding value for the LLM
const INSTRUCTION_MAX_CHARS = 120;

function expandQueries(question: string): string[] {
  const variants = new Set<string>([question]);
  const q = question.toLowerCase();

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

  return Array.from(variants);
}

function docFromPayload(payload: Record<string, unknown>, score: number, id: string): RetrievalDocument {
  const exerciseName = String(payload.exerciseName || 'Unknown exercise');
  const typeOfActivity = String(payload.typeOfActivity || 'unknown');
  const typeOfEquipment = String(payload.typeOfEquipment || 'unknown');
  const bodyPart = String(payload.bodyPart || 'unknown');
  const movementType = String(payload.type || 'unknown');
  const muscles = String(payload.muscleGroupsActivated || 'unknown');
  const rawInstructions = String(payload.instructions || 'No instructions');
  // Truncate instructions to avoid inflating the prompt — the LLM only needs the name + muscles + movement type
  const instructions = rawInstructions.length > INSTRUCTION_MAX_CHARS
    ? rawInstructions.slice(0, INSTRUCTION_MAX_CHARS) + '…'
    : rawInstructions;

  const pageContent = [
    `Exercise: ${exerciseName}`,
    `Equipment: ${typeOfEquipment} | Activity: ${typeOfActivity} | Body Part: ${bodyPart}`,
    `Movement: ${movementType} | Muscles: ${muscles}`,
    `Instructions: ${instructions}`,
  ].join('\n');

  return {
    id,
    pageContent,
    score,
    source: 'qdrant:exercises',
    category: 'exercise_knowledge',
    metadata: {
      goal: movementType,
      level: 'general',
      equipment: typeOfEquipment,
      source_file: 'data/processed/rag/exercises.csv',
      chunk_id: id,
      body_part: bodyPart,
      type_of_activity: typeOfActivity,
    },
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

async function searchOne(query: string): Promise<RetrievalDocument[]> {
  const vector = await llmService.generateEmbedding(query);
  const results = await getQdrantClient().search(COLLECTION_NAME, { vector, limit: TOP_K });
  const docs: RetrievalDocument[] = [];
  for (const item of results) {
    const payload = (item.payload || {}) as Record<string, unknown>;
    const score = typeof item.score === 'number' ? item.score : 0;
    if (score >= MIN_SCORE) docs.push(docFromPayload(payload, score, String(item.id)));
  }
  return docs;
}

export const retriever = {
  async retrieve(question: string): Promise<RetrievalResult> {
    const queries = expandQueries(question);

    // Run all embedding + search calls in parallel instead of sequentially
    const results = await Promise.allSettled(queries.map(searchOne));
    const collected: RetrievalDocument[] = [];
    for (const result of results) {
      if (result.status === 'fulfilled') {
        collected.push(...result.value);
      } else {
        logger.warn({ error: result.reason }, 'Retriever query failed, continuing with results from other variants');
      }
    }

    const documents = dedupeAndSort(collected);
    if (documents.length === 0) {
      return {
        documents: [],
        isEmpty: true,
        reason: 'No document passed similarity threshold',
      };
    }

    return {
      documents,
      isEmpty: false,
    };
  },
};
