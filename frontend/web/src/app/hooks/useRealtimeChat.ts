import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  REALTIME_EVENTS,
  type RealtimeChatMessage,
} from "../realtime/events";
import { useApp } from "../context/AppContext";
import { chatService } from "../services/api";
import { useSocket } from "./useSocket";

function normalizeMessage(message: RealtimeChatMessage) {
  return {
    id: message.id,
    authorId: message.authorId || message.senderId,
    content: message.content,
    createdAt: message.createdAt,
    conversationId: message.conversationId,
  };
}

export function useRealtimeChat(
  activeConversationId?: string | null,
  allConversationIds: string[] = [],
) {
  const queryClient = useQueryClient();
  const { socket, status } = useSocket();
  const { user } = useApp();
  const userScopeId = user?.id ?? "guest";

  useEffect(() => {
    if (!socket) return;

    const handleMessage = (message: RealtimeChatMessage) => {
      const mapped = normalizeMessage(message);

      queryClient.setQueryData(
        ["messages", userScopeId, mapped.conversationId],
        (old: any[] | undefined) => {
          if (!old) return [mapped];
          if (old.some((item) => item.id === mapped.id)) return old;
          return [...old, mapped];
        },
      );

      queryClient.invalidateQueries({
        queryKey: ["conversations", userScopeId],
      });
    };

    const handleConversationUpdated = () => {
      queryClient.invalidateQueries({
        queryKey: ["conversations", userScopeId],
      });
    };

    socket.on(REALTIME_EVENTS.chatMessageNew, handleMessage);
    socket.on(REALTIME_EVENTS.chatMessageNewLegacy, handleMessage);
    socket.on(
      REALTIME_EVENTS.chatConversationUpdatedLegacy,
      handleConversationUpdated,
    );

    return () => {
      socket.off(REALTIME_EVENTS.chatMessageNew, handleMessage);
      socket.off(REALTIME_EVENTS.chatMessageNewLegacy, handleMessage);
      socket.off(
        REALTIME_EVENTS.chatConversationUpdatedLegacy,
        handleConversationUpdated,
      );
    };
  }, [queryClient, socket, userScopeId]);

  useEffect(() => {
    if (!socket || allConversationIds.length === 0) return;

    allConversationIds.forEach((conversationId) => {
      socket.emit(REALTIME_EVENTS.chatJoinConversation, { conversationId });
    });

    return () => {
      allConversationIds.forEach((conversationId) => {
        socket.emit(REALTIME_EVENTS.chatLeaveConversation, { conversationId });
      });
    };
  }, [socket, JSON.stringify(allConversationIds)]);

  // Over the socket when it is actually connected; over REST otherwise. `socket.emit` on a socket
  // that never connected only buffers: the box cleared, nothing was saved and nothing said so
  // (real browser, 7/10). The gateway relays a REST send to the conversation room, so the other
  // side still gets it live. A REST failure rejects — the caller keeps the text and says why.
  const sendMessage = useCallback(
    async (conversationId: string, content: string) => {
      const text = content.trim();
      if (!text) return false;
      if (socket?.connected) {
        socket.emit(REALTIME_EVENTS.chatMessageSend, { conversationId, content: text });
        return true;
      }
      const saved = await chatService.sendMessage(conversationId, text);
      if (saved?.id) {
        const mapped = normalizeMessage({ ...saved, conversationId: saved.conversationId ?? conversationId });
        queryClient.setQueryData(
          ["messages", userScopeId, conversationId],
          (old: any[] | undefined) => {
            if (!old) return [mapped];
            if (old.some((item) => item.id === mapped.id)) return old;
            return [...old, mapped];
          },
        );
      }
      queryClient.invalidateQueries({ queryKey: ["conversations", userScopeId] });
      return true;
    },
    [socket, queryClient, userScopeId],
  );

  const sendTyping = useCallback(
    (conversationId: string, typing: boolean) => {
      socket?.emit(REALTIME_EVENTS.chatTyping, { conversationId, typing });
    },
    [socket],
  );

  return {
    status,
    sendMessage,
    sendTyping,
  };
}
