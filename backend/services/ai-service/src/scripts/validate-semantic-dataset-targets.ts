// Phase 3 (local Qwen3 4B semantic fine-tune) — task §13: "every target must
// pass the actual TypeScript Zod schema." Reads a dataset JSONL and runs
// each row's `target` through the REAL SemanticInterpretationSchema.safeParse()
// — not a hand-mirrored Python re-implementation. Dataset generation is
// incomplete if any row fails this.
//
// Usage: npx tsx src/scripts/validate-semantic-dataset-targets.ts <path-to.jsonl> [more files...]
import fs from "node:fs";
import { SemanticInterpretationSchema } from "../conversational-intelligence/schema";

const files = process.argv.slice(2);
if (files.length === 0) {
  console.error("Usage: validate-semantic-dataset-targets.ts <file.jsonl> [more files...]");
  process.exit(2);
}

let totalRows = 0;
let failures = 0;

for (const file of files) {
  const lines = fs.readFileSync(file, "utf-8").split("\n").filter((l) => l.trim());
  for (const [i, line] of lines.entries()) {
    totalRows += 1;
    let row: any;
    try {
      row = JSON.parse(line);
    } catch (err) {
      failures += 1;
      console.log(`FAIL ${file}:${i + 1} invalid JSON: ${(err as Error).message}`);
      continue;
    }
    const result = SemanticInterpretationSchema.safeParse(row.target);
    if (!result.success) {
      failures += 1;
      console.log(`FAIL ${row.caseId ?? `${file}:${i + 1}`}: ${JSON.stringify(result.error.issues.map((iss) => ({ path: iss.path.join("."), message: iss.message })))}`);
    }
  }
}

console.log(`\n${totalRows - failures}/${totalRows} targets pass SemanticInterpretationSchema.safeParse()`);
if (failures > 0) {
  console.log(`${failures} FAILURE(S). Dataset generation is incomplete.`);
  process.exit(1);
}
console.log("PASS — every gold target validates against the real runtime schema.");
