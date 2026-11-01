/** Trusted repository pins, independent of mutable search payload/sourceClass. */
import fs from "node:fs";
import path from "node:path";
import { z } from "zod";
import { digest } from "../evaluation-kit/identity";
import type { Passage } from "./retrieval";
const Registry = z.object({ version: z.literal("dev-source-registry-v1"), authority: z.literal("ENGINEERING_IDENTITY_PIN_NOT_EXPERT_APPROVAL"), entries: z.array(z.object({ sourceId: z.string(), metadataHash: z.string(), reviewStatus: z.literal("PENDING_SOURCE_REVIEW"), origin: z.literal("HISTORICAL_ASSISTANT_ABSTRACT_CHECK"), excerpts: z.array(z.object({ id: z.string(), textHash: z.string() }).strict()) }).strict()) }).strict();
const registry = Registry.parse(JSON.parse(fs.readFileSync(path.resolve(__dirname, "../../../../../../data/eval/ai-coach-dev/source-registry.json"), "utf8")));
export function registeredScientificExcerpt(p: Passage, e: Passage["excerpts"][number]): boolean {
  const s = p.source, entry = registry.entries.find((r) => r.sourceId === s.id);
  return s.sourceClass === "CURATED_EVIDENCE" && e.authorship === "ORIGINAL_SCIENTIFIC_EXCERPT" && !!entry
    && entry.metadataHash === digest({ id: s.id, title: s.title, doi: s.doi, url: s.url, year: s.year })
    && entry.excerpts.some((r) => r.id === e.id && r.textHash === digest(e.text));
}
export const sourceReviewStatus = "PENDING_SOURCE_REVIEW";
