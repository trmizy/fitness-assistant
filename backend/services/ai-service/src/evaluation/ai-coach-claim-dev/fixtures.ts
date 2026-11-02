/** Implementer-authored DEV scripts, not independent labels or model reasoning. */
import type { DevRequest } from "../ai-coach-dev/context";
import type { ClaimAnalysis } from "./pipeline";
import type { MockProvider } from "../ai-coach-dev/pipeline";
import type { ClaimContext } from "./context";

function request(id: string, question: string, kind?: string, value: Record<string, number | string> = {}): DevRequest {
  const subjectId = "synthetic-e2-" + id;
  return { dataClass: "SYNTHETIC_DEV", caseId: "dev-e2-" + id, subjectId, question,
    profile: { owner: "user-service", goal: null }, conversation: [],
    snapshots: kind ? [{ subjectId, namespace: "TRAINING", owner: "fitness-service", recordedAt: "2026-11-02T00:00:00Z", facts: [{
      id: "DEV_F_TRAINING", evidence: { domain: "TRAINING", kind, provenance: "TRAINING_LOGS", quality: "PARTIAL", window: { days: 28 }, claimBoundary: "DESCRIPTIVE_ONLY", value },
    }] }] : [] };
}
export const claimDevScenarios = [
  { id: "A", request: request("progression", "Tôi chưa tăng tạ nhưng số lần lặp tăng. Progressive overload có chỉ là tăng tạ không?", "LOGGED_REPETITION_CHANGE", { exercise: "Bench Press", weightKg: 40, baselineReps: 8, currentReps: 10 }),
    targetIds: ["C12"], observation: "Nhật ký Bench Press ghi cùng tải 40 kg, số lần lặp từ 8 lên 10.",
    rationale: "Log ghi thay đổi số lần lặp; chưa đủ để kết luận sức mạnh tối đa hoặc kích thước cơ. Không thể suy không tiến bộ chỉ vì tải không đổi." },
  { id: "B", request: request("e1rm", "e1RM Bench Press của tôi thay đổi nhẹ; sức mạnh thực sự đã tăng chắc chắn chưa?", "EXERCISE_E1RM_CHANGE", { exercise: "Bench Press", unit: "kg", baselineKg: 60, currentKg: 60.3, changePct: 0.5 }),
    targetIds: ["C21"], observation: "e1RM Bench Press trong projection từ 60 lên 60,3 kg; đây là số liệu ước tính.",
    rationale: "Chưa đủ căn cứ xác nhận thay đổi sức mạnh thực sự. Chưa có threshold được owner chấp nhận cho biến động này." },
  { id: "C", request: request("volume", "Tôi có nên tập volume 20 hiệp mỗi nhóm cơ mỗi tuần không?"), targetIds: ["C32a"], observation: null,
    rationale: "Kết quả nghiên cứu theo nhóm không xác định volume phù hợp cho cá nhân này. Cần biết kinh nghiệm, chương trình hiện tại và phản hồi tập luyện." },
  { id: "D", request: request("tempo-rir", "Tempo nào tối ưu cho tất cả mọi người? Mọi hiệp đều phải tới failure hay RIR bằng không?"), targetIds: ["C32b", "C32c"], observation: null,
    rationale: "Các nguồn không thiết lập một tempo tối ưu cho mọi người hoặc yêu cầu mọi hiệp tới suy cơ. Personal applicability chưa được xác minh." },
  { id: "E", request: request("unsupported", "Chỉ từ e1RM, có thể biết chính xác cơ ngực của tôi đã to thêm bao nhiêu không?", "EXERCISE_E1RM_CHANGE", { exercise: "Bench Press", unit: "kg", baselineKg: 60, currentKg: 60.3, changePct: 0.5 }),
    targetIds: [] as string[], observation: "e1RM Bench Press trong projection từ 60 lên 60,3 kg; đây là số liệu ước tính.", rationale: "Không có số đo kích thước cơ phù hợp để trả lời định lượng. Các nguồn cùng chủ đề không xác nhận kết quả cá nhân này." },
  { id: "F", request: request("c22", "e1RM và kích thước cơ có phải cùng một phép đo không?"), restrictTo: ["C22"], targetIds: [] as string[], observation: null,
    rationale: "Không có claim đã được bind đủ bằng chứng trong tập được yêu cầu. Cần bổ sung bằng chứng đo lường; không khôi phục claim đang bị giữ lại." },
  { id: "G", request: request("wrong-excerpt", "Tôi có nên tập volume 20 hiệp mỗi nhóm cơ mỗi tuần không?"), targetIds: [] as string[], observation: null,
    rationale: "Đoạn trích cùng chủ đề chưa đủ xác nhận kết luận. Dữ liệu binding không hợp lệ phải được giữ ngoài kiến thức cấp cho generation." },
];
export type ClaimScenario = typeof claimDevScenarios[number];

/** Copies explicit fixture script and approved text; not a reasoning model or scientific judge. */
export function scriptedFake(scenario: ClaimScenario): MockProvider {
  return { kind: "MOCK_ONLY", async complete({ prompt }) {
    const p = JSON.parse(prompt.user) as ClaimContext["payload"];
    const output: ClaimAnalysis = { analysis: { version: "content-aware-v3", assessment: "INSUFFICIENT_DATA",
      assessmentBasis: { outcome: "UNSPECIFIED", factIds: [] }, claims: [],
      missingInformation: [{ key: "outcome_measurement", question: "Bạn có số đo kết quả phù hợp và điều kiện đo để đối chiếu không?" }],
      rationaleSummary: scenario.rationale, proposedAction: null }, claimLinks: [], sourceLinks: [] };
    if (scenario.observation) {
      const fact = p.trainingObservations.facts[0];
      output.analysis.claims.push({ claimType: "OBSERVATION", text: scenario.observation, factIds: [fact.id], evidenceIds: [],
        ...(fact.evidence.kind === "EXERCISE_E1RM_CHANGE" ? { metricAssertion: { factId: fact.id, measurement: "ESTIMATED_1RM" as const,
          baselineKg: Number(fact.evidence.value.baselineKg), currentKg: Number(fact.evidence.value.currentKg), changePct: Number(fact.evidence.value.changePct) } } : {}) });
    }
    for (const id of scenario.targetIds) {
      const record = p.approvedScientificKnowledge.find(c => c.id === id);
      if (!record) continue;
      const refs = p.evidenceProvenance.filter(e => e.knowledgeClaimId === id && e.kind === "PRIMARY_SCIENTIFIC");
      const claimIndex = output.analysis.claims.length, sourceIds = [...new Set(refs.map(e => e.sourceId))];
      output.analysis.claims.push({ claimType: "GENERAL_PRINCIPLE", text: record.displayTextVi, factIds: [], evidenceIds: sourceIds });
      output.claimLinks.push({ claimIndex, knowledgeClaimId: id, knowledgeClaimHash: record.claimHash });
      for (const sourceId of sourceIds) output.sourceLinks.push({ claimIndex, sourceId, excerptIds: [...new Set(refs.filter(e => e.sourceId === sourceId).map(e => e.excerptId))] });
    }
    return output;
  } };
}
