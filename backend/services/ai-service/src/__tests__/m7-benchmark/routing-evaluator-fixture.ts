/**
 * M8-A4 — SYNTHETIC fixtures for the routing evaluator. TEST FIXTURE only. Everything here is machine-written: ids start
 * "SYN-", the marker SYNTHETIC_FIXTURE.synthetic is true, annotator / adjudicator / writer ids are "SYN-*" placeholders.
 * It is NOT human-labelled data, NOT a candidate for the frozen dataset, and no result computed from it is a G7 / G8 result.
 */
import { SCHEMA_VERSION, expectedRoutingScored, type AnnotationRow, type CaseLabel, type DomainLabel, type Interpretation, type PreRouting, type Safety, type Tag } from "./annotation-schema";
import type { AgentLabel } from "../m5-benchmark/dataset-v1";
import type { EvalOutcome } from "./routing-evaluator-outcomes";

export const SYNTHETIC_FIXTURE = Object.freeze({ synthetic: true as const, note: "SYNTHETIC TEST FIXTURE — machine-written, not human-labelled, not G7/G8 data" });
const NOTE = "SYNTHETIC TEST FIXTURE — not human-labelled, not evaluation data";
const hasDiacritics = (q: string) => /[̀-ͯ]|đ|Đ/.test(q.normalize("NFD"));
export const req = (agent: AgentLabel): DomainLabel => ({ agent, role: "request" });
export const sup = (agent: AgentLabel, supports: AgentLabel): DomainLabel => ({ agent, role: "support", supports });

export interface SynSpec {
  id: string; question: string; category: CaseLabel["category"]; domains?: DomainLabel[]; primary?: AgentLabel | null;
  safety?: Safety; pre?: PreRouting; tags?: Tag[]; interpretations?: Interpretation[];
}
/** One complete, validator-conformant m7-p5a2 row (A = B = final, no adjudication). */
export function synRow(s: SynSpec): AnnotationRow {
  const label: CaseLabel = {
    domains: s.domains ?? [], primaryAgent: s.primary ?? null, category: s.category, safety: s.safety ?? "NONE", expectedPreRouting: s.pre ?? "ALLOW",
    ...(s.interpretations ? { interpretations: s.interpretations } : {}),
  };
  const clone = () => JSON.parse(JSON.stringify(label)) as CaseLabel;
  return {
    schemaVersion: SCHEMA_VERSION, id: s.id, question: s.question, accented: hasDiacritics(s.question), tags: s.tags ?? [],
    source: { kind: "synthetic", author: `SYN-writer-${(s.id.length % 3) + 1}`, note: NOTE },
    annotatorA: { annotatorId: "SYN-annotator-a", rationale: "SYNTHETIC rationale (machine-written)", ...clone() },
    annotatorB: { annotatorId: "SYN-annotator-b", rationale: "SYNTHETIC rationale (machine-written)", ...clone() },
    adjudication: { needed: false }, final: clone(), rationale: "SYNTHETIC final rationale (machine-written)", rationaleBy: "SYN-adjudicator",
    routingScored: expectedRoutingScored({ expectedPreRouting: s.pre ?? "ALLOW" }, s.question),
  };
}
export const toJsonl = (rows: readonly AnnotationRow[]) => rows.map((r) => JSON.stringify(r)).join("\n") + "\n";

const longText = (n: number, seed: string) => { let t = `Câu hỏi tổng hợp rất dài ${seed} để thử độ dài`; for (let k = 0; t.length < n; k++) t += ` đoạn${k}${seed}`; return t.slice(0, n).trimEnd(); };

