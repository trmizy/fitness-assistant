import { useCallback, useEffect, useRef, useState } from "react";
import { useQueryClient } from "@tanstack/react-query";

import { useSocketContext } from "../../context/SocketContext";
import { useApp } from "../../context/AppContext";
import { chatService } from "../../services/api";
import { REALTIME_EVENTS, type RealtimeChatMessage } from "../../realtime/events";
import { ensureFreshSocket, isSocketTokenStale } from "../../realtime/socketClient";
import { mergeMessage, normalizeMessage, type ChatMessage } from "./chat";

// Room membership is shared by every screen using this hook (the list stays mounted under an open
// thread), so joins/leaves are reference-counted: a thread closing must not pull the list out of a
// room it still needs.
const roomRefs = new Map<string, number>();

export const conversationsKey = (userId: string) => ["conversations", userId] as const;
export const messagesKey = (userId: string, conversationId: string) => ["messages", userId, conversationId] as const;

/**
 * Web's `useRealtimeChat`, on the gateway socket SocketProvider already keeps open (and reconnects
 * on foreground — ADAPTERS §8). Joins every conversation room so the list updates live, merges
 * pushed messages into the React Query cache (deduped: the gateway sends each message on two event
 * names and echoes it to the sender), and exposes the peer's typing state.
 *
 * Rooms are re-joined on every (re)connect: a room membership does not survive a dropped transport,
 * so without this a chat reopened after the app sat in the background would stop receiving pushes.
 *
 * Mobile addition: if the socket is not connected at send time, the message goes through the REST
 * endpoint instead of being dropped (it is persisted either way; the list refetches).
 */
export function useRealtimeChat(conversationIds: string[], activeConversationId?: string | null) {
  const queryClient = useQueryClient();
  const { socket, connected, status } = useSocketContext();
  const { user } = useApp();
  const userId = user?.id ?? "guest";
  const [typingIn, setTypingIn] = useState<Record<string, boolean>>({});
  const typingTimers = useRef<Record<string, ReturnType<typeof setTimeout>>>({});
  const idsKey = conversationIds.join(",");

  useEffect(() => {
    if (!socket) return;
    const onMessage = (raw: RealtimeChatMessage) => {
      const m = normalizeMessage(raw);
      queryClient.setQueryData<ChatMessage[]>(messagesKey(userId, m.conversationId), (old) => mergeMessage(old, m));
      void queryClient.invalidateQueries({ queryKey: conversationsKey(userId) });
      if (m.authorId !== userId) setTypingIn((t) => ({ ...t, [m.conversationId]: false }));
    };
    const onUpdated = () => void queryClient.invalidateQueries({ queryKey: conversationsKey(userId) });
    const onTyping = (p: { conversationId: string; userId: string; typing: boolean }) => {
      if (!p?.conversationId || p.userId === userId) return;
      setTypingIn((t) => ({ ...t, [p.conversationId]: p.typing }));
      clearTimeout(typingTimers.current[p.conversationId]);
      // A lost "stopped typing" event must not leave the dots on forever.
      if (p.typing) typingTimers.current[p.conversationId] = setTimeout(() => setTypingIn((t) => ({ ...t, [p.conversationId]: false })), 6000);
    };
    socket.on(REALTIME_EVENTS.chatMessageNew, onMessage);
    socket.on(REALTIME_EVENTS.chatConversationUpdatedLegacy, onUpdated);
    socket.on(REALTIME_EVENTS.chatTyping, onTyping);
    return () => {
      socket.off(REALTIME_EVENTS.chatMessageNew, onMessage);
      socket.off(REALTIME_EVENTS.chatConversationUpdatedLegacy, onUpdated);
      socket.off(REALTIME_EVENTS.chatTyping, onTyping);
    };
  }, [socket, queryClient, userId]);

  useEffect(() => {
    if (!socket || !connected || !idsKey) return;
    // A join with a stale handshake token is refused by the gateway (GAP-14). Reconnecting flips
    // `connected` off and on again, which re-runs this effect with a fresh token.
    if (isSocketTokenStale()) {
      void ensureFreshSocket();
      return;
    }
    const ids = idsKey.split(",");
    for (const id of ids) {
      const n = roomRefs.get(id) ?? 0;
      roomRefs.set(id, n + 1);
      // Joining again on every (re)connect is harmless and needed: membership dies with the transport.
      socket.emit(REALTIME_EVENTS.chatJoinConversation, { conversationId: id });
    }
    // Messages that arrived while disconnected are only in the database — refetch the open thread.
    if (activeConversationId) void queryClient.invalidateQueries({ queryKey: messagesKey(userId, activeConversationId) });
    return () => {
      for (const id of ids) {
        const n = (roomRefs.get(id) ?? 1) - 1;
        if (n <= 0) {
          roomRefs.delete(id);
          socket.emit(REALTIME_EVENTS.chatLeaveConversation, { conversationId: id });
        } else roomRefs.set(id, n);
      }
    };
  }, [socket, connected, idsKey, activeConversationId, queryClient, userId]);

  useEffect(
    () => () => {
      Object.values(typingTimers.current).forEach(clearTimeout);
    },
    [],
  );

  const sendMessage = useCallback(
    async (conversationId: string, content: string) => {
      const text = content.trim();
      if (!text) return false;
      if (socket && connected && (await ensureFreshSocket())) {
        socket.emit(REALTIME_EVENTS.chatMessageSend, { conversationId, content: text });
        return true;
      }
      const saved: any = await chatService.sendMessage(conversationId, text);
      const m = normalizeMessage(saved?.data ?? saved);
      queryClient.setQueryData<ChatMessage[]>(messagesKey(userId, conversationId), (old) => mergeMessage(old, m));
      void queryClient.invalidateQueries({ queryKey: conversationsKey(userId) });
      return true;
    },
    [socket, connected, queryClient, userId],
  );

  const sendTyping = useCallback(
    (conversationId: string, typing: boolean) => {
      if (socket && connected) socket.emit(REALTIME_EVENTS.chatTyping, { conversationId, typing });
    },
    [socket, connected],
  );

  return { status, connected, typingIn, sendMessage, sendTyping };
}
