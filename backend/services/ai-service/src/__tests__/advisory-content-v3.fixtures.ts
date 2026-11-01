import fs from "node:fs";
import path from "node:path";
import { EvidencePackSchema } from "../evaluation/advisory-progress/experiment";
import { scenarios } from "../evaluation/advisory-progress/scenarios";
import type { AnswerV3, ClaimV3 } from "../evaluation/advisory-progress/content-aware-v3-schema";

export const repoRoot = path.resolve(__dirname, "../../../../..");
export const readDev = (name: string): unknown => JSON.parse(fs.readFileSync(path.join(repoRoot, "data/eval/advisory-progress-dev", name), "utf8"));
export const pack = EvidencePackSchema.parse(readDev("evidence-pack.json"));
export const cases = scenarios(pack.sources);
export const input = cases.find((s) => s.id === "strength-increasing")!.input;
export function observation(): ClaimV3 {
  return { claimType: "OBSERVATION", text: "e1RM ước tính tăng từ 60 lên 66 kg.", factIds: ["F_PROGRESS"], evidenceIds: [],
    metricAssertion: { factId: "F_PROGRESS", measurement: "ESTIMATED_1RM", baselineKg: 60, currentKg: 66, changePct: 10 } };
}
export function answer(): AnswerV3 {
  return { version: "content-aware-v3", assessment: "OBSERVED_PROGRESS", assessmentBasis: { outcome: "ESTIMATED_STRENGTH", factIds: ["F_PROGRESS"] },
    claims: [observation()], missingInformation: [], rationaleSummary: "Số liệu hiện có cho thấy chỉ số sức mạnh ước tính tăng.", proposedAction: null };
}
export function hypothesis(text = "Có thể sức mạnh tăng do tăng tải tập; chưa xác định nguyên nhân."): ClaimV3 {
  return { claimType: "PERSONAL_HYPOTHESIS", text, factIds: ["F_PROGRESS"], evidenceIds: ["ACSM_PROGRESSIVE"], needsConfirmation: true,
    missingToConfirm: [{ key: "program_load_history", question: "Bạn có lịch sử tải tập để đối chiếu không?" }] };
}
