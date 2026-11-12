/**
 * V1 RC1 (2026-11-12) — internal context leaked into user-facing answers (REAL HTTP/API, rc-verify-v1b):
 *   H-04  "Theo **E1**, deload nên được áp dụng khi…"   — "E1" is the prompt's internal evidence label
 *   B4-25 "Bạn có thể tham khảo các mẫu thực đơn ăn chay có sữa/trứng ở trên để lấy ý tưởng." — the RAG templates are never
 *         shown to the user
 * Internal provenance stays in logs/traces; the answer keeps its content and scientific grounding. Oracle: hand-written.
 */
import test from "node:test";
import assert from "node:assert/strict";
import { stripInternalReferences } from "../output_hygiene";
import { compactRetrieval } from "../prompt_builder";

test("H-04: 'Theo E1, …' loses the internal label, keeps the claim", () => {
  const r = stripInternalReferences("Theo **E1**, deload nên được áp dụng khi RPE trung bình tăng liên tục nhiều tuần.");
  assert.doesNotMatch(r.answer, /E1/);
  assert.match(r.answer, /^Deload nên được áp dụng khi RPE/);
});

test("bracketed / parenthesised evidence ids are removed in Vietnamese and English", () => {
  assert.equal(stripInternalReferences("Protein 1,6 g/kg là đủ (E2).").answer, "Protein 1,6 g/kg là đủ.");
  assert.equal(stripInternalReferences("According to E3, creatine is safe [E1].").answer, "Creatine is safe.");
});

test("B4-25: a reference to unseen templates ('các mẫu thực đơn … ở trên') is removed; the rest of the line stays", () => {
  const a = "- **Ăn chay có sữa/trứng**: Đây là cách dễ nhất để đủ protein. Bạn có thể tham khảo các mẫu thực đơn ăn chay có sữa/trứng ở trên để lấy ý tưởng.";
  const r = stripInternalReferences(a);
  assert.doesNotMatch(r.answer, /ở trên/);
  assert.match(r.answer, /Đây là cách dễ nhất để đủ protein\./);
});

test("'the documents/meal plans provided' (English) is removed too", () => {
  const r = stripInternalReferences("Eat enough protein. Based on the meal plans provided above, aim for 4 meals.");
  assert.doesNotMatch(r.answer, /provided/);
  assert.match(r.answer, /Eat enough protein\./);
});

test("controls: references to the answer's OWN earlier content, real citations and plain text are untouched", () => {
  const own = "## Bữa sáng\nYến mạch + sữa.\n\nNhư thực đơn ở trên, hãy giữ đủ đạm mỗi bữa.";
  assert.equal(stripInternalReferences(own).answer, own, "the menu IS above, in this answer");
  const cite = "Theo ISSN (Jäger 2017), 1,4–2,0 g/kg protein/ngày là phù hợp.";
  assert.equal(stripInternalReferences(cite).answer, cite);
  const plain = "Bài E-Z bar curl giúp giảm áp lực cổ tay.";
  assert.equal(stripInternalReferences(plain).answer, plain);
});

test("the prompt itself tells the model the evidence labels and templates are internal", () => {
  const text = compactRetrieval({ documents: [{ id: "e", pageContent: "Deload khi RPE tăng.", score: 0.6, source: "qdrant:fitness_evidence", category: "x", metadata: {} }], isEmpty: false } as any);
  assert.match(text, /không viết .*E1/i);
});
