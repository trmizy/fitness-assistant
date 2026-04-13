import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { chatRepository } from '../repositories/chat.repository';
import { canCreateDirectChat } from './chat.policy';

const AUTH_SERVICE_URL = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
const INTERNAL_SERVICE_SECRET =
  process.env.INTERNAL_SERVICE_SECRET || 'dev_internal_service_secret_change_in_production';

async function fetchUserInfo(userId: string): Promise<{ id: string; firstName: string; lastName: string; role: string }> {
  try {
    const { data } = await axios.get(`${AUTH_SERVICE_URL}/auth/internal/users/${userId}`, {
      headers: { 'x-service-secret': INTERNAL_SERVICE_SECRET },
      timeout: 3000,
    });
    const user = data.user;
    if (user) {
      return { id: user.id, firstName: user.firstName || '', lastName: user.lastName || '', role: user.role || 'CUSTOMER' };
    }
  } catch (err) {
    logger.warn({ userId }, 'Failed to fetch user info for chat');
  }
  return { id: userId, firstName: 'User', lastName: '', role: 'CUSTOMER' };
}

export const chatService = {
  async createOrGetDirectConversation(
    requestingUserId: string,
    targetUserId: string,
    authToken: string,
  ) {
    if (requestingUserId === targetUserId) {
      throw Object.assign(new Error('Cannot chat with yourself'), { statusCode: 400 });
    }

    const allowed = await canCreateDirectChat(requestingUserId, targetUserId, authToken);
    if (!allowed) {
      throw Object.assign(
        new Error('Chat is only available between a PT and a client'),
        { statusCode: 403 },
      );
    }

    const existing = await chatRepository.findExistingDirectConversation(
      requestingUserId,
      targetUserId,
    );
    if (existing) return { id: existing.id, conversation: existing, created: false };

    const conversation = await chatRepository.createDirectConversation(
      requestingUserId,
      targetUserId,
    );
    return { id: conversation.id, conversation, created: true };
  },

  async listConversations(userId: string) {
    const rawConversations = await chatRepository.findConversationsByUserId(userId);

    // Enrich with user info for the "other" participant
    const conversations = await Promise.all(
      rawConversations.map(async (conv) => {
        const otherParticipant = conv.participants.find((p) => p.userId !== userId);
        const otherUser = otherParticipant
          ? await fetchUserInfo(otherParticipant.userId)
          : { id: '', firstName: 'Unknown', lastName: '', role: 'CUSTOMER' };

        const lastMsg = conv.messages?.[0];
        return {
          id: conv.id,
          type: conv.type,
          otherUser,
          lastMessage: lastMsg
            ? { content: lastMsg.content, createdAt: lastMsg.createdAt }
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
  ) {
    const isParticipant = await chatRepository.isUserParticipant(conversationId, userId);
    if (!isParticipant) {
      throw Object.assign(new Error('Not a participant of this conversation'), { statusCode: 403 });
    }

    const skip = (page - 1) * limit;
    const messages = await chatRepository.findMessagesByConversationId(conversationId, {
      skip,
      take: limit,
    });
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
    const isParticipant = await chatRepository.isUserParticipant(conversationId, senderId);
    if (!isParticipant) {
      throw Object.assign(new Error('Not a participant of this conversation'), { statusCode: 403 });
    }

    const message = await chatRepository.createMessage(conversationId, senderId, content);
    return {
      id: message.id,
      authorId: message.senderId,
      content: message.content,
      createdAt: message.createdAt,
    };
  },
};
