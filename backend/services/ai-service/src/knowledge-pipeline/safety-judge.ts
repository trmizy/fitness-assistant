import { logger } from '@gym-coach/shared';
import { llmService } from '../services/llm.service';
import type { RawKnowledgeDocument } from './types';

export type SafetyJudgeResult = {
  safe: boolean;
  reason: string;
  category: string;
};

const SAFETY_JUDGE_PROMPT = `
You are a health and fitness content safety reviewer.
Review the document excerpt for dangerous medical advice, unsafe supplement/drug advice,
extreme weight loss advice, or disguised sales/affiliate content.

Return ONLY JSON with this shape:
{"safe": true|false, "reason": "...", "category": "medical|supplement|extreme_weight_loss|sales|none"}
`.trim();

export function parseSafetyJudgeResponse(raw: string): SafetyJudgeResult | null {
  const match = raw.match(/\{[\s\S]*\}/);
  if (!match) return null;

  try {
    const parsed = JSON.parse(match[0]) as Partial<SafetyJudgeResult>;
    if (typeof parsed.safe !== 'boolean') return null;
    return {
      safe: parsed.safe,
      reason: typeof parsed.reason === 'string' ? parsed.reason : '',
      category: typeof parsed.category === 'string' ? parsed.category : (parsed.safe ? 'none' : 'unknown'),
    };
  } catch {
    return null;
  }
}

export async function judgeDocumentSafety(doc: RawKnowledgeDocument): Promise<SafetyJudgeResult | null> {
  const excerpt = [
    `Title: ${doc.title}`,
    `URL: ${doc.url}`,
    `Tags: ${doc.tags.join(', ')}`,
    '',
    doc.cleanText.slice(0, 2500),
  ].join('\n');

  try {
    const response = await llmService.callLLM(`${SAFETY_JUDGE_PROMPT}\n\n[DOCUMENT]\n${excerpt}`, {
      responseFormat: 'json',
      timeoutMs: Number.parseInt(process.env.KNOWLEDGE_SAFETY_JUDGE_TIMEOUT_MS || '30000', 10),
      temperature: 0,
      numPredict: 200,
    });
    return parseSafetyJudgeResponse(response.answer);
  } catch (err) {
    logger.warn({ err, url: doc.url }, 'LLM safety judge skipped');
    return null;
  }
}
