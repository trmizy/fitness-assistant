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
  } catch (error: any) {
    console.error('Error generating embedding:', error.message);
    throw error;
  }
}

async function main() {
  console.log('Starting ingestion to Qdrant...');

  // Read CSV
  const csvPath = path.join(__dirname, '../../../../data/processed/data.csv');
  const csvContent = fs.readFileSync(csvPath, 'utf-8');
  const lines = csvContent.split('\n').slice(1); // Skip header

  const exercises = lines
    .filter((line) => line.trim())
    .map((line, index) => {
      const parts = line.split(',');
      return {
        id: index,
        exerciseName: parts[1]?.trim() || '',
        typeOfActivity: parts[2]?.trim() || '',
        typeOfEquipment: parts[3]?.trim() || '',
        bodyPart: parts[4]?.trim() || '',
        type: parts[5]?.trim() || '',
        muscleGroupsActivated: parts[6]?.trim() || '',
        instructions: parts[7]?.trim() || '',
      };
    });

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
