import { PrismaClient } from "@prisma/client";

export const prisma = new PrismaClient();

export const chatRepository = {
  // ── Conversations ────────────────────────────────────────────
  findExistingDirectConversation: async (userAId: string, userBId: string) => {
    // Find a DIRECT conversation where BOTH users are participants
    return prisma.conversation.findFirst({
      where: {
        type: "DIRECT",
        participants: { some: { userId: userAId } },
        AND: [{ participants: { some: { userId: userBId } } }],
      },
      include: {
        participants: true,
        messages: { take: 1, orderBy: { createdAt: "desc" } },
      },
    });
  },

  createDirectConversation: async (userAId: string, userBId: string) => {
    return prisma.conversation.create({
      data: {
        type: "DIRECT",
        participants: {
          create: [{ userId: userAId }, { userId: userBId }],
        },
      },
      include: { participants: true },
    });
  },

  /**
   * Get-or-create the DIRECT conversation of two users, safe against two callers racing (a PT's "Nhắn tin" tap
   * and the contract-activation hook, a double click, a webhook replay): a transaction-scoped advisory lock keyed on
   * the sorted pair serialises them, so only one creates the row.
   */
  findOrCreateDirectConversation: async (userAId: string, userBId: string) => {
    const [a, b] = [userAId, userBId].sort();
    return prisma.$transaction(async (tx) => {
      await tx.$executeRaw`SELECT pg_advisory_xact_lock(hashtext(${`direct-conversation:${a}:${b}`}))`;
      const existing = await tx.conversation.findFirst({
        where: {
          type: "DIRECT",
          participants: { some: { userId: userAId } },
          AND: [{ participants: { some: { userId: userBId } } }],
        },
        include: { participants: true, messages: { take: 1, orderBy: { createdAt: "desc" } } },
      });
      if (existing) return { conversation: existing, created: false };
      const conversation = await tx.conversation.create({
        data: { type: "DIRECT", participants: { create: [{ userId: userAId }, { userId: userBId }] } },
        include: { participants: true, messages: { take: 1, orderBy: { createdAt: "desc" } } },
      });
      return { conversation, created: true };
    });
  },

  findConversationsByUserId: async (userId: string) => {
    return prisma.conversation.findMany({
      where: {
        participants: { some: { userId } },
      },
      include: {
        participants: true,
        messages: { take: 1, orderBy: { createdAt: "desc" } },
      },
      // Conversations never written to (lastMessageAt NULL) go last, not first: an empty thread
      // must not outrank the one with the newest message (N13H-02).
      orderBy: [
        { lastMessageAt: { sort: "desc", nulls: "last" } },
        { createdAt: "desc" },
      ],
    });
  },

  findConversationById: async (id: string) => {
    return prisma.conversation.findUnique({
      where: { id },
      include: { participants: true },
    });
  },

  // ── Messages ─────────────────────────────────────────────────
  // Newest-first window, handed back oldest-first. `skip`/`take` page from the newest message
  // (page 1 = the latest `take`); `beforeId` instead returns the `take` messages older than that
  // one, which stays correct while new messages keep arriving.
  findMessagesByConversationId: async (
    conversationId: string,
    {
      skip,
      take,
      beforeId,
    }: { skip: number; take: number; beforeId?: string },
  ) => {
    let olderThan: object = {};
    if (beforeId) {
      const anchor = await prisma.message.findFirst({
        where: { id: beforeId, conversationId },
        select: { createdAt: true, id: true },
      });
      if (!anchor) return [];
      olderThan = {
        OR: [
          { createdAt: { lt: anchor.createdAt } },
          { createdAt: anchor.createdAt, id: { lt: anchor.id } },
        ],
      };
    }
    const newestFirst = await prisma.message.findMany({
      where: { conversationId, ...olderThan },
      orderBy: [{ createdAt: "desc" }, { id: "desc" }],
      skip: beforeId ? 0 : skip,
      take,
    });
    return newestFirst.reverse();
  },

  createMessage: async (
    conversationId: string,
    senderId: string,
    content: string,
  ) => {
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

  /**
   * Posts a message under a CALLER-CHOSEN id, once: a second call with the same id stores nothing and returns null
   * (primary-key conflict). Used for system lines that must not repeat on retries / webhook replays.
   */
  createMessageOnce: async (id: string, conversationId: string, senderId: string, content: string) => {
    try {
      const [message] = await prisma.$transaction([
        prisma.message.create({ data: { id, conversationId, senderId, content } }),
        prisma.conversation.update({ where: { id: conversationId }, data: { lastMessageAt: new Date() } }),
      ]);
      return message;
    } catch (err: any) {
      if (err?.code === "P2002") return null;
      throw err;
    }
  },

  isUserParticipant: async (conversationId: string, userId: string) => {
    const row = await prisma.conversationParticipant.findUnique({
      where: { conversationId_userId: { conversationId, userId } },
    });
    return !!row;
  },

  // Mark every unread message in this conversation that was NOT sent by `userId`
  // as read NOW. Uses the existing Message.readAt — no new column needed.
  markConversationRead: async (conversationId: string, userId: string) => {
    const result = await prisma.message.updateMany({
      where: { conversationId, readAt: null, senderId: { not: userId } },
      data: { readAt: new Date() },
    });
    return result.count;
  },
};
