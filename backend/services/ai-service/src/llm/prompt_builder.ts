import type { InputIntent, RecommendationResult, ResponseLanguage, RetrievalResult, UserProfile } from './types';

function compactProfile(profile: UserProfile): string {
  const lines: string[] = [
    `- Age: ${profile.age ?? 'unknown'}`,
    `- Gender: ${profile.gender ?? 'unknown'}`,
    `- Height(cm): ${profile.heightCm ?? 'unknown'}`,
    `- Weight(kg): ${profile.currentWeightKg ?? profile.inBody?.weightKg ?? 'unknown'}`,
    `- Goal: ${profile.goal ?? 'unknown'}`,
    `- Activity level: ${profile.activityLevel ?? 'unknown'}`,
    `- Experience level: ${profile.experienceLevel ?? 'BEGINNER'}`,
  ];

  if (profile.inBody) {
    lines.push(`- Body fat(%): ${profile.inBody.bodyFatPct ?? 'unknown'}`);
    lines.push(`- Skeletal muscle(kg): ${profile.inBody.skeletalMuscleKg ?? 'unknown'}`);
  }

  if (profile.training.injuries.length > 0) {
    lines.push(`- Injuries/limitations: ${profile.training.injuries.join(', ')}`);
  }

  if (profile.training.availableEquipment.length > 0) {
    lines.push(`- Equipment access: ${profile.training.availableEquipment.join(', ')}`);
  }

  if (profile.training.trainingDaysPerWeek) {
    lines.push(`- Training days/week: ${profile.training.trainingDaysPerWeek}`);
  }

  if (profile.foodPreference) {
    lines.push(`- Food preference: ${profile.foodPreference}`);
  }

  return lines.join('\n');
}

function compactRetrieval(result: RetrievalResult): string {
  if (result.isEmpty || result.documents.length === 0) {
    return '- No relevant context was retrieved. Use conservative recommendations and clearly state assumptions.';
  }

  return result.documents
    .slice(0, 6)
    .map((doc, idx) => {
      const source = doc.metadata.source_file || doc.category || 'unknown';
      return `${idx + 1}. [${source}] score=${doc.score.toFixed(3)}\n${doc.pageContent}`;
    })
    .join('\n\n');
}

function compactRecommendations(recommendation: RecommendationResult): string {
  const n = recommendation.nutrition;
  const w = recommendation.workout;
  const m = recommendation.meal;

  const lines = [
    `Objective: ${recommendation.objective}`,
    `Calories target: ${n.targetCalories}`,
    `Macros grams/day: protein=${n.proteinGrams}, carbs=${n.carbsGrams}, fats=${n.fatGrams}`,
    `Nutrition confidence: ${n.confidence}`,
    `Workout split: ${w.split}`,
    `Workout sessions/week: ${w.sessionsPerWeek}`,
    `Workout focus: ${w.focus.join(', ')}`,
    `Workout avoid patterns: ${w.avoidedPatterns.length > 0 ? w.avoidedPatterns.join(', ') : 'none'}`,
    `Meal template: ${m.template}`,
    `Meal preference: ${m.preference || 'none'}`,
    `Assumptions: ${recommendation.assumptions.length > 0 ? recommendation.assumptions.join(' | ') : 'none'}`,
    `Missing fields: ${recommendation.missingFields.length > 0 ? recommendation.missingFields.join(', ') : 'none'}`,
  ];

  return lines.join('\n');
}

export const promptBuilder = {
  build(
    inputQuestion: string,
    intent: InputIntent,
    profile: UserProfile,
    retrieval: RetrievalResult,
    recommendation: RecommendationResult,
    responseLanguage: ResponseLanguage,
  ): string {
    return [
      'You are a professional fitness and nutrition coach. Prioritize deterministic recommendation results over creative generation.',
      'Rules:',
      '- Answer the user question directly first. Do not ask clarifying questions before giving a useful answer.',
      '- If key data is missing, still provide a safe default template first, then ask follow-up questions at the end.',
      '- Do not expose internal labels like recomposition, confidence, strength_retention, moderate_volume, omnivorous.',
      `- Response language must be ${responseLanguage}. Do not mix languages.`,
      '- Do not invent exercises or medical claims unsupported by context.',
      '- Keep answer practical, concise, and actionable.',
      '- Keep nutrition numbers consistent with provided deterministic targets.',
      '',
      'User question:',
      inputQuestion,
      '',
      'Parsed intent:',
      JSON.stringify(intent),
      '',
      'User profile context:',
      compactProfile(profile),
      '',
      'Deterministic recommendation result (single source of truth):',
      compactRecommendations(recommendation),
      '',
      'Retrieved knowledge snippets:',
      compactRetrieval(retrieval),
      '',
      'Output format:',
      '- Brief personalized summary',
      '- Workout recommendation (days/split/focus)',
      '- Nutrition recommendation (calories and macros)',
      '- Practical next steps for this week',
      '- Follow-up questions if needed',
    ].join('\n');
  },
};
