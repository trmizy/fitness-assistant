/**
 * Phase 9 — WB-12 AI Coach helpers. Shapes are the real ai-service responses (checked 22/9).
 *
 * Runs with: npx tsx --test src/features/__tests__/coach.test.ts
 */
import { describe, it } from "node:test";
import assert from "node:assert/strict";

import {
  agentErrorMessage,
  detectImageMediaType,
  greetingText,
  isDraftKey,
  mobileRouteForNextUrl,
  parseCoachText,
  parseInline,
  relativeTime,
  sessionMessagesToChat,
  suggestions,
  visibleEvidence,
  workflowItemText,
} from "../coach/coach";

describe("coach", () => {
  it("inline bold splits exactly like web's renderInline", () => {
    assert.deepEqual(parseInline("Ăn **200g** ức gà"), [
      { text: "Ăn ", bold: false },
      { text: "200g", bold: true },
      { text: " ức gà", bold: false },
    ]);
  });

  it("parses headings, notes, lists and blanks", () => {
    const lines = parseCoachText("## Tổng quan\n### Chi tiết\n> Không phải tư vấn y tế\n- Đạm 40g\n2. Tinh bột\n\nKết thúc");
    assert.deepEqual(
      lines.map((l) => l.kind),
      ["h2", "h3", "quote", "bullet", "numbered", "blank", "para"],
    );
    const n = lines[4];
    assert.equal(n.kind === "numbered" && n.n, "2");
  });

  it("parses a pipe table and drops the separator row", () => {
    const [t] = parseCoachText("| Bữa | Kcal |\n|---|:--:|\n| Sáng | **450** |");
    assert.equal(t.kind, "table");
    if (t.kind !== "table") return;
    assert.equal(t.headers.length, 2);
    assert.equal(t.rows.length, 1);
    assert.deepEqual(t.rows[0][1], [{ text: "450", bold: true }]);
  });

  it("a single '|' line is plain text, not a broken table", () => {
    assert.equal(parseCoachText("| chỉ một dòng")[0].kind, "para");
  });

  it("saved thread → question/answer bubble pairs with blocks and evidence", () => {
    const chat = sessionMessagesToChat([
      { id: "c1", question: "Q", answer: "A", createdAt: "2026-09-22T00:00:00Z", evidenceUsed: [], structuredBlocks: null },
    ]);
    assert.deepEqual(chat.map((m) => [m.id, m.from]), [["c1-q", "user"], ["c1-a", "ai"]]);
    assert.deepEqual(chat[1].structuredBlocks, []);
  });

  it("shows at most 3 evidence sources, only on AI answers", () => {
    const ev = Array.from({ length: 5 }, (_, i) => ({ title: `t${i}`, source_url: "", category: "", source_type: "", summary: "" }));
    assert.equal(visibleEvidence({ id: "1", from: "ai", text: "", time: "", evidenceUsed: ev }).length, 3);
    assert.equal(visibleEvidence({ id: "1", from: "user", text: "", time: "", evidenceUsed: ev }).length, 0);
  });

  it("relative time in Vietnamese", () => {
    const now = Date.parse("2026-09-22T12:00:00Z");
    assert.equal(relativeTime("2026-09-22T11:59:40Z", now), "Vừa xong");
    assert.equal(relativeTime("2026-09-22T11:30:00Z", now), "30 phút trước");
    assert.equal(relativeTime("2026-09-22T09:00:00Z", now), "3 giờ trước");
    assert.equal(relativeTime("2026-09-20T12:00:00Z", now), "2 ngày trước");
    assert.equal(relativeTime("garbage", now), "");
  });

  it("greeting carries the InBody deltas, or says there is no scan", () => {
    const g = greetingText({ weight: 70, muscleMass: 32, bodyFatPct: 18 }, { weight: 71.5, muscleMass: 31.6, bodyFatPct: 19 });
    assert.match(g, /Cân nặng: 70 kg \(↓ 1\.5 kg\)/);
    assert.match(g, /Khối cơ: 32 kg \(↑ 0\.4 kg\)/);
    assert.match(g, /Mỡ cơ thể: 18%/);
    assert.match(greetingText(null, null), /chưa có kết quả InBody/);
  });

  it("suggestions: InBody wording depends on having a scan", () => {
    assert.equal(suggestions(true)[0], "Phân tích InBody mới nhất của tôi");
    assert.equal(suggestions(false)[0], "Phân tích InBody của tôi");
    assert.equal(suggestions(true).length, 6);
  });

  it("only web's four allowed nextUrls become a mobile link", () => {
    assert.equal(mobileRouteForNextUrl("/client/nutrition"), "/client/workout/nutrition");
    assert.equal(mobileRouteForNextUrl("/client/training"), "/client/workout");
    assert.equal(mobileRouteForNextUrl("https://evil.example"), null);
    assert.equal(mobileRouteForNextUrl(undefined), null);
  });

  it("draft keys and error messages", () => {
    assert.equal(isDraftKey("draft:abc"), true);
    assert.equal(isDraftKey("5f1c"), false);
    assert.equal(agentErrorMessage({ response: { data: { error: { message: "Đề xuất đã hết hạn" } } } }), "Đề xuất đã hết hạn");
    assert.equal(agentErrorMessage(new Error("Request failed with status code 500")), "Thao tác thất bại. Hãy thử lại.");
    // Seen live 22/9: image-chat 500 answers "An unexpected error occurred" — never shown raw.
    assert.equal(agentErrorMessage({ response: { status: 500, data: { error: { message: "An unexpected error occurred" } } } }, "X"), "X");
  });

  it("missing-data items: real {label,value} objects and plain strings both render as text", () => {
    assert.equal(workflowItemText({ label: "thời lượng mỗi buổi", value: "60 phút" }), "thời lượng mỗi buổi: 60 phút");
    assert.equal(workflowItemText("mục tiêu tập luyện"), "mục tiêu tập luyện");
    assert.equal(workflowItemText(null), "");
    assert.equal(workflowItemText({ label: "mục tiêu tập luyện", value: "MUSCLE_GAIN" }), "mục tiêu tập luyện: Tăng cơ");
  });

  it("image type comes from the bytes, not the picker's label (PNG re-encoded as JPEG, seen live)", () => {
    assert.equal(detectImageMediaType("/9j/4AAQSkZJRg"), "image/jpeg");
    assert.equal(detectImageMediaType("iVBORw0KGgoAAAANSUhEUg"), "image/png");
    assert.equal(detectImageMediaType("R0lGODlh"), null);
  });
});
