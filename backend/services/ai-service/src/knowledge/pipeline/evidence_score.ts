import type { NormalizedResearchRecord } from '../types';

export function scoreEvidence(record: NormalizedResearchRecord): NormalizedResearchRecord {
  const text = `${record.title} ${record.abstract_or_summary} ${record.journal || ''}`.toLowerCase();
  const reasons: string[] = [];
  let score = 0.45;

  if (/guideline|position stand|consensus/.test(text)) { score += 0.25; reasons.push('guideline_or_consensus'); }
  if (/systematic review|meta-analysis|meta analysis/.test(text)) { score += 0.25; reasons.push('systematic_review_or_meta_analysis'); }
  if (/randomized|controlled trial/.test(text)) { score += 0.12; reasons.push('controlled_trial'); }
  if (record.doi || record.pmid) { score += 0.08; reasons.push('stable_identifier'); }
  if (record.year && record.year >= 2015) { score += 0.05; reasons.push('recent_enough'); }
  if (record.source === 'Crossref' || record.source === 'OpenAlex') { reasons.push('metadata_only_source'); }
  if (!record.abstract_or_summary || record.abstract_or_summary.length < 80) { score -= 0.18; reasons.push('thin_abstract_or_summary'); }
  if (/blog|opinion|forum/.test(text)) { score -= 0.2; reasons.push('low_trust_content_type'); }

  return {
    ...record,
    evidence_score: Math.max(0, Math.min(1, Number(score.toFixed(3)))),
    evidence_score_reason: reasons,
  };
}
