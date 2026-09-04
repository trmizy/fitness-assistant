import { useCallback, useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  REALTIME_EVENTS,
  type RealtimeChatMessage,
} from "../realtime/events";
import { useApp } from "../context/AppContext";
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

  const sendMessage = useCallback(
    (conversationId: string, content: string) => {
      if (!socket || !content.trim()) return false;
      socket.emit(REALTIME_EVENTS.chatMessageSend, {
        conversationId,
        content: content.trim(),
      });
      return true;
    },
    [socket],
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
