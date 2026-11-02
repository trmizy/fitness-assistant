/** Entirely synthetic test decisions/passages. No owner file, real study or scientific release. */
import { buildClaimMap, digest, sha256 } from "../../knowledge/scientific-claim-map-v3/builder";
import type { InputBundle } from "../../knowledge/scientific-claim-map-v3/schema";

export function syntheticClaimData() {
  const wording: Record<string, string> = {
    C01: "Tiến triển tập luyện theo mục tiêu là chủ đề progressive overload trong fixture.",
    C02: "Khuyến nghị cần được hiểu trong bối cảnh tập luyện của từng người.",
    C03: "ACSM 2009 trong fixture là bối cảnh lịch sử về progressive overload.",
    C04: "Volume nhiều hiệp và phì đại cơ là chủ đề của fixture tải tập.",
    C06: "Tải nặng và tải nhẹ cho kết quả sức mạnh 1RM khác nhau trong fixture.",
    C07: "Trong fixture, so sánh tải nhẹ và tải nặng cần giữ điều kiện phì đại cơ.",
    C12: "Progressive overload có nhiều cách tăng kích thích; chưa thể suy nhu cầu tăng tạ cá nhân.",
    C13: "Sức mạnh và tải tập được mô tả ở mức nhóm trong fixture.",
    C14: "Khối lượng tập volume và phì đại cần được hiểu theo phạm vi fixture.",
    C20: "e1RM trong fixture là ước tính từ log, không phải phép đo trực tiếp.",
    C21: "e1RM và Epley là ước tính sức mạnh, không phải kết quả 1RM đo trực tiếp; không có sai số cố định được kiểm chứng trong fixture.",
    C22: "Suy luận đo lường này đang chờ binding trong fixture.",
    C23: "Chuyên cần trong fixture chỉ mô tả mức tham gia.",
    C24: "Dữ liệu thiếu hoặc cũ cần được ghi nhận trong fixture.",
    C29: "Sức mạnh và phì đại có phạm vi đo lường khác nhau trong fixture.",
    C31: "Protein và thể tích tạng được mô tả trong fixture.",
  };
  const revised = {
    C32a: "C32a (volume): Volume 20 hiệp mỗi tuần không là mức tối ưu chung; phạm vi phì đại cần được xét riêng trong fixture.",
    C32b: "C32b (tempo): Tempo mỗi pha và thời gian toàn lần lặp khác nhau; không có nhịp tối ưu chung trong fixture.",
    C32c: "C32c (mức nỗ lực): RIR và failure là chủ đề mức nỗ lực, không phải yêu cầu mọi hiệp trong fixture.",
  };
  const quote = (id: string) => `Synthetic non-scientific passage ${id}: progressive overload volume weekly sets strength repetition maximum hypertrophy tempo failure repetitions in reserve protein. No real study supports this fixture.`;
  const originals = Array.from({ length: 33 }, (_, i) => {
    const id = "C" + String(i + 1).padStart(2, "0");
    return { id, sourceId: "SYNTH_" + id, kind: id === "C20" ? "SYSTEM_DEFINITION" : ["C23", "C24"].includes(id) ? "PRODUCT_POLICY" : id === "C22" ? "APPLICATION_INFERENCE" : "ORIGINAL_QUOTE",
      textVi: id === "C32" ? "Retired synthetic narrative." : wording[id] || `Câu thử nghiệm ${id}: thông tin tập luyện tổng hợp.`,
      conditions: id === "C07" ? ["Như C06"] : ["Fixture, không phải quần thể thật; ≥ 6 tuần chỉ là dữ liệu test."],
      cannotInfer: ["Không suy thành kết luận cá nhân hoặc dùng làm kiến thức phát hành."],
      certainty: { level: "TEST_ONLY", basis: id === "C32" ? "Narrative review; superseded synthetic fixture" : "Synthetic evidence, no scientific authority" },
      claude: { decision: "APPROVE", rewrite: "AI draft is not owner acceptance" } };
  });
  const owner: { revision: number; updatedAt: string; decisions: Record<string, Record<string, unknown>> } = { revision: 1, updatedAt: "2026-11-02T00:00:00Z", decisions: {} };
  for (const c of originals) owner.decisions[c.id] = { itemId: c.id, type: "CLAIM", decision: ["C01", "C21", "C22", "C32"].includes(c.id) ? "REVISE" : "APPROVE", status: "DECIDED",
    acceptedRevisionVi: c.id === "C32" ? Object.values(revised).join("\n") : c.textVi,
    note: "SYNTHETIC_TEST_DECISION_NOT_OWNER_HISTORY", via: "TEST_FIXTURE" };
  for (let i = 1; i <= 17; i++) { const id = "A" + String(i).padStart(2, "0"); owner.decisions[id] = { itemId: id, type: "ARTICLE", status: "DECIDED", decision: id === "A13" ? "REVISE_OR_VERIFY_ORIGINAL" : "APPROVE" }; }
  for (let i = 1; i <= 10; i++) { const id = "CAL" + String(i).padStart(2, "0"); owner.decisions[id] = { itemId: id, type: "CALIBRATION", status: "DECIDED", decision: id === "CAL02" ? "REVISE" : "ACCEPT", acceptedRevisionVi: null, ownerAssessment: null }; }
  const ids = [...originals.filter(c => c.id !== "C32").map(c => c.id), ...Object.keys(revised)];
  const records = ids.map(id => ({ id: "SYNTH_" + id, title: "SYNTHETIC TEST, NOT A REAL STUDY: " + id, url: "https://example.invalid/" + id,
    bodyText: quote(id), bodySha256: sha256(quote(id)), rawPayloadSha256: sha256(quote(id)), readScope: "SYNTHETIC_TEST_NOT_SCIENTIFIC_VALIDATION" }));
  const bindings = Object.fromEntries(ids.map(id => [id, { excerpts: id === "C22" ? [] : [{ sourceId: id === "C20" ? "CODE_E1RM" : ["C23", "C24"].includes(id) ? "CODE_OUTCOME" : "SYNTH_" + id,
    quote: ["C20", "C23", "C24"].includes(id) ? "synthetic product definition" : quote(id), locator: "synthetic fixture", role: "SYNTHETIC_SUPPORT" }],
    additionalApplicability: ["Synthetic applicability; not a research recommendation.", ...(id === "C32b" ? ["Thời gian mỗi pha khác toàn bộ repetition trong fixture."] : [])],
    additionalLimitations: id === "C21" ? ["Fixture không phải kết quả systematic search."] : [],
    additionalUnsupportedInferences: id === "C21" ? ["Người Việt cần công thức khác: không được suy ra từ fixture."] : [], unresolvedEvidence: id === "C22" ? ["SYNTHETIC_BINDING_PENDING"] : [] }]));
  const review = { claims: originals, sources: originals.map(c => ({ id: c.sourceId, population: "Synthetic participants, not a real population", limits: ["SYNTHETIC TEST ONLY"] })) };
  const values: Record<string, unknown> = { owner, review, followupReport: "Synthetic follow-up text only.", followups: { items: { C21: { aiRevisionVi: "Synthetic AI wording differs from accepted fixture wording." } } },
    engineering: { items: [{ id: "E01", title: "Synthetic undecided engineering item" }] }, calibration: {}, extras: {}, archivedAbstracts: {}, sources: { records }, bindings: { claims: bindings }, codeE1rm: "synthetic product definition", codeOutcome: "synthetic product definition", priority17: [] };
  const files = Object.fromEntries(Object.entries(values).map(([id, value]) => {
    const text = typeof value === "string" ? value : JSON.stringify(value);
    return [id, { origin: "SYNTHETIC_TEST_FIXTURE:" + id, text, sha256: sha256(text) }];
  }));
  // Explicit source receipt is synthetic and still checked by the production builder.
  owner.decisions.C01.sourceRef = { files: { reviewJson: files.review.sha256 } };
  files.owner.text = JSON.stringify(owner); files.owner.sha256 = sha256(files.owner.text);
  const input: InputBundle = { version: "scientific-claim-map-input-v3", baselineHead: "1".repeat(40), files };
  return { input, map: buildClaimMap(input), pins: { inputBundleSha256: digest(input), ownerDecisionsSha256: input.files.owner.sha256 } };
}
