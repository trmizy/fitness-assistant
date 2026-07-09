import dotenv from 'dotenv';
import { getQdrantClient } from '../repositories/qdrant';
import { llmService } from '../services/llm.service';

dotenv.config();

type PointSeed = {
  id: number;
  text: string;
  payload: Record<string, unknown>;
};

const COLLECTIONS = ['exercises', 'fitness_knowledge', 'fitness_faq', 'fitness_evidence'] as const;

const exerciseSeeds: PointSeed[] = [
  {
    id: 0,
    text: 'What is the starting position for a docker test push up?',
    payload: {
      exerciseName: 'Docker Test Push Up',
      typeOfActivity: 'STRENGTH',
      typeOfEquipment: 'BODYWEIGHT',
      bodyPart: 'UPPER_BODY',
      type: 'PUSH',
      muscleGroupsActivated: 'chest,triceps,shoulders',
      instructions: 'Start in a high plank with hands under shoulders, lower under control, then press back up.',
    },
  },
  {
    id: 1,
    text: 'What muscles does the docker test squat use?',
    payload: {
      exerciseName: 'Docker Test Squat',
      typeOfActivity: 'STRENGTH',
      typeOfEquipment: 'BODYWEIGHT',
      bodyPart: 'LOWER_BODY',
      type: 'PUSH',
      muscleGroupsActivated: 'quadriceps,glutes,hamstrings',
      instructions: 'Stand with feet around shoulder width, sit hips back, keep chest tall, and stand up.',
    },
  },
  {
    id: 2,
    text: 'How do I hold a docker test plank?',
    payload: {
      exerciseName: 'Docker Test Plank',
      typeOfActivity: 'STRENGTH',
      typeOfEquipment: 'BODYWEIGHT',
      bodyPart: 'CORE',
      type: 'HOLD',
      muscleGroupsActivated: 'core,abs,glutes',
      instructions: 'Keep elbows under shoulders and hold a straight line from head to heels.',
    },
  },
  {
    id: 3,
    text: 'What equipment is used for a docker test deadlift?',
    payload: {
      exerciseName: 'Docker Test Deadlift',
      typeOfActivity: 'STRENGTH',
      typeOfEquipment: 'BARBELL',
      bodyPart: 'FULL_BODY',
      type: 'PULL',
      muscleGroupsActivated: 'glutes,hamstrings,back',
      instructions: 'Hinge at the hips, keep the bar close, brace, and stand tall.',
    },
  },
];

const evidenceSeeds: PointSeed[] = [
  {
    id: 0,
    text: 'bioelectrical impedance analysis body composition fat-free mass fat mass total body water standardized measurement conditions',
    payload: {
      title: 'Docker Test BIA Measurement Conditions',
      source_type: 'curated_summary',
      source_url: 'https://example.com/docker-test-bia',
      source_name: 'Docker Test Evidence',
      evidence_level: 'guideline_summary',
      category: 'body_composition',
      topic: 'BIA',
      content: 'BIA measurement is more reliable when hydration, food intake, recent exercise, and room conditions are standardized.',
      tags: ['bia', 'body_composition'],
      source_file: 'docker/test/seed-rag',
      chunk_id: 'docker-bia-0',
      published_at: '2026',
    },
  },
  {
    id: 1,
    text: 'Bioelectrical impedance analysis BIA body composition measurement conditions',
    payload: {
      title: 'Docker Test BIA Chat Evidence',
      source_type: 'curated_summary',
      source_url: 'https://example.com/docker-test-bia-chat',
      source_name: 'Docker Test Evidence',
      evidence_level: 'guideline_summary',
      category: 'body_composition',
      topic: 'BIA',
      content: 'For BIA or InBody checks, compare repeated measurements under the same conditions rather than overreacting to one reading.',
      tags: ['bia', 'inbody'],
      source_file: 'docker/test/seed-rag',
      chunk_id: 'docker-bia-1',
      published_at: '2026',
    },
  },
];

const knowledgeSeeds: PointSeed[] = [
  {
    id: 0,
    text: 'progressive overload training volume recovery',
    payload: {
      titleVi: 'Docker test progressive overload',
      contentVi: 'Tang tien nen dua tren ky thuat tot, phuc hoi du va volume phu hop.',
      category: 'training',
    },
  },
];

const faqSeeds: PointSeed[] = [
  {
    id: 0,
    text: 'how many sets should beginners do',
    payload: {
      questionVi: 'Nguoi moi nen tap bao nhieu set?',
      answerVi: 'Bat dau voi volume vua phai va tang dan khi phuc hoi tot.',
      category: 'training',
    },
  },
];

async function recreateCollection(collection: string, vectorSize: number): Promise<void> {
  const qdrant = getQdrantClient();
  try {
    await qdrant.deleteCollection(collection);
  } catch {
    // Collection may not exist yet.
  }

  await qdrant.createCollection(collection, {
    vectors: {
      size: vectorSize,
      distance: 'Cosine',
    },
  });
}

async function upsertSeeds(collection: string, seeds: PointSeed[]): Promise<void> {
  const qdrant = getQdrantClient();
  const points = [];
  for (const seed of seeds) {
    points.push({
      id: seed.id,
      vector: await llmService.generateEmbedding(seed.text),
      payload: seed.payload,
    });
  }

  await qdrant.upsert(collection, {
    wait: true,
    points,
  });
}

async function main(): Promise<void> {
  const vectorSize = (await llmService.generateEmbedding('docker test vector size')).length;

  for (const collection of COLLECTIONS) {
    await recreateCollection(collection, vectorSize);
  }

  await upsertSeeds('exercises', exerciseSeeds);
  await upsertSeeds('fitness_knowledge', knowledgeSeeds);
  await upsertSeeds('fitness_faq', faqSeeds);
  await upsertSeeds('fitness_evidence', evidenceSeeds);

  console.log(JSON.stringify({
    status: 'PASS',
    mode: 'docker-test-rag-seed',
    vectorSize,
    collections: {
      exercises: exerciseSeeds.length,
      fitness_knowledge: knowledgeSeeds.length,
      fitness_faq: faqSeeds.length,
      fitness_evidence: evidenceSeeds.length,
    },
  }, null, 2));
}

main().catch((err) => {
  console.error('FAIL ai:test:seed-rag');
  console.error(err instanceof Error ? err.message : String(err));
  process.exit(1);
});
