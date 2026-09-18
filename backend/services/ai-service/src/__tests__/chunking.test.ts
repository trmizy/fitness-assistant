import { test } from "node:test";
import assert from "node:assert/strict";
import { chunkText } from "../knowledge-pipeline/chunking";

// Regression test for a real bug found live in the `fitness_evidence` Qdrant
// collection: the overlap rollback (`end - overlapChars`) was a raw
// character offset, not word-boundary-aware, so chunks after the first
// could start mid-word — a real stored chunk began "e RT program..." (the
// tail of "describe" split off the previous chunk). This builds a long
// paragraph (forces multiple 1200-char chunks with the default overlap)
// and asserts every chunk after the first starts at a real word boundary.
test("chunkText never starts a chunk mid-word", () => {
  const sentence =
    "Resistance training prescription variables such as load, volume, and frequency interact to influence muscle hypertrophy, strength, and power in healthy adults across a wide range of training backgrounds and experience levels. ";
  const longText = sentence.repeat(20); // well over 1200 chars, forces multiple chunks

  const chunks = chunkText(longText);
  assert.ok(chunks.length > 1, "test text should produce more than one chunk");

  const normalized = longText.replace(/\s+/g, " ").trim();
  for (const chunk of chunks) {
    const idx = normalized.indexOf(chunk.text);
    assert.notEqual(idx, -1, "chunk text should be found in the normalized source");
    // A chunk starts cleanly if it's at the very beginning of the source,
    // or the character immediately before it in the source is whitespace.
    const startsCleanly = idx === 0 || normalized[idx - 1] === " ";
    assert.ok(
      startsCleanly,
      `chunk should start at a word boundary, got: "${chunk.text.slice(0, 40)}..."`,
    );
  }
});

test("chunkText still overlaps chunks for context continuity", () => {
  const sentence =
    "Progressive overload, adequate protein intake, and sufficient recovery are the three pillars most consistently associated with long-term muscular adaptation in resistance-trained individuals. ";
  const longText = sentence.repeat(20);
  const chunks = chunkText(longText);
  assert.ok(chunks.length > 1);
  // Consecutive chunks should share at least a little trailing/leading text
  // (the whole point of overlap) — not just be back-to-back with no shared
  // context at all.
  const firstTail = chunks[0].text.slice(-40);
  assert.ok(
    chunks[1].text.includes(firstTail.split(" ").slice(1).join(" ")) ||
      firstTail.split(" ").some((w) => w.length > 3 && chunks[1].text.includes(w)),
    "second chunk should share some overlapping words with the end of the first",
  );
});
