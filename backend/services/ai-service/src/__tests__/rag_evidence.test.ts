import test from "node:test";
import assert from "node:assert/strict";
import { retrievalDocumentFromPayload } from "../llm/retriever";
import { evidenceUsedFromDocs } from "../llm/plan_evidence";
import { llmOrchestrator } from "../llm/orchestrator.service";
import { conversationRepository } from "../repositories/conversation.repository";
import { ragService } from "../services/rag.service";
import type {
  FinalAnswerPayload,
  RecommendationResult,
  RetrievalDocument,
} from "../llm/types";

const originalRun = llmOrchestrator.run;
const originalCreate = conversationRepository.create;
const originalCreateSession = conversationRepository.createSession;
const originalTouchSessionLastMessage =
  conversationRepository.touchSessionLastMessage;

function baseRecommendation(): RecommendationResult {
  return {
    objective: "general_fitness_knowledge",
    nutrition: { formula: "none", confidence: "low" },
    workout: {
      split: "none",
      sessionsPerWeek: 0,
      focus: [],
      avoidedPatterns: [],
      assumptions: [],
    },
    meal: { template: "none", dailyMeals: 0, assumptions: [] },
    assumptions: [],
    missingFields: [],
  };
}

function basePayload(
  overrides: Partial<FinalAnswerPayload> = {},
): FinalAnswerPayload {
  return {
    traceId: "trace-evidence-1",
    answer: "Protein guidance should cite retrieved evidence.",
    responseLanguage: "en",
    usedFallback: false,
    usedDeterministicFallbackBecauseOfValidation: false,
    missingFields: [],
    retrieval: { documents: [], isEmpty: false },
    recommendation: baseRecommendation(),
    finalPrompt: "",
    validationNotes: [],
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    routeIntent: "general_fitness_knowledge",
    warningCount: 0,
    explicitLanguageLock: false,
    ...overrides,
  };
}

test.afterEach(() => {
  llmOrchestrator.run = originalRun;
  conversationRepository.create = originalCreate;
  conversationRepository.createSession = originalCreateSession;
  conversationRepository.touchSessionLastMessage =
    originalTouchSessionLastMessage;
});

test("retriever maps knowledge pipeline evidence payload aliases into citation metadata", () => {
  const doc = retrievalDocumentFromPayload(
    "fitness_evidence",
    {
      title: "ISSN protein position stand",
      text: "Daily protein intake can be expressed in grams per kilogram of body weight.",
      topic: "NUTRITION",
      source_url: "https://doi.org/10.1186/example",
      source_type: "paper",
      source_name: "Curated Local Evidence JSONL",
      source_tier: 1,
      trust_score: 0.92,
      quality_score: 0.88,
      language: "en",
      document_id: "doc-1",
      chunk_id: "doc-1:0",
    },
    0.82,
    "point-1",
  );

  assert.equal(doc.source, "qdrant:fitness_evidence");
  assert.equal(doc.category, "nutrition");
  assert.match(doc.pageContent, /ISSN protein position stand/);
  assert.match(doc.pageContent, /Daily protein intake/);
  assert.equal(doc.metadata.source_url, "https://doi.org/10.1186/example");
  assert.equal(doc.metadata.source_type, "paper");
  assert.equal(doc.metadata.topic, "NUTRITION");
  assert.equal(doc.metadata.source_name, "Curated Local Evidence JSONL");
  assert.equal(doc.metadata.trust_score, 0.92);
});

test("ragService exposes evidenceUsed returned by the orchestrator", async () => {
  const evidenceDoc: RetrievalDocument = retrievalDocumentFromPayload(
    "fitness_evidence",
    {
      title: "Protein and resistance training",
      text: "Resistance-trained adults often benefit from adequate protein intake.",
      topic: "NUTRITION",
      source_url: "https://doi.org/10.1000/protein",
      source_type: "paper",
      chunk_id: "doc-2:0",
    },
    0.9,
    "point-2",
  );

  llmOrchestrator.run = async () =>
    basePayload({
      retrieval: { documents: [evidenceDoc], isEmpty: false },
      evidenceUsed: evidenceUsedFromDocs([evidenceDoc]),
    });

  conversationRepository.create = (() =>
    ({ id: "conversation-1" }) as any) as typeof conversationRepository.create;
  conversationRepository.createSession = (() =>
    ({ id: "session-1" }) as any) as typeof conversationRepository.createSession;
  conversationRepository.touchSessionLastMessage = (() =>
    Promise.resolve(
      {} as any,
    )) as typeof conversationRepository.touchSessionLastMessage;

  const result = await ragService.rag(
    "How much protein do I need?",
    "user-1",
    "Bearer token",
  );

  assert.equal(result.conversationId, "conversation-1");
  assert.equal(result.evidenceUsed?.length, 1);
  assert.equal(
    result.evidenceUsed?.[0]?.title,
    "Protein and resistance training",
  );
  assert.equal(
    result.evidenceUsed?.[0]?.source_url,
    "https://doi.org/10.1000/protein",
  );
});
