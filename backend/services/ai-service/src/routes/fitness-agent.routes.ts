import { Router, type Request } from "express";
import { z } from "zod";
import { GoalIntentSchema, logger } from "@gym-coach/shared";
import { fitnessAgent, type AgentBlock } from "../services/fitness-agent.service";
import { fitnessAgentTools } from "../services/fitness-agent-tools";
import { analyzeGoalImage, GoalImageSchema } from "../services/fitness-goal-vision.service";
import { prisma } from "../repositories/conversation.repository";

const router = Router();
const uuid = z.string().uuid();
async function sessionFor(req: Request, supplied?: string) {
  if (!supplied) return prisma.chatSession.create({ data: { userId: req.context.userId, title: "Mục tiêu hình thể" } });
  const session = await prisma.chatSession.findFirst({ where: { id: supplied, userId: req.context.userId, archivedAt: null } });
  if (!session) throw Object.assign(new Error("Conversation not found"), { status: 404 });
  return session;
}
async function persist(req: Request, sessionId: string, block: AgentBlock, question: string) {
  const message = await prisma.conversation.create({ data: { userId: req.context.userId, sessionId,
    question, answer: block.type === "ACTION_RESULT" ? "Thao tác đã hoàn tất." : "Kiểm tra và xác nhận thông tin bên dưới.",
    modelUsed: "fitness-agent-v1", responseTime: 0, promptTokens: 0, completionTokens: 0, totalTokens: 0, structuredBlocks: [block] as any } });
  await prisma.chatSession.update({ where: { id: sessionId }, data: { lastMessageAt: new Date() } });
  return { sessionId, conversationId: message.id, block };
}
const handle = (fn: (req: Request) => Promise<unknown>) => async (req: Request, res: any) => {
  const started = Date.now();
  try { res.json({ success: true, data: await fn(req) }); }
  catch (error: any) {
    const status = error instanceof z.ZodError ? 400 : error.status ?? 503;
    logger.warn({ route: req.route.path, status, latencyMs: Date.now() - started }, "fitness agent action failed");
    res.status(status).json({ success: false, error: { message: status >= 500 ? "Dịch vụ tạm thời không khả dụng. Vui lòng thử lại hoặc nhập mục tiêu thủ công." : error.message } });
  }
};
router.post("/recommendations/:id/choose", handle(async req => {
  const body = z.object({ candidateId: uuid, packageId: uuid.optional() }).strict().parse(req.body);
  const id = uuid.parse(req.params.id);
  const block = await fitnessAgent.prepare(req.context, id, body.candidateId, body.packageId);
  const rec = await prisma.fitnessRecommendation.findFirstOrThrow({ where: { id, userId: req.context.userId } });
  return persist(req, rec.sessionId, block, "Chọn đề xuất");
}));
router.post("/actions/:id/confirm", handle(async req => {
  z.object({ confirmed: z.literal(true) }).strict().parse(req.body);
  const id = uuid.parse(req.params.id);
  const block = await fitnessAgent.execute(req.context, id, true);
  const action = await prisma.fitnessAgentAction.findFirstOrThrow({ where: { id, userId: req.context.userId } });
  return persist(req, action.sessionId, block, "Xác nhận thao tác");
}));
router.post("/goal-image", handle(async req => {
  const body = z.object({ image: GoalImageSchema, sessionId: uuid.optional() }).strict().parse(req.body);
  const session = await sessionFor(req, body.sessionId);
  const attributes = await analyzeGoalImage(body.image);
  return persist(req, session.id, { type: "GOAL_ANALYSIS", attributes,
    note: "Đây là gợi ý đặc điểm hình thể, không phải phép đo cơ thể hay cam kết kết quả. Có đúng đây là đặc điểm bạn muốn hướng tới không?" }, "Phân tích ảnh tham khảo mục tiêu");
}));
router.post("/goal/confirm", handle(async req => {
  const body = z.object({ sessionId: uuid, goal: GoalIntentSchema }).strict().parse(req.body);
  await sessionFor(req, body.sessionId);
  await fitnessAgentTools.confirmGoal(req.context, body.goal);
  return persist(req, body.sessionId, { type: "ACTION_RESULT", goalConfirmed: true }, "Xác nhận mục tiêu hình thể");
}));
export default router;
