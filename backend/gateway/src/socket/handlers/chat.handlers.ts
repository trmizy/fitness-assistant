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

/**
 * `message` keeps the short code older clients match on ("Failed to send message" is what the mobile app maps
 * to its own Vietnamese toast); `detail` is the Vietnamese sentence meant for the person, when there is one.
 */
function emitChatError(socket: Socket, message: string, detail?: string) {
  socket.emit(SERVER_EVENTS.chatError, detail ? { message, detail } : { message });
}

type Ack = ((result: { ok: boolean }) => void) | undefined;

function ackOnce(ack: unknown, ok: boolean) {
  if (typeof ack === "function") (ack as NonNullable<Ack>)({ ok });
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

/** The Vietnamese sentence chat-service attached to a refusal (locked account, too long, ...), if any. */
function detailFrom(err: unknown): string | undefined {
  const detail = (err as { detail?: unknown })?.detail;
  return typeof detail === "string" && detail ? detail : undefined;
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
    if (typeof data?.error === "string") (error as Error & { detail?: string }).detail = data.error;
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

/**
 * Everything a conversation room hears about a new message. Shared by the socket send path below
 * and the REST relay (chatRestRelay.ts), so a message sent over REST — the mobile app's fallback
 * while its socket is down — reaches the recipient live exactly like a socket-sent one.
 */
export function broadcastChatMessage(io: Server, message: ChatMessagePayload) {
  const room = chatRoom(message.conversationId);
  io.to(room).emit(SERVER_EVENTS.chatMessageNew, message);
  io.to(room).emit(SERVER_EVENTS.chatMessageNewLegacy, message);
  io.to(room).emit(SERVER_EVENTS.chatConversationUpdatedLegacy, {
    conversationId: message.conversationId,
    lastMessage: {
      content: message.content,
      createdAt: message.createdAt,
    },
  });
}

export function registerChatHandlers(io: Server, socket: Socket) {
  socket.on(
    CLIENT_EVENTS.chatJoinConversation,
    async (payload: ConversationPayload, ack?: Ack) => {
      const conversationId = readConversationId(payload);
      if (!conversationId) {
        emitChatError(socket, "Invalid conversation id", "Mã cuộc trò chuyện không hợp lệ");
        ackOnce(ack, false);
        return;
      }

      try {
        const allowed = await verifyConversationAccess(socket, conversationId);
        if (!allowed) {
          emitChatError(socket, "Conversation not available", "Không mở được cuộc trò chuyện này");
          ackOnce(ack, false);
          return;
        }

        await socket.join(chatRoom(conversationId));
        socket.data.activeChatRooms = new Set([
          ...Array.from(socket.data.activeChatRooms || []),
          conversationId,
        ]);
        // The client waits for this after a reconnect before it re-reads the thread, so nothing
        // sent between that read and the room join can be missed.
        ackOnce(ack, true);
      } catch (err) {
        logger.warn(
          {
            userId: getSocketUser(socket).id,
            conversationId,
            message: err instanceof Error ? err.message : String(err),
          },
          "Socket chat join failed",
        );
        emitChatError(socket, "Failed to join conversation", "Không tham gia được cuộc trò chuyện");
        ackOnce(ack, false);
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
      emitChatError(
        socket,
        "Message content and conversation id are required",
        "Tin nhắn không được để trống",
      );
      return;
    }

    try {
      const message = await forwardMessageToChatService(
        socket,
        conversationId,
        content,
      );
      broadcastChatMessage(io, message);
    } catch (err) {
      logger.warn(
        {
          userId: getSocketUser(socket).id,
          conversationId,
          message: err instanceof Error ? err.message : String(err),
        },
        "Socket chat send failed",
      );
      emitChatError(socket, "Failed to send message", detailFrom(err));
    }
  };

  socket.on(CLIENT_EVENTS.chatMessageSend, handleSendMessage);
  socket.on(CLIENT_EVENTS.chatMessageSendLegacy, handleSendMessage);

  socket.on(CLIENT_EVENTS.chatTyping, (payload: TypingPayload) => {
    const conversationId = readConversationId(payload);
    if (!conversationId) return;
    // Only a socket whose join was accepted (membership verified by chat-service) may relay typing;
    // otherwise a refused outsider could still ping the real participants.
    if (!socket.rooms.has(chatRoom(conversationId))) return;

    const user = getSocketUser(socket);
    socket.to(chatRoom(conversationId)).emit(SERVER_EVENTS.chatTyping, {
      conversationId,
      userId: user.id,
      typing: payload.typing === true,
    });
  });
}
