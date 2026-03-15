import { logger } from '@gym-coach/shared';
import { llmService, LLM_MODEL } from './llm.service';
import { conversationRepository } from '../repositories/conversation.repository';
import { getQdrantClient } from '../repositories/qdrant';
import type { SearchResult, RelevanceEval } from '../models/ai.models';

const COLLECTION_NAME = 'exercises';

const PROMPT_TEMPLATE = `
You're a fitness instructor. Answer the QUESTION based on the CONTEXT from our exercises database.
Use only the facts from the CONTEXT when answering the QUESTION.

QUESTION: {question}

CONTEXT:
{context}
`.trim();

const EVALUATION_PROMPT = `
You are an expert evaluator for a RAG system.
Your task is to analyze the relevance of the generated answer to the given question.
Based on the relevance of the generated answer, you will classify it
as "NON_RELEVANT", "PARTLY_RELEVANT", or "RELEVANT".

Question: {question}
Generated Answer: {answer}

Please analyze the content and context of the generated answer in relation to the question
and provide your evaluation in parsable JSON:

{
  "Relevance": "NON_RELEVANT" | "PARTLY_RELEVANT" | "RELEVANT",
  "Explanation": "[Provide a brief explanation for your evaluation]"
}
`.trim();

async function searchExercises(
  query: string,
  numResults = 10,
): Promise<SearchResult[]> {
  try {
    const queryVector = await llmService.generateEmbedding(query);
    const searchResults = await getQdrantClient().search(COLLECTION_NAME, {
      vector: queryVector,
      limit: numResults,
    });
    return searchResults.map((result: any) => ({
      ...result.payload,
      score: result.score,
    }));
  } catch (error) {
    logger.error('Error searching exercises:', error);
    return [];
  }
}

function buildPrompt(question: string, searchResults: SearchResult[]): string {
  const context = searchResults
    .map(
      (doc) =>
        `exercise_name: ${doc.exerciseName}
type_of_activity: ${doc.typeOfActivity}
type_of_equipment: ${doc.typeOfEquipment}
body_part: ${doc.bodyPart}
type: ${doc.type}
muscle_groups_activated: ${doc.muscleGroupsActivated}
instructions: ${doc.instructions}`.trim(),
    )
    .join('\n\n');

  return PROMPT_TEMPLATE.replace('{question}', question).replace(
    '{context}',
    context,
  );
}

async function evaluateRelevance(
  question: string,
  answer: string,
): Promise<RelevanceEval> {
  try {
    const prompt = EVALUATION_PROMPT.replace('{question}', question).replace(
      '{answer}',
      answer,
    );
    const result = await llmService.callLLM(prompt);
    const jsonMatch = result.answer.match(/\{[\s\S]*\}/);
    if (jsonMatch) return JSON.parse(jsonMatch[0]);
  } catch {
    // ignore parse errors
  }
  return { Relevance: 'UNKNOWN', Explanation: 'Failed to parse evaluation' };
}

export const ragService = {
  async rag(question: string, userId?: string) {
    const startTime = Date.now();

    const searchResults = await searchExercises(question);
    const prompt = buildPrompt(question, searchResults);
    const llmResponse = await llmService.callLLM(prompt);
    const relevanceEval = await evaluateRelevance(question, llmResponse.answer);
    const responseTime = (Date.now() - startTime) / 1000;

    const conversation = await conversationRepository.create({
      userId,
      question,
      answer: llmResponse.answer,
      modelUsed: LLM_MODEL,
      responseTime,
      relevance: relevanceEval.Relevance,
      relevanceExplanation: relevanceEval.Explanation,
      promptTokens: llmResponse.promptTokens,
      completionTokens: llmResponse.completionTokens,
      totalTokens: llmResponse.totalTokens,
      cost: 0,
    });

    return {
      conversationId: conversation.id,
      question,
      answer: llmResponse.answer,
      modelUsed: LLM_MODEL,
      responseTime,
      relevance: relevanceEval.Relevance,
      relevanceExplanation: relevanceEval.Explanation,
      promptTokens: llmResponse.promptTokens,
      completionTokens: llmResponse.completionTokens,
      totalTokens: llmResponse.totalTokens,
    };
  },
};
