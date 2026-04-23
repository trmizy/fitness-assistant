import { QdrantClient } from '@qdrant/js-client-rest';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const QDRANT_HOST = process.env.QDRANT_HOST || 'localhost';
const QDRANT_PORT = process.env.QDRANT_PORT || '6333';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';

const qdrantClient = new QdrantClient({
  url: `http://${QDRANT_HOST}:${QDRANT_PORT}`,
});

async function generateEmbedding(text: string): Promise<number[]> {
  try {
    const response = await axios.post(`${LLM_BASE_URL}/api/embeddings`, {
      model: EMBEDDING_MODEL,
      prompt: text,
    });
    return response.data.embedding;
  } catch (error: unknown) {
    const msg = error instanceof Error ? error.message : String(error);
    console.error('Error generating embedding:', msg);
    throw error;
  }
}

/**
 * RFC 4180-compliant CSV line parser.
 * Handles quoted fields, escaped double-quotes (""), and commas inside quotes.
 * Strips surrounding whitespace from each field.
 */
function parseCSVLine(line: string): string[] {
  const fields: string[] = [];
  let current = '';
  let inQuotes = false;

  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') {
      if (inQuotes && line[i + 1] === '"') {
        current += '"';
        i++;
      } else {
        inQuotes = !inQuotes;
      }
    } else if (ch === ',' && !inQuotes) {
      fields.push(current.trim());
      current = '';
    } else {
      current += ch;
    }
  }
  fields.push(current.trim());
  return fields;
}

function resolveCsvPath(relativePath: string): string {
  const envPath = process.env.RAG_INGEST_CSV_PATH;
  const candidates = [
    envPath ? path.resolve(process.cwd(), envPath) : null,
    path.resolve(process.cwd(), relativePath),
    path.resolve(process.cwd(), '../../..', relativePath),
    path.resolve(__dirname, '../../../..', relativePath),
  ].filter((p): p is string => Boolean(p));

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (existing) {
    return existing;
  }

  throw new Error(`Cannot find CSV file for ${relativePath}. Checked: ${candidates.join(', ')}.`);
}

async function ingestCollection(
  collectionName: string,
  csvRelativePath: string,
  requiredColumns: string[],
  extractPayload: (parts: string[], col: Record<string, number>, index: number) => any,
  extractTextForEmbedding: (payload: any) => string
) {
  console.log(`\n--- Starting ingestion for ${collectionName} ---`);
  const csvPath = resolveCsvPath(csvRelativePath);
  console.log(`Using CSV: ${csvPath}`);
  const rawLines = fs.readFileSync(csvPath, 'utf-8')
    .split('\n')
    .map((l) => l.replace(/\r$/, '')); // strip Windows CR

  if (rawLines.length < 2) {
    throw new Error('CSV file is empty or contains only a header row');
  }

  const headers = parseCSVLine(rawLines[0]);
  const missing = requiredColumns.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(`CSV is missing required columns: ${missing.join(', ')}.`);
  }
  const col: Record<string, number> = {};
  headers.forEach((h, i) => { col[h] = i; });

  const dataRows = rawLines.slice(1).filter((l) => l.trim());
  const items = dataRows
    .map((line, index) => {
      const parts = parseCSVLine(line);
      return extractPayload(parts, col, index);
    })
    .filter((item) => item !== null);

  console.log(`Loaded ${items.length} items from CSV for ${collectionName}`);

  // Check if collection exists
  try {
    await qdrantClient.getCollection(collectionName);
    console.log(`Collection ${collectionName} exists, deleting...`);
    await qdrantClient.deleteCollection(collectionName);
  } catch (error) {
    console.log(`Collection ${collectionName} does not exist, creating new...`);
  }

  // Create collection
  await qdrantClient.createCollection(collectionName, {
    vectors: { size: 768, distance: 'Cosine' },
  });
  console.log(`Created collection ${collectionName}`);

  // Generate embeddings and upload
  console.log('Generating embeddings and uploading to Qdrant...');
  const batchSize = 20;

  for (let i = 0; i < items.length; i += batchSize) {
    const batch = items.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(items.length / batchSize)}...`);

    const points = await Promise.all(
      batch.map(async (item) => {
        const text = extractTextForEmbedding(item);
        const embedding = await generateEmbedding(text);
        return {
          id: item.id,
          vector: embedding,
          payload: item,
        };
      })
    );

    await qdrantClient.upsert(collectionName, { wait: true, points });
    await new Promise((resolve) => setTimeout(resolve, 50));
  }

  console.log(`✅ Ingestion complete for ${collectionName}!`);
}

async function main() {
  const args = process.argv.slice(2);
  const collectionArg = args.find(a => a.startsWith('--collection='))?.split('=')[1] || 'all';

  const configs = [
    {
      name: 'exercises',
      path: 'data/processed/rag/exercises.csv',
      requiredColumns: ['exercise_name', 'type_of_activity', 'type_of_equipment', 'body_part', 'type', 'muscle_groups_activated', 'instructions'],
      extractPayload: (parts: string[], col: Record<string, number>, index: number) => {
        if (!parts[col['exercise_name']]) return null;
        return {
          id: index,
          exerciseName: parts[col['exercise_name']] || '',
          typeOfActivity: parts[col['type_of_activity']] || '',
          typeOfEquipment: parts[col['type_of_equipment']] || '',
          bodyPart: parts[col['body_part']] || '',
          type: parts[col['type']] || '',
          muscleGroupsActivated: parts[col['muscle_groups_activated']] || '',
          instructions: parts[col['instructions']] || '',
        };
      },
      extractText: (p: any) => `${p.exerciseName} ${p.typeOfActivity} ${p.typeOfEquipment} ${p.bodyPart} ${p.muscleGroupsActivated} ${p.instructions}`,
    },
    {
      name: 'fitness_knowledge',
      path: 'data/catalog/rag/gym_rag_master_dataset.csv',
      requiredColumns: ['doc_id', 'title_vi', 'content_vi', 'category', 'tags'],
      extractPayload: (parts: string[], col: Record<string, number>, index: number) => {
        if (!parts[col['doc_id']]) return null;
        return {
          id: index,
          docId: parts[col['doc_id']] || '',
          titleVi: parts[col['title_vi']] || '',
          contentVi: parts[col['content_vi']] || '',
          category: parts[col['category']] || '',
          tags: parts[col['tags']] || '',
        };
      },
      extractText: (p: any) => `${p.titleVi} ${p.contentVi} ${p.category} ${p.tags}`,
    },
    {
      name: 'fitness_faq',
      path: 'data/catalog/qa/gym_faq_qa.csv',
      requiredColumns: ['faq_id', 'question_vi', 'answer_vi', 'category', 'tags'],
      extractPayload: (parts: string[], col: Record<string, number>, index: number) => {
        if (!parts[col['faq_id']]) return null;
        return {
          id: index,
          faqId: parts[col['faq_id']] || '',
          questionVi: parts[col['question_vi']] || '',
          answerVi: parts[col['answer_vi']] || '',
          category: parts[col['category']] || '',
          tags: parts[col['tags']] || '',
        };
      },
      extractText: (p: any) => `${p.questionVi} ${p.answerVi} ${p.category} ${p.tags}`,
    }
  ];

  for (const config of configs) {
    if (collectionArg === 'all' || collectionArg === config.name) {
      await ingestCollection(config.name, config.path, config.requiredColumns, config.extractPayload, config.extractText);
    }
  }
}

main().catch((error) => {
  console.error('❌ Ingestion failed:', error);
  process.exit(1);
});

