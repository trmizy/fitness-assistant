// Phase 3 (local Qwen3 4B semantic fine-tune) — exports the REAL enum arrays
// from conversational-intelligence/schema.ts to JSON, so the Python training
// pipeline never hand-duplicates them (task's own rule: "do not manually
// duplicate enums where they can be exported/generated from the TypeScript
// source"). Run after any schema.ts change; the Python dataset
// validator/evaluator import the JSON this writes, not a hand-mirrored copy.
import fs from "node:fs";
import path from "node:path";
import {
  ENTITY_TYPES, GOALS, PRIMARY_INTENTS, WORKFLOW_INTENTS, REQUESTED_ACTIONS, REFERENCE_KINDS,
} from "../conversational-intelligence/schema";

const out = {
  ENTITY_TYPES, GOALS, PRIMARY_INTENTS, WORKFLOW_INTENTS, REQUESTED_ACTIONS, REFERENCE_KINDS,
  CORRECTION_FIELDS: [...ENTITY_TYPES, "GOAL"],
  NEGATION_TARGETS: [...ENTITY_TYPES, "GOAL", "ACTION"],
  exportedAt: new Date().toISOString(),
  sourceFile: "backend/services/ai-service/src/conversational-intelligence/schema.ts",
};

const outPath = path.resolve(__dirname, "../../../../../training/semantic-qwen3-4b/datasets/semantic_schema_enums.json");
fs.writeFileSync(outPath, JSON.stringify(out, null, 2), "utf-8");
console.log(`wrote ${outPath}`);
console.log(JSON.stringify(out, null, 2));
