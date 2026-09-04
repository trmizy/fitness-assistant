import axios from "axios";
import type { Server, Socket } from "socket.io";
import { logger } from "@gym-coach/shared";
import {
  CLIENT_EVENTS,
  SERVER_EVENTS,
  type ChatMessagePayload,
} from "../events";
import { chatRoom } from "../rooms";
import { getSocketUser } from "../socketAuth";

const CHAT_SERVICE_URL =
  process.env.CHAT_SERVICE_URL || "http://localhost:3005";

type ConversationPayload = {
  conversationId?: unknown;
};

type SendMessagePayload = ConversationPayload & {
  content?: unknown;
};

type TypingPayload = ConversationPayload & {
  typing?: unknown;
};

function readConversationId(payload: ConversationPayload): string | null {
  return typeof payload?.conversationId === "string" &&
    payload.conversationId.trim()
    ? payload.conversationId.trim()
    : null;
}

function emitChatError(socket: Socket, message: string) {
  socket.emit(SERVER_EVENTS.chatError, { message });
}

async function verifyConversationAccess(
  socket: Socket,
  conversationId: string,
): Promise<boolean> {
  const token = socket.data.authToken;
  const { status } = await axios.get(
    `${CHAT_SERVICE_URL}/chat/conversations/${encodeURIComponent(conversationId)}/messages?page=1&limit=1`,
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 5000,
      validateStatus: () => true,
    },
  );

  return status >= 200 && status < 300;
}

async function forwardMessageToChatService(
  socket: Socket,
  conversationId: string,
  content: string,
): Promise<ChatMessagePayload> {
  const token = socket.data.authToken;
  const { data } = await axios.post(
    `${CHAT_SERVICE_URL}/chat/conversations/${encodeURIComponent(conversationId)}/messages`,
    { content },
    {
      headers: {
        Authorization: `Bearer ${token}`,
      },
      timeout: 10000,
      validateStatus: () => true,
    },
  );

  if (data?.error || !data?.id) {
    const error = new Error(data?.error || "Chat service rejected message");
    (error as Error & { status?: number }).status = 400;
    throw error;
  }

  return {
    id: String(data.id),
    conversationId,
    authorId: typeof data.authorId === "string" ? data.authorId : undefined,
    senderId: typeof data.senderId === "string" ? data.senderId : undefined,
    content: String(data.content || content),
    createdAt: String(data.createdAt || new Date().toISOString()),
  };
}

export function registerChatHandlers(io: Server, socket: Socket) {
  socket.on(
    CLIENT_EVENTS.chatJoinConversation,
    async (payload: ConversationPayload) => {
      const conversationId = readConversationId(payload);
      if (!conversationId) {
        emitChatError(socket, "Invalid conversation id");
        return;
      }

      try {
        const allowed = await verifyConversationAccess(socket, conversationId);
        if (!allowed) {
          emitChatError(socket, "Conversation not available");
          return;
        }

        await socket.join(chatRoom(conversationId));
        socket.data.activeChatRooms = new Set([
          ...Array.from(socket.data.activeChatRooms || []),
          conversationId,
        ]);
      } catch (err) {
        logger.warn(
          {
            userId: getSocketUser(socket).id,
            conversationId,
            message: err instanceof Error ? err.message : String(err),
          },
          "Socket chat join failed",
        );
        emitChatError(socket, "Failed to join conversation");
      }
    },
  );

  socket.on(
    CLIENT_EVENTS.chatLeaveConversation,
    async (payload: ConversationPayload) => {
      const conversationId = readConversationId(payload);
      if (!conversationId) return;
      await socket.leave(chatRoom(conversationId));
      if (socket.data.activeChatRooms instanceof Set) {
        socket.data.activeChatRooms.delete(conversationId);
      }
    },
  );

  const handleSendMessage = async (payload: SendMessagePayload) => {
    const conversationId = readConversationId(payload);
    const content =
      typeof payload?.content === "string" ? payload.content.trim() : "";

    if (!conversationId || !content) {
      emitChatError(socket, "Message content and conversation id are required");
      return;
    }

    try {
      const message = await forwardMessageToChatService(
        socket,
        conversationId,
        content,
      );
      const room = chatRoom(conversationId);

      io.to(room).emit(SERVER_EVENTS.chatMessageNew, message);
      io.to(room).emit(SERVER_EVENTS.chatMessageNewLegacy, message);
      io.to(room).emit(SERVER_EVENTS.chatConversationUpdatedLegacy, {
        conversationId,
        lastMessage: {
          content: message.content,
          createdAt: message.createdAt,
        },
      });
    } catch (err) {
      logger.warn(
        {
          userId: getSocketUser(socket).id,
          conversationId,
          message: err instanceof Error ? err.message : String(err),
        },
        "Socket chat send failed",
      );
      emitChatError(socket, "Failed to send message");
    }
  };

  socket.on(CLIENT_EVENTS.chatMessageSend, handleSendMessage);
  socket.on(CLIENT_EVENTS.chatMessageSendLegacy, handleSendMessage);

  socket.on(CLIENT_EVENTS.chatTyping, (payload: TypingPayload) => {
    const conversationId = readConversationId(payload);
    if (!conversationId) return;

    const user = getSocketUser(socket);
    socket.to(chatRoom(conversationId)).emit(SERVER_EVENTS.chatTyping, {
      conversationId,
      userId: user.id,
      typing: payload.typing === true,
    });
  });
}
