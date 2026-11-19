import { useCallback, useEffect, useRef } from "react";
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

  // Which thread is open, read by the (re)connect handler without re-subscribing it.
  const activeConversationRef = useRef<string | null | undefined>(activeConversationId);
  activeConversationRef.current = activeConversationId;
  const conversationIdsKey = JSON.stringify(allConversationIds);

  // Join every conversation room, and do it AGAIN after every reconnect: a reconnect is a brand-new
  // server-side socket that sits in no room, so without this nothing sent after the drop is pushed.
  // Messages sent while the socket was down were never pushed to it either, so once the rooms are
  // joined again (acknowledged by the gateway, so nothing can slip in between) the open thread and the
  // conversation list are read again from the server.
  useEffect(() => {
    if (!socket || allConversationIds.length === 0) return;

    let cancelled = false;
    const joinAll = () => {
      const joins = allConversationIds.map(
        (conversationId) =>
          new Promise<void>((resolve) => {
            const timer = setTimeout(resolve, 4000);
            socket.emit(REALTIME_EVENTS.chatJoinConversation, { conversationId }, () => {
              clearTimeout(timer);
              resolve();
            });
          }),
      );
      void Promise.all(joins).then(() => {
        if (cancelled) return;
        const open = activeConversationRef.current;
        if (open) queryClient.invalidateQueries({ queryKey: ["messages", userScopeId, open] });
        queryClient.invalidateQueries({ queryKey: ["conversations", userScopeId] });
      });
    };

    if (socket.connected) joinAll();
    socket.on("connect", joinAll);

    return () => {
      cancelled = true;
      socket.off("connect", joinAll);
      allConversationIds.forEach((conversationId) => {
        socket.emit(REALTIME_EVENTS.chatLeaveConversation, { conversationId });
      });
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [socket, conversationIdsKey, queryClient, userScopeId]);

  // The message is saved over REST so the answer is a real acknowledgement: this resolves only once the
  // server has stored it, and REJECTS (the caller keeps the text and offers a retry) when it has not. The
  // socket used to carry sends, but `socket.emit` returns at once whether or not the socket is really still
  // up, so text typed in the seconds before a drop was noticed was cleared and lost with no error. The
  // gateway relays a REST send to the conversation room, so the other side still receives it live.
  const sendMessage = useCallback(
    async (conversationId: string, content: string) => {
      const text = content.trim();
      if (!text) return false;
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
    [queryClient, userScopeId],
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
