import { useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useLocalSearchParams } from "expo-router";
import { useQuery } from "@tanstack/react-query";
import Animated, { FadeInDown, useAnimatedStyle, useSharedValue, withDelay, withRepeat, withSequence, withTiming } from "react-native-reanimated";
import { ChevronLeft, Phone, PhoneOff, Send, Video } from "lucide-react-native";

import { Avatar, inputPlaceholderColor, inputTextColor, useToast } from "../../../src/components/ui";
import { chatService } from "../../../src/services/api";
import { useApp } from "../../../src/context/AppContext";
import { useSocketContext } from "../../../src/context/SocketContext";
import { useCall } from "../../../src/features/call/CallProvider";
import { useWorkspaceAccent } from "../../../src/theme/workspace";
import { darkColors } from "../../../src/theme/colors";
import { REALTIME_EVENTS } from "../../../src/realtime/events";
import {
  canSend,
  dayDivider,
  isSystemMessage,
  systemMessageText,
  MAX_MESSAGE_LENGTH,
  messageTime,
  normalizeConversations,
  normalizeMessages,
  peerName,
  peerRoleLabel,
} from "../../../src/features/chat/chat";
import { conversationsKey, messagesKey, useRealtimeChat } from "../../../src/features/chat/useRealtimeChat";

/**
 * SH-04 — one conversation (the design's Chat, PT mode; web's ChatPage chat pane). Messages come
 * from `GET …/messages` then live over the gateway socket; sending goes through the socket (the
 * gateway persists before broadcasting) with a REST fallback when disconnected.
 *
 * Not drawn, because the backend has no data for them: read receipts (the design's ✓✓), online
 * presence. Voice/video call buttons (Phase 14.4) start a CHAT-origin call through CallProvider —
 * the call itself is the global CallOverlay, not this screen.
 */
