import { useEffect, useRef, useState } from "react";
import { FlatList, KeyboardAvoidingView, Platform, Pressable, View } from "react-native";
import { useLocalSearchParams } from "expo-router";
import { useQueryClient } from "@tanstack/react-query";
import { Feather } from "@expo/vector-icons";
import { Screen, Text, Input, Button, colors, spacing } from "../../../../src/ui";
import { coachApi } from "../../../../src/api/coach";
import { getApiErrorMessage } from "../../../../src/api/client";
import { queryKeys, useCoachSessionMessagesQuery } from "../../../../src/api/queries";
import { MessageBubble } from "../../../../src/features/coach/MessageBubble";

interface LocalMessage {
  id: string;
  question: string;
  answer?: string;
  pending?: boolean;
  error?: string;
}

let localIdCounter = 0;
const nextId = () => `local-${++localIdCounter}`;

export default function CoachThreadScreen() {
  const { sessionId: routeSessionId } = useLocalSearchParams<{ sessionId: string }>();
  const isNew = routeSessionId === "new";
  const queryClient = useQueryClient();

  const [effectiveSessionId, setEffectiveSessionId] = useState<string | undefined>(
    isNew ? undefined : routeSessionId,
  );
  const { data: history } = useCoachSessionMessagesQuery(isNew ? "" : routeSessionId);
  const [messages, setMessages] = useState<LocalMessage[]>([]);
  const [seededFromHistory, setSeededFromHistory] = useState(false);
  const [input, setInput] = useState("");
  const abortRef = useRef<AbortController | null>(null);
  const listRef = useRef<FlatList>(null);

  useEffect(() => {
    if (!seededFromHistory && history?.messages) {
      setMessages(
        history.messages.map((m) => ({ id: m.id, question: m.question, answer: m.answer })),
      );
      setSeededFromHistory(true);
    }
  }, [history, seededFromHistory]);

  const isSending = messages.some((m) => m.pending);

  const onSend = async () => {
    const question = input.trim();
    if (!question || isSending) return;
    setInput("");

    const localId = nextId();
    setMessages((prev) => [...prev, { id: localId, question, pending: true }]);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      const result = await coachApi.ask(question, effectiveSessionId, controller.signal);
      setMessages((prev) =>
        prev.map((m) => (m.id === localId ? { ...m, answer: result.answer, pending: false } : m)),
      );
      if (!effectiveSessionId) {
        setEffectiveSessionId(result.sessionId);
        void queryClient.invalidateQueries({ queryKey: queryKeys.coachSessions });
      } else {
        void queryClient.invalidateQueries({ queryKey: queryKeys.coachSessionMessages(effectiveSessionId) });
      }
    } catch (err) {
      const cancelled = controller.signal.aborted;
      setMessages((prev) =>
        prev.map((m) =>
          m.id === localId
            ? { ...m, pending: false, error: cancelled ? "Đã huỷ" : getApiErrorMessage(err, "Không thể gửi tin nhắn") }
            : m,
        ),
      );
    } finally {
      abortRef.current = null;
    }
  };

  const onCancel = () => {
    abortRef.current?.abort();
  };

  return (
    <KeyboardAvoidingView
      style={{ flex: 1 }}
      behavior={Platform.OS === "ios" ? "padding" : undefined}
      keyboardVerticalOffset={80}
    >
      <Screen padded={false} style={{ flex: 1 }} keyboardAvoiding={false}>
        <FlatList
          ref={listRef}
          data={messages}
          keyExtractor={(item) => item.id}
          contentContainerStyle={{ padding: spacing.lg }}
          onContentSizeChange={() => listRef.current?.scrollToEnd({ animated: true })}
          renderItem={({ item }) => (
            <View>
              <MessageBubble role="user" text={item.question} />
              {item.pending || item.answer || item.error ? (
                <MessageBubble role="assistant" text={item.answer} pending={item.pending} error={item.error} />
              ) : null}
            </View>
          )}
        />

        <View
          style={{
            flexDirection: "row",
            alignItems: "flex-end",
            gap: spacing.sm,
            padding: spacing.lg,
            borderTopWidth: 1,
            borderTopColor: colors.border,
          }}
        >
          <View style={{ flex: 1 }}>
            <Input
              placeholder="Hỏi AI coach..."
              value={input}
              onChangeText={setInput}
              multiline
              editable={!isSending}
            />
          </View>
          {isSending ? (
            <Button label="Huỷ" variant="danger" onPress={onCancel} />
          ) : (
            <Pressable
              accessibilityRole="button"
              accessibilityLabel="Gửi"
              onPress={onSend}
              disabled={!input.trim()}
              style={{
                width: 44,
                height: 44,
                borderRadius: 22,
                backgroundColor: input.trim() ? colors.accent : colors.surfaceAlt,
                alignItems: "center",
                justifyContent: "center",
              }}
            >
              <Feather name="send" size={18} color={input.trim() ? colors.onAccent : colors.textMuted} />
            </Pressable>
          )}
        </View>
        {isSending ? (
          <View style={{ paddingHorizontal: spacing.lg, paddingBottom: spacing.sm }}>
            <Text variant="small">Có thể mất tới 3 phút với câu hỏi phức tạp</Text>
          </View>
        ) : null}
      </Screen>
    </KeyboardAvoidingView>
  );
}
