import type { ResearchTopic } from './types';

export const researchTopics: ResearchTopic[] = [
  { id: 'hypertrophy_training_volume', query: 'hypertrophy training volume resistance training systematic review', priority: 10, max_results: 10, min_year: 2015, source_preferences: ['pubmed', 'openalex', 'crossref'] },
  { id: 'strength_training_progression', query: 'strength training progression resistance training periodization', priority: 9, max_results: 10, min_year: 2015, source_preferences: ['pubmed', 'openalex'] },
  { id: 'fat_loss_nutrition', query: 'fat loss nutrition calorie deficit resistance training protein', priority: 10, max_results: 10, min_year: 2015, source_preferences: ['pubmed', 'openalex'] },
  { id: 'protein_intake_resistance_training', query: 'protein intake resistance training meta analysis muscle hypertrophy', priority: 10, max_results: 10, min_year: 2015, source_preferences: ['pubmed', 'crossref', 'openalex'] },
  { id: 'beginner_gym_program', query: 'beginner resistance training program guidelines adults', priority: 8, max_results: 8, min_year: 2010, source_preferences: ['pubmed', 'openalex'] },
  { id: 'deload_and_recovery', query: 'resistance training recovery deload fatigue management', priority: 7, max_results: 8, min_year: 2010, source_preferences: ['pubmed', 'openalex'] },
  { id: 'injury_risk_resistance_training', query: 'injury risk resistance training technique load management', priority: 9, max_results: 10, min_year: 2010, source_preferences: ['pubmed', 'openalex'] },
  { id: 'obesity_exercise_guidelines', query: 'obesity exercise guidelines resistance training aerobic adults', priority: 8, max_results: 8, min_year: 2010, source_preferences: ['pubmed', 'openalex'] },
  { id: 'creatine_evidence', query: 'creatine supplementation resistance training evidence safety position stand', priority: 7, max_results: 8, min_year: 2010, source_preferences: ['pubmed', 'crossref'] },
  { id: 'sleep_recovery_training', query: 'sleep recovery resistance training performance muscle', priority: 7, max_results: 8, min_year: 2010, source_preferences: ['pubmed', 'openalex'] },
  { id: 'inbody_bia_limitations', query: 'bioelectrical impedance analysis body composition limitations standardized conditions', priority: 10, max_results: 10, min_year: 2010, source_preferences: ['pubmed', 'openalex'] },
];

export function selectedResearchTopics(limit?: number): ResearchTopic[] {
  const sorted = [...researchTopics].sort((a, b) => b.priority - a.priority);
  return typeof limit === 'number' && limit > 0 ? sorted.slice(0, limit) : sorted;
}
