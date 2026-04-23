import { logger } from '@gym-coach/shared';
import { llmService } from '../services/llm.service';
import { getQdrantClient } from '../repositories/qdrant';
import type { RetrievalDocument, RetrievalResult } from './types';

const COLLECTIONS = ['exercises', 'fitness_knowledge', 'fitness_faq'];
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

function docFromPayload(collection: string, payload: Record<string, unknown>, score: number, id: string): RetrievalDocument {
  if (collection === 'exercises') {
    const exerciseName = String(payload.exerciseName || 'Unknown exercise');
    const typeOfActivity = String(payload.typeOfActivity || 'unknown');
    const typeOfEquipment = String(payload.typeOfEquipment || 'unknown');
    const bodyPart = String(payload.bodyPart || 'unknown');
    const movementType = String(payload.type || 'unknown');
    const muscles = String(payload.muscleGroupsActivated || 'unknown');
    const rawInstructions = String(payload.instructions || 'No instructions');
    const instructions = rawInstructions.length > INSTRUCTION_MAX_CHARS
      ? rawInstructions.slice(0, INSTRUCTION_MAX_CHARS) + '…'
      : rawInstructions;

    return {
      id: `${collection}_${id}`,
      pageContent: [
        `Exercise: ${exerciseName}`,
        `Equipment: ${typeOfEquipment} | Activity: ${typeOfActivity} | Body Part: ${bodyPart}`,
        `Movement: ${movementType} | Muscles: ${muscles}`,
        `Instructions: ${instructions}`,
      ].join('\n'),
      score,
      source: `qdrant:${collection}`,
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
  } else if (collection === 'fitness_knowledge') {
    return {
      id: `${collection}_${id}`,
      pageContent: `Title: ${payload.titleVi}\nContent: ${payload.contentVi}`,
      score,
      source: `qdrant:${collection}`,
      category: String(payload.category || 'general'),
      metadata: { source_file: 'data/catalog/rag/gym_rag_master_dataset.csv', chunk_id: id },
    };
  } else if (collection === 'fitness_faq') {
    return {
      id: `${collection}_${id}`,
      pageContent: `Q: ${payload.questionVi}\nA: ${payload.answerVi}`,
      score,
      source: `qdrant:${collection}`,
      category: String(payload.category || 'general'),
      metadata: { source_file: 'data/catalog/qa/gym_faq_qa.csv', chunk_id: id },
    };
  }
  
  return {
    id: `${collection}_${id}`,
    pageContent: JSON.stringify(payload),
    score,
    source: `qdrant:${collection}`,
    category: 'unknown',
    metadata: { source_file: 'unknown', chunk_id: id },
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

async function searchCollection(collection: string, vector: number[]): Promise<RetrievalDocument[]> {
  try {
    const results = await getQdrantClient().search(collection, { vector, limit: TOP_K });
    const docs: RetrievalDocument[] = [];
    for (const item of results) {
      const payload = (item.payload || {}) as Record<string, unknown>;
      const score = typeof item.score === 'number' ? item.score : 0;
      if (score >= MIN_SCORE) docs.push(docFromPayload(collection, payload, score, String(item.id)));
    }
    return docs;
  } catch (err) {
    logger.warn({ collection, err }, 'Failed to search collection (may not exist yet)');
    return [];
  }
}

export const retriever = {
  async retrieve(question: string): Promise<RetrievalResult> {
    const queries = expandQueries(question);

    const collected: RetrievalDocument[] = [];
    
    // Search all variants across all collections concurrently
    const searchPromises = queries.map(async (query) => {
      try {
        const vector = await llmService.generateEmbedding(query);
        const collectionPromises = COLLECTIONS.map(col => searchCollection(col, vector));
        const collectionResults = await Promise.all(collectionPromises);
        return collectionResults.flat();
      } catch (err) {
        logger.warn({ error: err }, 'Embedding generation failed for query variant');
        return [];
      }
    });

    const results = await Promise.allSettled(searchPromises);
    for (const result of results) {
      if (result.status === 'fulfilled') {
        collected.push(...result.value);
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
