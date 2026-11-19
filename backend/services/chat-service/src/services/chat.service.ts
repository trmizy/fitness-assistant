import { logger } from "@gym-coach/shared";
import { chatRepository } from "../repositories/chat.repository";
import { canCreateDirectChat } from "./chat.policy";
import { getIo } from "../socket";
import { getInternalUser } from "../clients/auth-service.client";
import { pushNewMessage } from "./push-relay";

const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET ||
  process.env.INTERNAL_API_SECRET ||
  "dev_internal_service_secret_change_in_production";

async function fetchUserInfo(
  userId: string,
): Promise<{ id: string; firstName: string; lastName: string; role: string }> {
  try {
    const data = await getInternalUser(userId, INTERNAL_SERVICE_SECRET);
    const user = data.user;
    if (user) {
      return {
        id: user.id,
        firstName: user.firstName || "",
        lastName: user.lastName || "",
        role: user.role || "CUSTOMER",
      };
    }
  } catch (err) {
    logger.warn({ userId }, "Failed to fetch user info for chat");
  }
  return { id: userId, firstName: "Người dùng", lastName: "", role: "CUSTOMER" };
}

/**
 * Is this account known to be deactivated? Only a definite `isActive === false` from auth-service counts:
 * when the lookup itself fails the message is NOT refused (a lookup outage must not silence every chat;
 * the sender's own token was already verified by auth-service for this very request).
 */
async function isAccountDeactivated(userId: string): Promise<boolean> {
  try {
    const data = await getInternalUser(userId, INTERNAL_SERVICE_SECRET);
    return data?.user?.isActive === false;
  } catch (err) {
    logger.warn({ userId }, "Could not check account status before sending a chat message");
    return false;
  }
}

export const NOT_PARTICIPANT_MESSAGE = "Bạn không thuộc cuộc trò chuyện này";
export const PEER_DEACTIVATED_MESSAGE =
  "Không thể gửi tin nhắn: tài khoản của người nhận hiện không hoạt động";

export const chatService = {
  /**
   * Refuses (403, Vietnamese message) when any OTHER participant of the conversation is a locked /
   * deactivated account. Returns the conversation so callers do not read it twice.
   */
  async assertPeersActive(conversationId: string, senderId: string) {
    const conversation =
      await chatRepository.findConversationById(conversationId);
    const others = (conversation?.participants ?? []).filter(
      (p) => p.userId !== senderId,
    );
    const lockedFlags = await Promise.all(
      others.map((p) => isAccountDeactivated(p.userId)),
    );
    if (lockedFlags.some(Boolean)) {
      throw Object.assign(new Error(PEER_DEACTIVATED_MESSAGE), {
        statusCode: 403,
      });
    }
    return conversation;
  },

  async createOrGetDirectConversation(
    requestingUserId: string,
    targetUserId: string,
    authToken: string,
  ) {
    if (requestingUserId === targetUserId) {
      throw Object.assign(new Error("Bạn không thể nhắn tin cho chính mình"), {
        statusCode: 400,
      });
    }

    const allowed = await canCreateDirectChat(
      requestingUserId,
      targetUserId,
      authToken,
    );
    if (!allowed) {
      throw Object.assign(
        new Error("Chỉ có thể nhắn tin giữa huấn luyện viên và học viên có liên hệ với nhau"),
        { statusCode: 403 },
      );
    }

    const existing = await chatRepository.findExistingDirectConversation(
      requestingUserId,
      targetUserId,
    );
    if (existing)
      return { id: existing.id, conversation: existing, created: false };

    const conversation = await chatRepository.createDirectConversation(
      requestingUserId,
      targetUserId,
    );
    return { id: conversation.id, conversation, created: true };
  },

  async listConversations(userId: string) {
    const rawConversations =
      await chatRepository.findConversationsByUserId(userId);

    // Enrich with user info for the "other" participant
    const conversations = await Promise.all(
      rawConversations.map(async (conv) => {
        const otherParticipant = conv.participants.find(
          (p) => p.userId !== userId,
        );
        const otherUser = otherParticipant
          ? await fetchUserInfo(otherParticipant.userId)
          : { id: "", firstName: "Người dùng", lastName: "", role: "CUSTOMER" };

        const lastMsg = conv.messages?.[0];
        return {
          id: conv.id,
          type: conv.type,
          otherUser,
          lastMessage: lastMsg
            ? { id: lastMsg.id, content: lastMsg.content, createdAt: lastMsg.createdAt }
            : null,
          lastMessageAt: conv.lastMessageAt,
          createdAt: conv.createdAt,
        };
      }),
    );

    return conversations;
  },

  async getMessages(
    conversationId: string,
    userId: string,
    page: number,
    limit: number,
    beforeId?: string,
  ) {
    const isParticipant = await chatRepository.isUserParticipant(
      conversationId,
      userId,
    );
    if (!isParticipant) {
      throw Object.assign(new Error(NOT_PARTICIPANT_MESSAGE), {
        statusCode: 403,
      });
    }

    const skip = (page - 1) * limit;
    const messages = await chatRepository.findMessagesByConversationId(
      conversationId,
      {
        skip,
        take: limit,
        beforeId,
      },
    );
    // Map senderId → authorId for frontend compatibility
    return messages.map((m) => ({
      id: m.id,
      authorId: m.senderId,
      content: m.content,
      createdAt: m.createdAt,
      conversationId: m.conversationId,
    }));
  },

  async sendMessage(conversationId: string, senderId: string, content: string) {
    const isParticipant = await chatRepository.isUserParticipant(
      conversationId,
      senderId,
    );
    if (!isParticipant) {
      throw Object.assign(new Error(NOT_PARTICIPANT_MESSAGE), {
        statusCode: 403,
      });
    }

    // A locked/deactivated account on the other end: nothing is stored and nobody is notified.
    const conversation = await chatService.assertPeersActive(
      conversationId,
      senderId,
    );

    const message = await chatRepository.createMessage(
      conversationId,
      senderId,
      content,
    );

    // BUG FIX (2026-09-05): this REST path persisted the message but never told anyone —
    // only the Socket.IO path (chat.handler.ts's "chat:send_message" event) broadcast
    // chat:new_message/chat:conversation_updated. Any caller that sends over REST instead
    // of the socket (the mobile app, or a web client whose socket briefly dropped) had its
    // message land silently: the recipient never got a live update and only saw it after
    // reloading (which re-fetches via GET and finds the row already there). Mirror the
    // socket handler's broadcast here so BOTH send paths notify participants identically.
    const io = getIo();
    if (io) {
      io.to(conversationId).emit("chat:new_message", message);
      if (conversation) {
        for (const p of conversation.participants) {
          io.to(`user:${p.userId}`).emit("chat:conversation_updated", {
            conversationId,
            lastMessage: { content: message.content, createdAt: message.createdAt },
          });
        }
      }
    }
    // Mobile E3 — phone push to the other participants, same as the socket send path.
    if (conversation) {
      void pushNewMessage({
        conversationId,
        senderId,
        content: message.content,
        participantIds: conversation.participants.map((p) => p.userId),
      });
    }

    return {
      id: message.id,
      authorId: message.senderId,
      content: message.content,
      createdAt: message.createdAt,
      conversationId: message.conversationId,
    };
  },
};
