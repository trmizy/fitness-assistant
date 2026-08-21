/**
 * Regression test for a real encoding-corruption bug found during the
 * AI-nutrition investigation (Part 1's "Có lỗi encoding tiếng Việt trong
 * conversation title/history hay không?" check): plan.controller.ts had
 * 12 Vietnamese string literals corrupted into mojibake (U+FFFD replacement
 * characters and stray '?' in place of diacritics — e.g. "K? ho?ch n�y d�
 * du?c ?n..." instead of "Kế hoạch này đã được ẩn..."), user-facing in
 * error messages and LLM prompts. This scans the user-facing controller/
 * service source files for the U+FFFD replacement character so a future
 * bad save/find-replace is caught by CI instead of shipping garbled text.
 */
import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";

const REPLACEMENT_CHAR = "�";

// Source directories most likely to carry user-facing Vietnamese strings
// (controllers, LLM prompt/response builders) — not exhaustive of the
// whole repo (test-run cost), but covers exactly the class of file where
// this bug was found.
const SCAN_DIRS = [
  path.resolve(__dirname, "../controllers"),
  path.resolve(__dirname, "../llm"),
  path.resolve(__dirname, "../services"),
];

function listTsFiles(dir: string): string[] {
  if (!fs.existsSync(dir)) return [];
  return fs
    .readdirSync(dir, { withFileTypes: true })
    .flatMap((entry) => {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) return listTsFiles(full);
      return entry.name.endsWith(".ts") ? [full] : [];
    });
}

test("no source file under controllers/llm/services contains the UTF-8 replacement character (mojibake regression guard)", () => {
  const offenders: string[] = [];
  for (const dir of SCAN_DIRS) {
    for (const file of listTsFiles(dir)) {
      const content = fs.readFileSync(file, "utf-8");
      if (content.includes(REPLACEMENT_CHAR)) {
        offenders.push(path.relative(path.resolve(__dirname, "../.."), file));
      }
    }
  }
  assert.deepEqual(
    offenders,
    [],
    `found mojibake (U+FFFD) in: ${offenders.join(", ")} — Vietnamese text was corrupted, likely by a non-UTF-8 save or a broken find/replace`,
  );
});