export default function ConversationScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const { user } = useApp();
  const userId = user?.id ?? "guest";
  const { socket } = useSocketContext();
  const { conversationId } = useLocalSearchParams<{ conversationId: string }>();
  const id = String(conversationId ?? "");
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const scrollRef = useRef<ScrollView>(null);
  const typingSent = useRef(false);

  const convQuery = useQuery({ queryKey: conversationsKey(userId), queryFn: chatService.listConversations, enabled: !!user?.id });
  const conv = useMemo(() => normalizeConversations(convQuery.data).find((c) => c.id === id) ?? null, [convQuery.data, id]);
  const msgQuery = useQuery({
    queryKey: messagesKey(userId, id),
    queryFn: async () => normalizeMessages(await chatService.getMessages(id)),
    enabled: !!id && !!user?.id,
  });
  const messages = msgQuery.data ?? [];
  const { typingIn, sendMessage, sendTyping } = useRealtimeChat(id ? [id] : [], id);
  const typing = typingIn[id] === true;

  useEffect(() => {
    if (!socket) return;
    const onError = (p: { message?: string }) => toast.show(p?.message === "Failed to send message" ? "Không gửi được tin nhắn." : "Có lỗi trò chuyện, thử lại sau.", "danger");
    socket.on(REALTIME_EVENTS.chatError, onError);
    return () => {
      socket.off(REALTIME_EVENTS.chatError, onError);
    };
  }, [socket, toast]);

  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages.length, typing]);

  // Tell the peer we stopped typing when leaving the screen.
  useEffect(
    () => () => {
      if (typingSent.current && id) sendTyping(id, false);
    },
    [id, sendTyping],
  );

  const onChange = (text: string) => {
    setInput(text);
    const nowTyping = text.trim().length > 0;
    if (nowTyping !== typingSent.current) {
      typingSent.current = nowTyping;
      sendTyping(id, nowTyping);
    }
  };

  const send = async () => {
    if (!canSend(input) || sending) return;
    setSending(true);
    try {
      const ok = await sendMessage(id, input);
      if (ok) {
        setInput("");
        typingSent.current = false;
        sendTyping(id, false);
      }
    } catch {
      toast.show("Không gửi được tin nhắn.", "danger");
    } finally {
      setSending(false);
    }
  };

  // Opened straight from a push (E3) the conversation list may still be loading: show nothing
  // rather than the "Người dùng · Học viên" fallback, which names the wrong role for a PT.
  const loadingPeer = !conv && convQuery.isLoading;
  const name = loadingPeer ? "" : peerName(conv);
  const { initiateCall } = useCall();
  const peerId = conv?.otherUser?.id ?? null;

  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View className="border-b border-border bg-glass px-4 pb-3" style={{ paddingTop: insets.top + 12 }}>
        <View className="flex-row items-center gap-3">
          <Pressable
            accessibilityLabel="Quay lại"
            hitSlop={8}
            onPress={() => (router.canGoBack() ? router.back() : router.replace("/client/messages"))}
          >
            <ChevronLeft size={26} color={darkColors.foreground} />
          </Pressable>
          <Avatar name={name} size={40} />
          <View className="flex-1">
            <Text className="font-display text-base text-foreground" numberOfLines={1}>
              {name}
            </Text>
            <Text className="font-body text-xs text-primary">{typing ? "Đang soạn tin…" : loadingPeer ? "" : peerRoleLabel(conv?.otherUser?.role)}</Text>
          </View>
          {peerId ? (
            <>
              <Pressable
                accessibilityLabel="Gọi thoại"
                hitSlop={8}
                className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
                onPress={() => initiateCall(peerId, "VOICE", id, name)}
              >
                <Phone size={18} color={darkColors.foreground} />
              </Pressable>
              <Pressable
                accessibilityLabel="Gọi video"
                hitSlop={8}
                className="h-10 w-10 items-center justify-center rounded-full border border-border bg-card"
                onPress={() => initiateCall(peerId, "VIDEO", id, name)}
              >
                <Video size={18} color={darkColors.foreground} />
              </Pressable>
            </>
          ) : null}
        </View>
      </View>

      <ScrollView ref={scrollRef} className="flex-1" contentContainerStyle={{ padding: 16, gap: 10, flexGrow: 1, justifyContent: "flex-end" }}>
        {msgQuery.isLoading ? (
          <ActivityIndicator color={accent.primary} />
        ) : messages.length === 0 ? (
          <Text className="text-center font-body text-xs text-muted-foreground">Chưa có tin nhắn. Gửi lời chào nhé!</Text>
        ) : (
          messages.map((m, i) => {
            const divider = dayDivider(messages[i - 1], m);
            const mine = m.authorId === userId;
            return (
              <View key={m.id} className="gap-2.5">
                {divider ? <Text className="text-center font-body text-[11px] text-muted-foreground">{divider}</Text> : null}
                {isSystemMessage(m) ? (
                  <Animated.View entering={FadeInDown.springify().stiffness(400).damping(30)} className="items-center">
                    <View className="flex-row items-center gap-1.5 rounded-full bg-panel px-3 py-1.5">
                      <PhoneOff size={12} color={darkColors.mutedForeground} />
                      <Text className="font-body text-xs text-muted-foreground">{systemMessageText(m.content)}</Text>
                    </View>
                  </Animated.View>
                ) : (
                  <Animated.View entering={FadeInDown.springify().stiffness(400).damping(30)} className={`flex-row ${mine ? "justify-end" : "justify-start"}`}>
                    <View className={`max-w-[78%] rounded-2xl px-3.5 py-2.5 ${mine ? "rounded-br-md bg-primary" : "rounded-bl-md bg-panel"}`}>
                      <Text className={`font-body text-sm leading-5 ${mine ? "text-on-primary" : "text-foreground"}`}>{m.content}</Text>
                      <Text className={`mt-1 text-right font-body text-[10px] ${mine ? "text-on-primary/70" : "text-muted-foreground"}`}>{messageTime(m.createdAt)}</Text>
                    </View>
                  </Animated.View>
                )}
              </View>
            );
          })
        )}
        {typing ? <TypingDots /> : null}
      </ScrollView>

      <View className="border-t border-border bg-glass p-3" style={{ paddingBottom: insets.bottom + 12 }}>
        <View className="flex-row items-center gap-2">
          <TextInput
            value={input}
            onChangeText={onChange}
            placeholder="Nhắn tin..."
            placeholderTextColor={inputPlaceholderColor}
            maxLength={MAX_MESSAGE_LENGTH}
            multiline
            style={{ color: inputTextColor, maxHeight: 120 }}
            className="min-h-11 flex-1 rounded-3xl border border-border bg-panel px-4 py-2.5 font-body text-sm"
          />
          <Pressable
            accessibilityLabel="Gửi"
            disabled={!canSend(input) || sending}
            onPress={() => void send()}
            className={`h-11 w-11 items-center justify-center rounded-full bg-primary ${!canSend(input) || sending ? "opacity-40" : ""}`}
          >
            <Send size={18} strokeWidth={2.5} color={accent.onPrimary} />
          </Pressable>
        </View>
      </View>
    </KeyboardAvoidingView>
  );
}

function TypingDots() {
  return (
    <View className="flex-row justify-start">
      <View className="flex-row gap-1 rounded-2xl rounded-bl-md bg-panel px-4 py-3.5">
        {[0, 1, 2].map((d) => (
          <Dot key={d} delay={d * 150} />
        ))}
      </View>
    </View>
  );
}

function Dot({ delay }: { delay: number }) {
  const y = useSharedValue(0);
  useEffect(() => {
    y.value = withDelay(delay, withRepeat(withSequence(withTiming(-4, { duration: 300 }), withTiming(0, { duration: 300 })), -1));
  }, [delay, y]);
  const style = useAnimatedStyle(() => ({ transform: [{ translateY: y.value }] }));
  return <Animated.View style={style} className="h-1.5 w-1.5 rounded-full bg-muted-foreground" />;
}
