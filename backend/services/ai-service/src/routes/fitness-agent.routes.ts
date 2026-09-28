import { Router, type Request } from "express";
import { z } from "zod";
import { GoalIntentSchema, logger } from "@gym-coach/shared";
import { createRateLimiter } from "../middleware/rate-limit.middleware";
import { fitnessAgent, type AgentBlock } from "../services/fitness-agent.service";
import { fitnessAgentTools } from "../services/fitness-agent-tools";
import { analyzeGoalImage, GoalImageSchema } from "../services/fitness-goal-vision.service";
import { analyzeImageChat, type ImageChatUserContext } from "../services/fitness-vision-chat.service";
import { profileExtractor } from "../llm/profile_extractor";
import { prisma } from "../repositories/conversation.repository";

const router = Router();
const uuid = z.string().uuid();

// Same tier and same "ai-expensive" bucket as POST /ai/generate-workout (see
// ai.routes.ts) — a direct, synchronous vision call to Bedrock is at least as
// costly per request, and sharing one bucket keeps a user from working
// around the workout-generation limit by hitting these instead. Mounted
// after /ai's own requireAuth (this router is mounted at /ai/agent), so
// req.context.userId is already trustworthy here.
const expensiveRateLimiter = createRateLimiter({
  name: "ai-expensive",
  max: Number.parseInt(process.env.AI_EXPENSIVE_RATE_LIMIT_MAX || "10", 10),
  windowSeconds: Number.parseInt(
    process.env.AI_EXPENSIVE_RATE_LIMIT_WINDOW_SECONDS || "60",
    10,
  ),
});
async function sessionFor(req: Request, supplied?: string, title = "Mục tiêu hình thể") {
  if (!supplied) return prisma.chatSession.create({ data: { userId: req.context.userId, title } });
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
router.post("/actions/:id/dismiss", handle(async req => {
  const id = uuid.parse(req.params.id);
  const block = await fitnessAgent.dismissDraft(req.context, id);
  const action = await prisma.fitnessAgentAction.findFirstOrThrow({ where: { id, userId: req.context.userId } });
  return persist(req, action.sessionId, block, "Bỏ qua bản nháp");
}));
router.post("/goal-image", expensiveRateLimiter, handle(async req => {
  const body = z.object({ image: GoalImageSchema, sessionId: uuid.optional() }).strict().parse(req.body);
  const session = await sessionFor(req, body.sessionId);
  const attributes = await analyzeGoalImage(body.image);
  return persist(req, session.id, { type: "GOAL_ANALYSIS", attributes,
    note: "Đây là gợi ý đặc điểm hình thể, không phải phép đo cơ thể hay cam kết kết quả. Có đúng đây là đặc điểm bạn muốn hướng tới không?" }, "Phân tích ảnh tham khảo mục tiêu");
}));
router.post("/image-chat", expensiveRateLimiter, handle(async req => {
  const body = z.object({ image: GoalImageSchema, question: z.string().max(500).optional(), sessionId: uuid.optional() }).strict().parse(req.body);
  const session = await sessionFor(req, body.sessionId, "Hỏi AI về ảnh");
  // Real bug found live this session: this route used to call analyzeImageChat
  // with no user context at all, so "phân tích thể trạng cho tôi" stayed
  // generic even for an account with real InBody data on file. Reuse the
  // same personalization fetch the main /ai/ask pipeline already relies on
  // (confirmed live: that one grounds correctly) — best-effort, never blocks
  // the image analysis if the profile/InBody fetch itself fails.
  let userContext: ImageChatUserContext | undefined;
  try {
    const personalization = await profileExtractor.extract(req.context.userId, req.context.authorizationHeader);
    userContext = {
      gender: personalization.profile.gender,
      age: personalization.profile.age,
      heightCm: personalization.profile.heightCm,
      currentWeightKg: personalization.profile.currentWeightKg,
      goal: personalization.profile.goal,
      activityLevel: personalization.profile.activityLevel,
      experienceLevel: personalization.profile.experienceLevel,
      bodyFatPct: personalization.latestInBody?.bodyFatPct,
      muscleMassKg: personalization.latestInBody?.skeletalMuscleKg,
      inBodyMeasuredAt: personalization.latestInBody?.measuredAt,
    };
  } catch (err) {
    logger.warn({ err, userId: req.context.userId }, "image-chat: failed to load user personalization context, proceeding without it");
  }
  const result = await analyzeImageChat(body.image, body.question, userContext);
  return persist(req, session.id, { type: "IMAGE_CHAT", result }, body.question?.trim() || "Phân tích ảnh");
}));
router.post("/goal/confirm", handle(async req => {
  const body = z.object({ sessionId: uuid, goal: GoalIntentSchema }).strict().parse(req.body);
  await sessionFor(req, body.sessionId);
  await fitnessAgentTools.confirmGoal(req.context, body.goal);
  return persist(req, body.sessionId, { type: "ACTION_RESULT", goalConfirmed: true }, "Xác nhận mục tiêu hình thể");
}));
export default router;
