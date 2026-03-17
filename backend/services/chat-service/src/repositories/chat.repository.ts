import { PrismaClient } from '@prisma/client';

export const prisma = new PrismaClient();

export const chatRepository = {
  // ── Conversations ────────────────────────────────────────────
  findExistingDirectConversation: async (userAId: string, userBId: string) => {
    // Find a DIRECT conversation where BOTH users are participants
    return prisma.conversation.findFirst({
      where: {
        type: 'DIRECT',
        participants: { some: { userId: userAId } },
        AND: [{ participants: { some: { userId: userBId } } }],
      },
      include: { participants: true, messages: { take: 1, orderBy: { createdAt: 'desc' } } },
    });
  },

  createDirectConversation: async (userAId: string, userBId: string) => {
    return prisma.conversation.create({
      data: {
        type: 'DIRECT',
        participants: {
          create: [{ userId: userAId }, { userId: userBId }],
        },
      },
      include: { participants: true },
    });
  },

  findConversationsByUserId: async (userId: string) => {
    return prisma.conversation.findMany({
      where: {
        participants: { some: { userId } },
      },
      include: {
        participants: true,
        messages: { take: 1, orderBy: { createdAt: 'desc' } },
      },
      orderBy: { lastMessageAt: 'desc' },
    });
  },

  findConversationById: async (id: string) => {
    return prisma.conversation.findUnique({
      where: { id },
      include: { participants: true },
    });
  },

  // ── Messages ─────────────────────────────────────────────────
  findMessagesByConversationId: async (
    conversationId: string,
    { skip, take }: { skip: number; take: number },
  ) => {
    return prisma.message.findMany({
      where: { conversationId },
      orderBy: { createdAt: 'asc' },
      skip,
      take,
    });
  },

  createMessage: async (conversationId: string, senderId: string, content: string) => {
    const [message] = await prisma.$transaction([
      prisma.message.create({
        data: { conversationId, senderId, content },
      }),
      prisma.conversation.update({
        where: { id: conversationId },
        data: { lastMessageAt: new Date() },
      }),
    ]);
    return message;
  },

  isUserParticipant: async (conversationId: string, userId: string) => {
    const row = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return !!row;
  },
};
