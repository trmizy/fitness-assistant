/**
 * V2.3A.8.1 step 7: read-only inspection of the real interpretDeterministic()
 * output for every "cat: references" row in the ai-service backend test
 * corpus (test/conversational-intelligence/corpus.json). Used only to
 * confirm actual runtime behavior before touching any corpus gold — does
 * not modify anything.
 */
import fs from "fs";
import path from "path";
import { interpretDeterministic } from "../../../backend/services/ai-service/src/conversational-intelligence/interpreter";

const corpusPath = path.resolve(__dirname, "../../../test/conversational-intelligence/corpus.json");
const data = JSON.parse(fs.readFileSync(corpusPath, "utf8"));
const refCases = data.filter((c: any) => c.exp && c.exp.ref);

for (const c of refCases) {
  const i = interpretDeterministic(c.text, {
    expectedSlot: c.ctx.slot ?? null,
    persisted: c.ctx.cw ? { currentWeightKg: c.ctx.cw } : {},
    proposal: c.ctx.proposal ?? null,
  });
  console.log(JSON.stringify({
    id: c.id,
    text: c.text,
    expectedRef: c.exp.ref,
    gotReferences: i.references,
    ambiguities: i.ambiguities,
    clarificationRequired: i.clarificationRequired,
    primaryIntent: i.primaryIntent,
    requestedAction: i.requestedAction,
    confidence: i.confidence,
  }));
}
