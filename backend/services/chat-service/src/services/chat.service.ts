import { createHash } from "node:crypto";
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

/** The system line posted when a paid contract connects a PT and a client (Vietnamese UI text). */
export function contractConnectedContent(packageName?: string | null): string {
  const name = (packageName ?? "").trim();
  return `Hai bạn đã kết nối qua hợp đồng ${name || "huấn luyện"}. Hãy nhắn tin để trao đổi lịch tập.`;
}

/** Deterministic UUID (v5-shaped) of the "connected via contract" line, so posting it twice is a primary-key conflict. */
export function contractConnectedMessageId(contractId: string): string {
  const h = createHash("sha1").update(`contract-connected:${contractId}`).digest();
  h[6] = (h[6] & 0x0f) | 0x50;
  h[8] = (h[8] & 0x3f) | 0x80;
  const x = h.subarray(0, 16).toString("hex");
  return `${x.slice(0, 8)}-${x.slice(8, 12)}-${x.slice(12, 16)}-${x.slice(16, 20)}-${x.slice(20, 32)}`;
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

    // Get-or-create under a per-pair lock (idempotent; two simultaneous "Nhắn tin" taps make ONE conversation).
    const { conversation, created } =
      await chatRepository.findOrCreateDirectConversation(
        requestingUserId,
        targetUserId,
      );
    return { id: conversation.id, conversation, created };
  },

  /**
   * INTERNAL (user-service, after a contract's payment activates it): make sure the PT and the client have a
   * 1-1 conversation and post ONE system line announcing the connection. The caller is a trusted service (shared
   * secret), so the chat eligibility check is not repeated - the contract IS the relationship.
   *
   * Idempotent at both levels: the conversation is get-or-create, and the system line carries an id derived from the
   * contract id, so a retry / webhook replay hits a primary-key conflict and posts nothing a second time.
   */
  async connectContractParties(input: {
    ptUserId: string;
    clientUserId: string;
    contractId: string;
    packageName?: string | null;
  }) {
    if (input.ptUserId === input.clientUserId) {
      throw Object.assign(new Error("Hai người dùng phải khác nhau"), { statusCode: 400 });
    }
    const { conversation, created } =
      await chatRepository.findOrCreateDirectConversation(
        input.ptUserId,
        input.clientUserId,
      );
    const content = contractConnectedContent(input.packageName);
    const message = await chatRepository.createMessageOnce(
      contractConnectedMessageId(input.contractId),
      conversation.id,
      "system",
      content,
    );
    if (message) {
      const io = getIo();
      if (io) {
        const payload = {
          id: message.id,
          authorId: message.senderId,
          content: message.content,
          createdAt: message.createdAt,
          conversationId: message.conversationId,
        };
        for (const p of conversation.participants) {
          io.to(`user:${p.userId}`).emit("chat:message", payload);
          io.to(`user:${p.userId}`).emit("chat:conversation_updated", {
            conversationId: conversation.id,
            lastMessage: { content: message.content, createdAt: message.createdAt },
          });
        }
      }
    }
    return { conversationId: conversation.id, conversationCreated: created, messagePosted: !!message };
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
