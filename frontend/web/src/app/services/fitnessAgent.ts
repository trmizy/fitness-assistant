import { api } from "./api";

export interface AgentChatBlock {
  type: "PT_RECOMMENDATIONS" | "PROGRAM_RECOMMENDATIONS" | "ACTION_CONFIRMATION" | "ACTION_RESULT" | "GOAL_ANALYSIS";
  recommendationId?: string; actionId?: string; kind?: string; title?: string; note?: string; expiresAt?: string;
  candidates?: Array<any>; evidence?: Array<{ id: string; title: string; sourceUrl: string; finding: string; evidenceLevel: string }>;
  warnings?: string[]; summary?: Record<string, any>; attributes?: Record<string, any>;
  nextUrl?: string; goalConfirmed?: boolean; status?: string;
}
export interface AgentReply { sessionId: string; conversationId: string; block: AgentChatBlock }
async function post(url: string, body: unknown): Promise<AgentReply> {
  const { data } = await api.post(url, body, { timeout: 60000 });
  return data.data;
}
export const fitnessAgentService = {
  choose: (id: string, candidateId: string, packageId?: string) => post(`/ai/agent/recommendations/${id}/choose`, { candidateId, packageId }),
  confirm: (id: string) => post(`/ai/agent/actions/${id}/confirm`, { confirmed: true }),
  confirmGoal: (sessionId: string, goal: unknown) => post("/ai/agent/goal/confirm", { sessionId, goal }),
  async image(file: File, sessionId?: string) {
    if (!["image/jpeg", "image/png"].includes(file.type) || file.size > 4 * 1024 * 1024) throw new Error("Chọn ảnh JPEG/PNG dưới 4 MB.");
    const base64 = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result).split(",")[1]); reader.onerror = reject; reader.readAsDataURL(file);
    });
    return post("/ai/agent/goal-image", { image: { mediaType: file.type, base64 }, sessionId });
  },
};