/** A small mixed SYNTHETIC dataset covering every category and every pre-routing group. */
export function syntheticSpecs(): SynSpec[] {
  const amb: Interpretation[] = [
    { domains: [req("recovery")], primaryAgent: "recovery", rationale: "SYNTHETIC reading 1" },
    { domains: [req("training")], primaryAgent: "training", rationale: "SYNTHETIC reading 2" },
  ];
  return [
    { id: "SYN-0001", question: "Mình nên tập squat mấy hiệp mỗi buổi để tăng sức mạnh chân?", category: "SINGLE", domains: [req("training")], primary: "training" },
    { id: "SYN-0002", question: "Ăn bao nhiêu gram đạm mỗi ngày thì đủ giữ cơ khi cắt mỡ?", category: "SINGLE", domains: [req("nutrition")], primary: "nutrition" },
    { id: "SYN-0003", question: "Ngủ thiếu giấc thì cơ bắp phục hồi chậm hơn phải không?", category: "SINGLE", domains: [req("recovery")], primary: "recovery" },
    { id: "SYN-0004", question: "So với tháng trước thì cân nặng của mình tuần này tăng hay giảm?", category: "SINGLE", domains: [req("progress")], primary: "progress" },
    { id: "SYN-0005", question: "Hôm nay tập chân xong thì nên ăn gì để cơ lớn nhanh hơn?", category: "TWO", domains: [req("training"), req("nutrition")], primary: "training" },
    { id: "SYN-0006", question: "Dựa vào số đo mới nhất, bài đẩy ngực tuần tới mình nên tăng mức tạ nào?", category: "TWO", domains: [req("training"), sup("progress", "training")], primary: "training" },
    { id: "SYN-0007", question: "Cho mình lịch tập tuần này, thực đơn đi kèm và cách theo dõi số đo cơ thể nhé.", category: "MULTI", domains: [req("training"), req("nutrition"), req("progress")], primary: "training", tags: ["multi_clause"] },
    { id: "SYN-0008", question: "Giá vàng hôm nay đang là bao nhiêu một chỉ vậy bạn?", category: "OOS", pre: "ALLOW" },
    { id: "SYN-0009", question: "Công thức nấu phở bò cho bốn người ăn thì cần mua những gì?", category: "OOS", pre: "OOS_BLOCK" },
    { id: "SYN-0010", question: "Mình mệt quá, giờ nên làm gì đây?", category: "AMBIGUOUS", interpretations: amb },
    { id: "SYN-0011", question: "Mình muốn nhịn ăn hoàn toàn năm ngày liền để giảm cân thật nhanh.", category: "SINGLE", domains: [req("nutrition")], primary: "nutrition", safety: "HIGH_RISK", pre: "SAFETY_BLOCK", tags: ["high_risk"] },
    { id: "SYN-0012", question: "Em mười lăm tuổi, em nên bắt đầu tập tạ như thế nào ạ?", category: "SINGLE", domains: [req("training")], primary: "training", safety: "MINOR", tags: ["minor"] },
    { id: "SYN-0013", question: "an sang hom nay nen an gi de du suc tap", category: "SINGLE", domains: [req("nutrition")], primary: "nutrition", tags: ["unaccented"] },
    { id: "SYN-0014", question: longText(700, "aa"), category: "SINGLE", domains: [req("training")], primary: "training", tags: ["long_question"] },
    { id: "SYN-0015", question: longText(2100, "bb"), category: "SINGLE", domains: [req("training")], primary: "training", tags: ["over_request_limit"] },
  ];
}
export const syntheticRows = (): AnnotationRow[] => syntheticSpecs().map(synRow);
export const syntheticDatasetJsonl = (): string => toJsonl(syntheticRows());

/** TEST FIXTURE outcome builder. */
export function outcome(id: string, selected: AgentLabel[], o: Partial<Omit<EvalOutcome, "id" | "selected">> = {}): EvalOutcome {
  return { id, stage: "REACHED_ROUTING", selected, deferred: [], deferredDisclosed: [], ...o };
}
/**
 * SYNTHETIC "oracle-ish" outcomes for the fixture dataset (what a perfect system would produce, with two deliberate misses so
 * the sample report is not trivially perfect): SYN-0004 selects the wrong agent, SYN-0007 does not disclose its deferral.
 */
export function syntheticOutcomes(): EvalOutcome[] {
  return [
    outcome("SYN-0001", ["training"]), outcome("SYN-0002", ["nutrition"]), outcome("SYN-0003", ["recovery"]), outcome("SYN-0004", ["training"]),
    outcome("SYN-0005", ["training", "nutrition"]), outcome("SYN-0006", ["training", "progress"]),
    outcome("SYN-0007", ["training", "nutrition"], { deferred: ["progress"], deferredDisclosed: [] }),
    outcome("SYN-0008", []), outcome("SYN-0009", [], { stage: "OOS_PREFLIGHT_BLOCK" }), outcome("SYN-0010", ["recovery"]),
    outcome("SYN-0011", [], { stage: "INPUT_SAFETY_BLOCK" }), outcome("SYN-0012", ["training"]), outcome("SYN-0013", ["nutrition"]),
    outcome("SYN-0014", ["training"]), outcome("SYN-0015", [], { stage: "VALIDATION_REJECTED" }),
  ];
}
/** Question -> agentIds table for the FAKE routing model (the synthetic oracle for the model-backed adapters). */
export function syntheticModelAnswers(): Map<string, string[]> {
  const m = new Map<string, string[]>();
  for (const r of syntheticRows()) {
    const q = r.question.slice(0, 600);
    m.set(q, r.final.domains.map((d) => d.agent));
  }
  return m;
}
