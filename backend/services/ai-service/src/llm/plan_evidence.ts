import type { BodyCompAnalysis } from './body_composition_rules';
import type { EvidenceUsed, RetrievalDocument, UserProfile } from './types';

export type PlanEvidenceBundle = {
  adjustment_reason: BodyCompAnalysis['adjustments'];
  evidence_used: EvidenceUsed[];
  safety_notes: string[];
};

export function evidenceUsedFromDocs(docs: RetrievalDocument[]): EvidenceUsed[] {
  const seen = new Set<string>();
  const evidence: EvidenceUsed[] = [];

  for (const doc of docs) {
    const metadata = doc.metadata ?? {};
    const sourceUrl = typeof metadata.source_url === 'string' ? metadata.source_url.trim() : '';
    const title = typeof metadata.title === 'string' ? metadata.title.trim() : '';
    const sourceType = typeof metadata.source_type === 'string' ? metadata.source_type.trim() : 'curated_summary';

    if (!sourceUrl || !title) continue;

    const key = `${title}|${sourceUrl}`;
    if (seen.has(key)) continue;
    seen.add(key);

    evidence.push({
      title,
      source_url: sourceUrl,
      category: typeof metadata.category === 'string' ? metadata.category : doc.category,
      source_type: sourceType,
      summary: doc.pageContent.replace(/\s+/g, ' ').slice(0, 240),
    });
  }

  return evidence;
}

export function buildPlanEvidenceBundle(
  analysis: BodyCompAnalysis,
  evidenceDocs: RetrievalDocument[],
): PlanEvidenceBundle {
  return {
    adjustment_reason: analysis.adjustments.map((item) => ({
      metric: item.metric,
      observed_value: item.observed_value,
      interpretation: item.interpretation,
      plan_adjustment: item.plan_adjustment,
    })),
    evidence_used: evidenceUsedFromDocs(evidenceDocs),
    safety_notes: [...analysis.safetyNotes, ...analysis.dataQualityNotes],
  };
}

export function attachEvidenceToPlanContent<T extends Record<string, any>>(
  content: T,
  bundle: PlanEvidenceBundle,
): T {
  const target = content as Record<string, any>;
  target.adjustment_reason = bundle.adjustment_reason;
  target.evidence_used = bundle.evidence_used;
  target.safety_notes = bundle.safety_notes;

  // Camel-case aliases are additive for TypeScript consumers that already use that naming style.
  target.adjustmentReasons = bundle.adjustment_reason;
  target.evidenceUsed = bundle.evidence_used;
  target.safetyNotes = bundle.safety_notes;

  target._metadata = target._metadata || {};
  target._metadata.evidenceApplied = true;
  target._metadata.evidenceSourcePolicy = 'retriever_metadata_only';

  return content;
}

export function formatEvidenceForPlanPrompt(docs: RetrievalDocument[]): string {
  if (docs.length === 0) return 'No retrieved evidence passed the similarity threshold.';

  return docs.slice(0, 4).map((doc, index) => {
    const metadata = doc.metadata ?? {};
    return [
      `E${index + 1}: ${metadata.title || 'Untitled evidence'}`,
      `source_type: ${metadata.source_type || 'curated_summary'}`,
      `source_url: ${metadata.source_url || 'unknown'}`,
      `category: ${doc.category}`,
      `summary: ${doc.pageContent.replace(/\s+/g, ' ').slice(0, 420)}`,
    ].join('\n');
  }).join('\n\n');
}

export function formatMockProfileForPlanPrompt(profile: UserProfile, recentWorkoutLogs: unknown[] = []): string {
  const lines = [
    `age=${profile.age ?? 'unknown'}`,
    `heightCm=${profile.heightCm ?? 'unknown'}`,
    `weightKg=${profile.currentWeightKg ?? 'unknown'}`,
    `goal=${profile.goal ?? 'unknown'}`,
    `activityLevel=${profile.activityLevel ?? 'unknown'}`,
    `experience=${profile.experienceLevel ?? 'unknown'}`,
    `BMI=${profile.inBody?.bmi ?? 'unknown'}`,
    `bodyFatPct=${profile.inBody?.bodyFatPct ?? 'unknown'}`,
    `muscleMassKg=${profile.inBody?.skeletalMuscleKg ?? 'unknown'}`,
    `injuries=${profile.training.injuries.join(', ') || 'none'}`,
  ];

  if (recentWorkoutLogs.length > 0) {
    lines.push(`recentWorkoutLogs=${JSON.stringify(recentWorkoutLogs)}`);
  }

  return lines.join('\n');
}
