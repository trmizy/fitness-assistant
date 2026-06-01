/**
 * testEvidenceIntegration.ts
 * ──────────────────────────
 * Smoke-test for the full evidence pipeline:
 *   1. Connect to Qdrant and check fitness_evidence collection exists + has docs
 *   2. Embed a sample body-comp query and retrieve top results
 *   3. Run body_composition_rules on a mock profile and verify output structure
 *   4. Print a sample plan-adjustment block as it would appear in the LLM prompt
 *
 * Usage:
 *   npm run ai:test:evidence
 *
 * Prerequisites:
 *   - Qdrant running (QDRANT_URL or default http://localhost:6333)
 *   - Ollama or embedding service running (OLLAMA_URL or default http://localhost:11434)
 *   - npm run data:ingest has been run at least once
 */

import { getQdrantClient } from '../../repositories/qdrant';
import { llmService } from '../../services/llm.service';
import { analyzeBodyComposition, formatBodyCompAnalysis } from '../../llm/body_composition_rules';
import type { UserProfile } from '../../llm/types';

const MIN_SCORE = 0.25;

// Mock profile with InBody data for a male, 28y, cutting phase
const MOCK_PROFILE: UserProfile = {
  userId: 'test-user',
  age: 28,
  gender: 'MALE',
  heightCm: 175,
  currentWeightKg: 88,
  targetWeightKg: 80,
  goal: 'WEIGHT_LOSS',
  activityLevel: 'MODERATELY_ACTIVE',
  experienceLevel: 'INTERMEDIATE',
  training: {
    trainingDaysPerWeek: 4,
    availableEquipment: ['barbell', 'dumbbell', 'cable'],
    injuries: [],
    preferredTrainingDays: [1, 2, 4, 5],
  },
  inBody: {
    weightKg: 88,
    bodyFatPct: 27,
    bodyFatKg: 23.8,
    skeletalMuscleKg: 38.2,
    bmi: 28.7,
    bmr: 1980,
    measuredAt: new Date(Date.now() - 7 * 24 * 3600_000).toISOString(), // 7 days ago
  },
};

async function checkCollectionExists(): Promise<number> {
  const client = getQdrantClient();
  try {
    const info = await client.getCollection('fitness_evidence');
    const count = (info as any).vectors_count ?? (info as any).points_count ?? 0;
    return count;
  } catch {
    return -1;
  }
}

async function testRetrieval(query: string): Promise<void> {
  const client = getQdrantClient();
  console.log(`\n🔍 Query: "${query}"`);

  let vector: number[];
  try {
    vector = await llmService.generateEmbedding(query);
  } catch (err: any) {
    console.log(`   ⚠  Embedding service unavailable: ${err.message}. Skipping retrieval test.`);
    return;
  }

  const results = await client.search('fitness_evidence', { vector, limit: 3 });
  if (results.length === 0) {
    console.log('   → No results returned (collection may be empty or score too low)');
    return;
  }
  for (const r of results) {
    const p = r.payload as any;
    const score = typeof r.score === 'number' ? r.score.toFixed(3) : '?';
    if (r.score < MIN_SCORE) {
      console.log(`   [score=${score} BELOW THRESHOLD ${MIN_SCORE}] ${p.title ?? '?'}`);
      continue;
    }
    console.log(`   ✅ score=${score} | ${p.title ?? '?'} | type=${p.source_type ?? '?'} | level=${p.evidence_level ?? '?'}`);
    if (p.content) {
      console.log(`      content preview: ${String(p.content).slice(0, 120)}...`);
    }
  }
}

async function main() {
  console.log('═══════════════════════════════════════════════════');
  console.log('  Evidence Integration Smoke-Test');
  console.log('═══════════════════════════════════════════════════\n');

  // 1. Check collection
  console.log('1️⃣  Checking fitness_evidence collection...');
  const count = await checkCollectionExists();
  if (count < 0) {
    console.error('   ❌  Collection not found. Run: npm run data:ingest');
    process.exit(1);
  }
  console.log(`   ✅  fitness_evidence exists with ~${count} vectors`);
  if (count === 0) {
    console.warn('   ⚠  Collection is empty. Run: npm run data:ingest');
  }

  // 2. Retrieval test
  console.log('\n2️⃣  Testing retrieval queries...');
  await testRetrieval('high body fat calorie deficit resistance training protein fat loss');
  await testRetrieval('protein intake muscle gain hypertrophy g/kg');
  await testRetrieval('BMI body composition athletic population');

  // 3. Body comp rule engine
  console.log('\n3️⃣  Running body_composition_rules on mock profile...');
  const analysis = analyzeBodyComposition(MOCK_PROFILE);
  console.log(`   Adjustments:       ${analysis.adjustments.length}`);
  console.log(`   Safety notes:      ${analysis.safetyNotes.length}`);
  console.log(`   Evidence queries:  ${analysis.evidenceQueries.length}`);
  console.log(`   Data quality notes: ${analysis.dataQualityNotes.length}`);
  console.log(`   Plan constraints:`);
  console.log(`     maxDeficitKcal:    ${analysis.planConstraints.maxDeficitKcal ?? 'not set'}`);
  console.log(`     minProteinGKg:     ${analysis.planConstraints.minProteinGKg ?? 'not set'}`);
  console.log(`     resistanceRequired: ${analysis.planConstraints.resistanceRequired}`);

  if (analysis.adjustments.length > 0) {
    console.log('\n   Adjustment sample:');
    const a = analysis.adjustments[0];
    console.log(`     metric:          ${a.metric}`);
    console.log(`     observed_value:  ${a.observed_value}`);
    console.log(`     interpretation:  ${a.interpretation.slice(0, 100)}...`);
    console.log(`     plan_adjustment: ${a.plan_adjustment.slice(0, 100)}...`);
  }

  // 4. Format for LLM prompt
  console.log('\n4️⃣  Formatted body comp block for LLM prompt:');
  const formatted = formatBodyCompAnalysis(analysis);
  if (formatted) {
    console.log(formatted);
  } else {
    console.log('   (empty — no adjustments or safety notes)');
  }

  // 5. Evidence queries that would be sent to Qdrant
  console.log('\n5️⃣  Evidence queries generated:');
  analysis.evidenceQueries.forEach((q, i) => console.log(`   ${i + 1}. ${q}`));

  console.log('\n✅  Smoke test complete.\n');
}

main().catch(err => {
  console.error('❌  Fatal:', err.message);
  process.exit(1);
});
