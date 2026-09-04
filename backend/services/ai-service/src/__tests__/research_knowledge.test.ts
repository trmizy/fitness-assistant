import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import assert from "node:assert/strict";
import {
  researchSources,
  validateSourceRegistry,
} from "../knowledge/source_registry";
import { normalizeResearchRecord } from "../knowledge/pipeline/normalize";
import { deduplicateResearchRecords } from "../knowledge/pipeline/deduplicate";
import { scoreEvidence } from "../knowledge/pipeline/evidence_score";
import { chunkResearchRecord } from "../knowledge/pipeline/chunk";
import {
  shouldRequireReview,
  toReviewQueueRecord,
} from "../knowledge/pipeline/review_queue";
import {
  buildCoachContext,
  sanitizeCoachContextForPrompt,
} from "../coach/coach_context_builder";
import type { NormalizedResearchRecord } from "../knowledge/types";

function record(
  overrides: Partial<NormalizedResearchRecord> = {},
): NormalizedResearchRecord {
  return {
    external_id: "pmid:1",
    title: "Resistance training volume systematic review",
    abstract_or_summary:
      "This systematic review summarizes resistance training volume and hypertrophy outcomes in adults.",
    source: "PubMed",
    source_url: "https://pubmed.ncbi.nlm.nih.gov/1/",
    doi: "10.1000/example",
    pmid: "1",
    authors: ["A Researcher"],
    journal: "Sports Medicine",
    publisher: "NCBI PubMed",
    year: 2020,
    date: "2020",
    license: "metadata",
    access_status: "abstract",
    topic: "hypertrophy_training_volume",
    raw_metadata: {},
    fetched_at: "2026-07-08T00:00:00.000Z",
    ...overrides,
  };
}

test("research source registry is valid and web sources require robots policy", () => {
  assert.deepEqual(validateSourceRegistry(), []);
  const webSources = researchSources.filter(
    (source) => source.type === "webpage",
  );
  assert.ok(webSources.length > 0);
  assert.ok(webSources.every((source) => source.robots_policy_required));
});

test("research normalization adds stable hashes and dedup removes DOI/PMID/title duplicates", () => {
  const first = normalizeResearchRecord(record());
  const duplicate = normalizeResearchRecord(
    record({ external_id: "pmid:2", pmid: "2" }),
  );
  const unique = normalizeResearchRecord(
    record({
      external_id: "pmid:3",
      pmid: "3",
      doi: "10.1000/other",
      title: "Protein intake resistance training meta analysis",
    }),
  );

  assert.ok(first.content_hash);
  assert.equal(
    deduplicateResearchRecords([first, duplicate, unique]).length,
    2,
  );
});

test("evidence scoring gives transparent reasons and chunking preserves citation metadata", () => {
  const scored = scoreEvidence(normalizeResearchRecord(record()));
  assert.ok((scored.evidence_score ?? 0) >= 0.65);
  assert.ok(
    scored.evidence_score_reason?.includes(
      "systematic_review_or_meta_analysis",
    ),
  );

  const chunks = chunkResearchRecord(scored, 80);
  assert.ok(chunks.length >= 1);
  assert.equal(chunks[0].metadata.title, scored.title);
  assert.equal(chunks[0].metadata.source_url, scored.source_url);
  assert.equal(chunks[0].metadata.pmid, scored.pmid);
});

test("review queue requires review for weak web or thin metadata records", () => {
  const weak = scoreEvidence(
    normalizeResearchRecord(
      record({
        external_id: "web:https://example.org/page",
        source: "Allowlisted Webpage",
        source_url: "https://example.org/page",
        doi: undefined,
        pmid: undefined,
        abstract_or_summary: "Short.",
      }),
    ),
  );
  assert.equal(shouldRequireReview(weak), true);
  assert.equal(toReviewQueueRecord(weak).status, "pending");
});

test("sanitized coach context does not expose raw user identity or private contact fields", () => {
  const context = buildCoachContext({
    userId: "user-private-id",
    profile: {
      age: 31,
      gender: "MALE",
      heightCm: 175,
      currentWeightKg: 82,
      goal: "WEIGHT_LOSS",
      training: {
        availableEquipment: [],
        injuries: [],
        preferredTrainingDays: [1, 3, 5],
      } as any,
    },
  });
  const promptContext = JSON.stringify(sanitizeCoachContextForPrompt(context));
  assert.equal(promptContext.includes("user-private-id"), false);
  assert.equal(promptContext.includes("@"), false);
});
function loadFixture(name: string): NormalizedResearchRecord {
  const filePath = path.resolve(
    process.cwd(),
    "../../../data/research/fixtures",
    name,
  );
  return JSON.parse(
    fs.readFileSync(filePath, "utf8"),
  ) as NormalizedResearchRecord;
}

test("research fixtures normalize offline connector samples without external fetch", () => {
  const fixtures = [
    loadFixture("pubmed_sample.json"),
    loadFixture("crossref_sample.json"),
    loadFixture("openalex_sample.json"),
    loadFixture("webpage_sample.json"),
  ].map((item) => scoreEvidence(normalizeResearchRecord(item)));

  assert.equal(fixtures.length, 4);
  assert.ok(fixtures.every((item) => item.content_hash && item.checksum));
  assert.ok(fixtures.some((item) => item.source === "PubMed" && item.pmid));
  assert.ok(fixtures.some((item) => item.source === "Crossref" && item.doi));
  assert.ok(fixtures.some((item) => item.source === "OpenAlex"));
});

test("research review policy keeps web fixtures out of auto-index path", () => {
  const web = scoreEvidence(
    normalizeResearchRecord(loadFixture("webpage_sample.json")),
  );
  const pubmed = scoreEvidence(
    normalizeResearchRecord(loadFixture("pubmed_sample.json")),
  );

  assert.equal(shouldRequireReview(web), true);
  assert.equal(toReviewQueueRecord(web).status, "pending");
  assert.equal(shouldRequireReview(pubmed), false);
  assert.equal(toReviewQueueRecord(pubmed).status, "approved");
});
