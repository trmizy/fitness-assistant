import { Server, Socket } from "socket.io";
import { logger, chatMessagesTotal } from "@gym-coach/shared";
import { chatRepository } from "../repositories/chat.repository";
import { sendMessageSchema } from "../models/chat.models";

interface JoinPayload {
  conversationId: string;
}
interface SendPayload {
  conversationId: string;
  content: string;
}

export function registerChatHandlers(
  io: Server,
  socket: Socket,
  user: { id: string; email: string },
) {
  // ── Join conversation room ───────────────────────────────────
  socket.on(
    "chat:join_conversation",
    async ({ conversationId }: JoinPayload) => {
      try {
        const ok = await chatRepository.isUserParticipant(
          conversationId,
          user.id,
        );
        if (!ok) {
          socket.emit("chat:error", {
            message: "Not a participant of this conversation",
          });
          return;
        }
        await socket.join(conversationId);
        logger.info(
          { userId: user.id, conversationId },
          "Joined conversation room",
        );
      } catch (error) {
        logger.error(error, "chat:join_conversation error");
        socket.emit("chat:error", { message: "Failed to join conversation" });
      }
    },
  );

  // ── Leave conversation room ──────────────────────────────────
  socket.on(
    "chat:leave_conversation",
    async ({ conversationId }: JoinPayload) => {
      await socket.leave(conversationId);
      logger.info(
        { userId: user.id, conversationId },
        "Left conversation room",
      );
    },
  );

  // ── Send message ─────────────────────────────────────────────
  socket.on(
    "chat:send_message",
    async ({ conversationId, content }: SendPayload) => {
      try {
        // Same Zod schema the REST POST /conversations/:id/messages endpoint
        // uses (min 1, max 5000 chars) — previously this socket path only
        // checked non-empty, so a message could bypass the REST length limit
        // entirely just by sending it over the socket instead.
        const parsed = sendMessageSchema.safeParse({ content });
        if (!parsed.success) {
          socket.emit("chat:error", {
            message: parsed.error.errors[0]?.message || "Invalid message content",
          });
          return;
        }

        // Security review 2026-09-03 (H3) — this used to re-query isUserParticipant on every
        // single message, identical to the DB round-trip chat:join_conversation above already
        // paid once. socket.rooms is Socket.IO's own built-in bookkeeping of which rooms THIS
        // socket has actually joined — and joining a room already required passing that same
        // DB check (above), so membership in the room is exactly as trustworthy as a fresh
        // query, with no separate cache to keep in sync or ever go stale relative to reality.
        if (!socket.rooms.has(conversationId)) {
          socket.emit("chat:error", {
            message: "Not a participant of this conversation",
          });
          return;
        }

        const message = await chatRepository.createMessage(
          conversationId,
          user.id,
          content.trim(),
        );

        // Record chat message metric
        chatMessagesTotal.inc();

        // Emit to ALL sockets in the conversation room (including sender for confirmation)
        io.to(conversationId).emit("chat:new_message", message);

        // Also notify all participants via their personal rooms (so conversation list updates)
        const conversation =
          await chatRepository.findConversationById(conversationId);
        if (conversation) {
          for (const p of conversation.participants) {
            io.to(`user:${p.userId}`).emit("chat:conversation_updated", {
              conversationId,
              lastMessage: {
                content: message.content,
                createdAt: message.createdAt,
              },
            });
          }
        }
      } catch (error) {
        logger.error(error, "chat:send_message error");
        socket.emit("chat:error", { message: "Failed to send message" });
      }
    },
  );
}
