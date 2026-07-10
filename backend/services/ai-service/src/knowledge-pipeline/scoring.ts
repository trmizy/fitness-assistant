import { KNOWLEDGE_PIPELINE } from "./config";
import type {
  KnowledgeDocumentTopic,
  ProcessedKnowledgeDocument,
  RawKnowledgeDocument,
} from "./types";

const topicPatterns: Array<{ topic: KnowledgeDocumentTopic; pattern: RegExp }> =
  [
    {
      topic: "BODY_COMPOSITION",
      pattern:
        /body composition|bioelectrical impedance|\bbia\b|body fat|fat-free mass|fat mass|skeletal muscle|muscle mass|\bbmi\b|obesity|waist circumference|inbody|phase angle|total body water|\btbw\b/i,
    },
    {
      topic: "INJURY",
      pattern:
        /injury|pain|rehab|contraindicat|joint|tendon|fracture|sprain|strain|arthritis|low back|knee pain|shoulder pain|chan thuong|dau/i,
    },
    {
      topic: "NUTRITION",
      pattern:
        /protein|diet|nutrition|carbohydrate|caffeine|creatine|macro|meal|calorie|dinh duong|dam/i,
    },
    {
      topic: "RECOVERY",
      pattern: /sleep|recovery|fatigue|rest|hydration|phuc hoi|ngu/i,
    },
    {
      topic: "TRAINING",
      pattern:
        /resistance|strength|training|aerobic|exercise|hypertrophy|workout|physical activity|tap luyen/i,
    },
  ];

const unsafePatterns: Array<{ reason: string; pattern: RegExp }> = [
  {
    reason: "dangerous_medical_claim",
    pattern:
      /cure (cancer|diabetes|kidney|heart disease)|stop taking (medicine|medication)|ngung thuoc|chua khoi ung thu/i,
  },
  {
    reason: "extreme_weight_loss",
    pattern:
      /(lose|drop|giam)\s+\d{1,2}\s*(kg|kilograms|lbs|pounds|can)\s+(in|trong)\s+\d{1,2}\s*(day|days|ngay|week|weeks|tuan)/i,
  },
  {
    reason: "unsafe_drug_or_ped_advice",
    pattern:
      /anabolic steroid|trenbolone|clenbuterol|dnp|sarms|tiem steroid|dot mo cap toc/i,
  },
  {
    reason: "covert_sales_or_mlm",
    pattern:
      /limited time offer|buy now|discount code|affiliate link|multi-level marketing|mlm/i,
  },
];

function clampScore(value: number): number {
  return Math.max(0, Math.min(1, Number(value.toFixed(3))));
}

export function classifyTopic(
  doc: Pick<RawKnowledgeDocument, "title" | "cleanText" | "tags">,
): KnowledgeDocumentTopic {
  const haystack = [
    doc.title,
    doc.cleanText.slice(0, 1200),
    doc.tags.join(" "),
  ].join(" ");
  const match = topicPatterns.find((candidate) =>
    candidate.pattern.test(haystack),
  );
  return match?.topic ?? "GENERAL";
}

export function detectSafetyIssue(text: string): {
  unsafe: boolean;
  reason: string | null;
} {
  const hit = unsafePatterns.find((candidate) => candidate.pattern.test(text));
  return hit
    ? { unsafe: true, reason: hit.reason }
    : { unsafe: false, reason: null };
}

export function computeTrustScore(
  doc: RawKnowledgeDocument,
  sourceTrustTier: number,
): number {
  let score =
    ({ 1: 0.9, 2: 0.7, 3: 0.4 } as Record<number, number>)[sourceTrustTier] ??
    0.4;
  const evidence =
    `${doc.evidenceLevel ?? ""} ${doc.sourceType ?? ""}`.toLowerCase();

  if (
    doc.url.startsWith("https://doi.org") ||
    doc.url.includes("who.int") ||
    doc.url.includes("cdc.gov")
  )
    score += 0.05;
  if (
    /guideline|consensus|government|clinical|population_normative/.test(
      evidence,
    )
  )
    score += 0.05;
  if (doc.cleanText.length >= 500) score += 0.03;
  if (/affiliate|sponsored|buy now|discount/i.test(doc.cleanText)) score -= 0.3;
  if (detectSafetyIssue(doc.cleanText).unsafe) score -= 0.4;

  return clampScore(score);
}

export function computeQualityScore(doc: RawKnowledgeDocument): number {
  let score = 0.35;
  if (doc.cleanText.length >= 250) score += 0.2;
  if (doc.cleanText.length >= 700) score += 0.15;
  if (doc.title.length >= 8) score += 0.1;
  if (doc.tags.length > 0) score += 0.1;
  if (doc.url.startsWith("http")) score += 0.1;
  return clampScore(score);
}

export function processKnowledgeDocument(
  doc: RawKnowledgeDocument,
  sourceTrustTier: number,
): ProcessedKnowledgeDocument {
  const topic = classifyTopic(doc);
  const trustScore = computeTrustScore(doc, sourceTrustTier);
  const qualityScore = computeQualityScore(doc);
  const safety = detectSafetyIssue(doc.cleanText);
  const belowReview = trustScore < KNOWLEDGE_PIPELINE.reviewThreshold;
  const rejectionReason =
    safety.reason ??
    (belowReview ? "trust_score_below_review_threshold" : null);

  return {
    ...doc,
    topic,
    trustScore,
    qualityScore,
    safetyFlag: safety.unsafe,
    rejectionReason,
  };
}

export function statusForProcessedDocument(
  doc: ProcessedKnowledgeDocument,
): "accept" | "review" | "reject" {
  if (doc.safetyFlag || doc.trustScore < KNOWLEDGE_PIPELINE.reviewThreshold)
    return "reject";
  if (doc.trustScore < KNOWLEDGE_PIPELINE.acceptThreshold) return "review";
  return "accept";
}
