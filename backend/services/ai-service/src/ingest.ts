import { QdrantClient } from '@qdrant/js-client-rest';
import axios from 'axios';
import * as fs from 'fs';
import * as path from 'path';

const QDRANT_HOST = process.env.QDRANT_HOST || 'localhost';
const QDRANT_PORT = process.env.QDRANT_PORT || '6333';
const LLM_BASE_URL = process.env.LLM_BASE_URL || 'http://localhost:11434';
const EMBEDDING_MODEL = process.env.EMBEDDING_MODEL || 'nomic-embed-text';
const COLLECTION_NAME = 'exercises';

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
        // Escaped quote ("") inside a quoted field → literal "
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

/** Required column names in the exercises CSV (case-sensitive). */
const REQUIRED_COLUMNS = [
  'exercise_name',
  'type_of_activity',
  'type_of_equipment',
  'body_part',
  'type',
  'muscle_groups_activated',
  'instructions',
] as const;

function resolveCsvPath(): string {
  const envPath = process.env.RAG_INGEST_CSV_PATH;
  const candidates = [
    envPath ? path.resolve(process.cwd(), envPath) : null,
    path.resolve(process.cwd(), '../../../data/processed/rag/exercises.csv'),
    path.resolve(__dirname, '../../../../data/processed/rag/exercises.csv'),
  ].filter((p): p is string => Boolean(p));

  const existing = candidates.find((candidate) => fs.existsSync(candidate));
  if (existing) {
    return existing;
  }

  throw new Error(
    `Cannot find ingest CSV. Checked: ${candidates.join(', ')}. ` +
      'Set RAG_INGEST_CSV_PATH to the correct dataset file path if your workspace layout is different.'
  );
}

async function main() {
  console.log('Starting ingestion to Qdrant...');

  // ── Read and parse CSV ────────────────────────────────────────────────────
  const csvPath = resolveCsvPath();
  console.log(`Using CSV: ${csvPath}`);
  const rawLines = fs.readFileSync(csvPath, 'utf-8')
    .split('\n')
    .map((l) => l.replace(/\r$/, '')); // strip Windows CR

  if (rawLines.length < 2) {
    throw new Error('CSV file is empty or contains only a header row');
  }

  // Parse header and build column → index map
  const headers = parseCSVLine(rawLines[0]);
  const missing = REQUIRED_COLUMNS.filter((col) => !headers.includes(col));
  if (missing.length > 0) {
    throw new Error(
      `CSV is missing required columns: ${missing.join(', ')}. ` +
        `Found columns: ${headers.join(', ')}`
    );
  }
  const col: Record<string, number> = {};
  headers.forEach((h, i) => { col[h] = i; });

  const dataRows = rawLines.slice(1).filter((l) => l.trim());
  const exercises = dataRows
    .map((line, index) => {
      const parts = parseCSVLine(line);
      return {
        id: index,
        exerciseName: parts[col['exercise_name']] ?? '',
        typeOfActivity: parts[col['type_of_activity']] ?? '',
        typeOfEquipment: parts[col['type_of_equipment']] ?? '',
        bodyPart: parts[col['body_part']] ?? '',
        type: parts[col['type']] ?? '',
        muscleGroupsActivated: parts[col['muscle_groups_activated']] ?? '',
        instructions: parts[col['instructions']] ?? '',
      };
    })
    .filter((ex) => ex.exerciseName); // skip rows with empty exercise name

  const skipped = dataRows.length - exercises.length;
  if (skipped > 0) {
    console.warn(`⚠  Skipped ${skipped} row(s) with empty exercise_name`);
  }
  console.log(`Loaded ${exercises.length} exercises from CSV`);

  // Check if collection exists
  try {
    await qdrantClient.getCollection(COLLECTION_NAME);
    console.log(`Collection ${COLLECTION_NAME} exists, deleting...`);
    await qdrantClient.deleteCollection(COLLECTION_NAME);
  } catch (error) {
    console.log(`Collection ${COLLECTION_NAME} does not exist, creating new...`);
  }

  // Create collection
  await qdrantClient.createCollection(COLLECTION_NAME, {
    vectors: {
      size: 768, // nomic-embed-text embedding size
      distance: 'Cosine',
    },
  });
  console.log(`Created collection ${COLLECTION_NAME}`);

  // Generate embeddings and upload
  console.log('Generating embeddings and uploading to Qdrant...');
  const batchSize = 10;

  for (let i = 0; i < exercises.length; i += batchSize) {
    const batch = exercises.slice(i, i + batchSize);
    console.log(`Processing batch ${Math.floor(i / batchSize) + 1}/${Math.ceil(exercises.length / batchSize)}...`);

    const points = await Promise.all(
      batch.map(async (exercise) => {
        // Create text representation for embedding
        const text = `${exercise.exerciseName} ${exercise.typeOfActivity} ${exercise.typeOfEquipment} ${exercise.bodyPart} ${exercise.muscleGroupsActivated} ${exercise.instructions}`;
        const embedding = await generateEmbedding(text);

        return {
          id: exercise.id,
          vector: embedding,
          payload: exercise,
        };
      })
    );

    await qdrantClient.upsert(COLLECTION_NAME, {
      wait: true,
      points,
    });

    // Small delay to avoid rate limiting
    await new Promise((resolve) => setTimeout(resolve, 100));
  }

  console.log('✅ Ingestion complete!');
}

main()
  .catch((error) => {
    console.error('❌ Ingestion failed:', error);
    process.exit(1);
  });
