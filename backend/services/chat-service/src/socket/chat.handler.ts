import { Server, Socket } from 'socket.io';
import { logger } from '@gym-coach/shared';
import { chatRepository } from '../repositories/chat.repository';

interface JoinPayload { conversationId: string }
interface SendPayload { conversationId: string; content: string }

export function registerChatHandlers(
  io: Server,
  socket: Socket,
  user: { id: string; email: string },
) {
  // ── Join conversation room ───────────────────────────────────
  socket.on('chat:join_conversation', async ({ conversationId }: JoinPayload) => {
    try {
      const ok = await chatRepository.isUserParticipant(conversationId, user.id);
      if (!ok) {
        socket.emit('chat:error', { message: 'Not a participant of this conversation' });
        return;
      }
      await socket.join(conversationId);
      logger.info({ userId: user.id, conversationId }, 'Joined conversation room');
    } catch (error) {
      logger.error(error, 'chat:join_conversation error');
      socket.emit('chat:error', { message: 'Failed to join conversation' });
    }
  });

  // ── Leave conversation room ──────────────────────────────────
  socket.on('chat:leave_conversation', async ({ conversationId }: JoinPayload) => {
    await socket.leave(conversationId);
    logger.info({ userId: user.id, conversationId }, 'Left conversation room');
  });

  // ── Send message ─────────────────────────────────────────────
  socket.on('chat:send_message', async ({ conversationId, content }: SendPayload) => {
    try {
      if (!content?.trim()) {
        socket.emit('chat:error', { message: 'Message content cannot be empty' });
        return;
      }

      const ok = await chatRepository.isUserParticipant(conversationId, user.id);
      if (!ok) {
        socket.emit('chat:error', { message: 'Not a participant of this conversation' });
        return;
      }

      const message = await chatRepository.createMessage(
        conversationId,
        user.id,
        content.trim(),
      );

      // Emit to ALL sockets in the conversation room (including sender for confirmation)
      io.to(conversationId).emit('chat:new_message', message);

      // Also notify all participants via their personal rooms (so conversation list updates)
      const conversation = await chatRepository.findConversationById(conversationId);
      if (conversation) {
        for (const p of conversation.participants) {
          io.to(`user:${p.userId}`).emit('chat:conversation_updated', {
            conversationId,
            lastMessage: { content: message.content, createdAt: message.createdAt },
          });
        }
      }
    } catch (error) {
      logger.error(error, 'chat:send_message error');
      socket.emit('chat:error', { message: 'Failed to send message' });
    }
  });
}
