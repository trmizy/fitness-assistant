import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export const conversationRepository = {
  create: (data: {
    userId?: string;
    question: string;
    answer: string;
    modelUsed: string;
    responseTime: number;
    relevance?: string;
    relevanceExplanation?: string;
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
    cost?: number;
  }) => prisma.conversation.create({ data }),

  findMany: (where: Record<string, any>, limit = 10) =>
    prisma.conversation.findMany({
      where,
      orderBy: { createdAt: 'desc' },
      take: limit,
    }),

  updateFeedback: (id: string, feedback: number) =>
    prisma.conversation.update({
      where: { id },
      data: { feedback, feedbackTimestamp: new Date() },
    }),

  count: (where?: Record<string, any>) =>
    prisma.conversation.count({ where }),

  createWorkoutPlan: (data: {
    userId: string;
    name: string;
    description: string;
    goal: string;
    duration: number;
    daysPerWeek: number;
    plan: any;
  }) => prisma.workoutPlan.create({ data }),
};
