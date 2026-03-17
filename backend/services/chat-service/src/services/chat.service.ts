import { chatRepository } from '../repositories/chat.repository';
import { canCreateDirectChat } from './chat.policy';

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
    if (existing) return { conversation: existing, created: false };

    const conversation = await chatRepository.createDirectConversation(
      requestingUserId,
      targetUserId,
    );
    return { conversation, created: true };
  },

  async listConversations(userId: string) {
    const conversations = await chatRepository.findConversationsByUserId(userId);
    return { conversations };
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
    return { messages, page, limit };
  },

  async sendMessage(conversationId: string, senderId: string, content: string) {
    const isParticipant = await chatRepository.isUserParticipant(conversationId, senderId);
    if (!isParticipant) {
      throw Object.assign(new Error('Not a participant of this conversation'), { statusCode: 403 });
    }

    const message = await chatRepository.createMessage(conversationId, senderId, content);
    return { message };
  },
};
