import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ActivityIndicator, Alert, Image, KeyboardAvoidingView, Platform, Pressable, ScrollView, Text, TextInput, View } from "react-native";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { router, useFocusEffect } from "expo-router";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import Animated, { FadeInDown } from "react-native-reanimated";
import { AlertCircle, Camera, ChevronLeft, History, ImagePlus, MessageSquare, Pencil, Plus, Send, Sparkles, Trash2, X } from "lucide-react-native";

import { BottomSheet, Button, EmptyState, Input, Tappable, inputPlaceholderColor, inputTextColor, useToast } from "../../src/components/ui";
import { coachService, fitnessAgentService, inbodyService, type AgentReply, type AiChatSessionSummary } from "../../src/services/api";
import { useApp } from "../../src/context/AppContext";
import { useWorkspaceAccent } from "../../src/theme/workspace";
import { darkColors, designTokens } from "../../src/theme/colors";
import { agentErrorMessage, greetingText, relativeTime, suggestions, visibleEvidence } from "../../src/features/coach/coach";
import {
  appendAgentReply,
  appendImageChatExchange,
  hydrateCoachSession,
  newDraftKey,
  resetCoachSession,
  seedCoachGreeting,
  sendCoachQuestion,
  useCoachSession,
} from "../../src/features/coach/coachStore";
import { AgentBlock } from "../../src/features/coach/AgentBlocks";
import { CoachText, EvidenceSources } from "../../src/features/coach/CoachText";
import { pickAgentImage, type PickedImage } from "../../src/features/coach/pickImage";

const sessionsKey = (userId: string) => ["ai-sessions", userId] as const;

/**
 * WB-12 — AI Coach, opened from the floating button (Ngài's choice 22/9: follow web's
 * AICoachFloatingButton/Panel, not a chat-tab entry). Visual source: the design's `Chat mode="AI
 * Coach"`; behaviour: web's `AICoachPage` in its compact (single-pane) form — a thread view with
 * a history list one tap away.
 *
 * Answers stream over `POST /ai/ask/stream` (expo/fetch) and live in `coachStore`, so closing this
 * screen mid-answer does not lose it. Photo flows use the two `/ai/agent/*` image endpoints web
 * uses: "ask about a photo" (staged, sent with the typed question) and "reference body photo"
 * (goal suggestion, sent immediately).
 */
export default function AiCoachScreen() {
  const insets = useSafeAreaInsets();
  const accent = useWorkspaceAccent();
  const toast = useToast();
  const queryClient = useQueryClient();
  const { user } = useApp();
  const userId = user?.id ?? "guest";

  const [view, setView] = useState<"chat" | "list">("chat");
  const [activeSessionId, setActiveSessionId] = useState<string | null>(null);
  const [draftKey, setDraftKey] = useState(() => newDraftKey());
  const key = activeSessionId ?? draftKey;
  const session = useCoachSession(userId, key);
  const messages = session.messages;
  const processing = session.status === "processing";

  const [input, setInput] = useState("");
  const [attachOpen, setAttachOpen] = useState(false);
  const [staged, setStaged] = useState<PickedImage | null>(null);
  const [imageBusy, setImageBusy] = useState<null | "chat" | "goal">(null);
  const [imageError, setImageError] = useState("");
  const [renameTarget, setRenameTarget] = useState<AiChatSessionSummary | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const scrollRef = useRef<ScrollView>(null);

  // Tab screens stay mounted when you leave them, and a BottomSheet is its own native window —
  // an open sheet would otherwise stay on top of whatever screen comes next.
  useFocusEffect(
    useCallback(
      () => () => {
        setAttachOpen(false);
        setRenameTarget(null);
      },
      [],
    ),
  );

  const sessionsQuery = useQuery({ queryKey: sessionsKey(userId), queryFn: coachService.listSessions, refetchInterval: 10_000, enabled: !!user?.id });
  const sessions = sessionsQuery.data ?? [];

  const threadQuery = useQuery({
    queryKey: ["ai-session-messages", userId, activeSessionId],
    queryFn: () => coachService.getSessionMessages(activeSessionId!),
    enabled: !!activeSessionId && !!user?.id,
  });
  useEffect(() => {
    if (activeSessionId && threadQuery.data) hydrateCoachSession(userId, activeSessionId, threadQuery.data);
  }, [userId, activeSessionId, threadQuery.data]);

  const inbodyQuery = useQuery({ queryKey: ["inbody-history"], queryFn: inbodyService.getHistory });
  const history: any[] = useMemo(() => (Array.isArray(inbodyQuery.data) ? inbodyQuery.data : []), [inbodyQuery.data]);
  const inbodyLoading = inbodyQuery.isLoading;

  // Only a brand-new thread gets the greeting; a saved one is hydrated from the server instead.
  useEffect(() => {
    if (!activeSessionId && !inbodyLoading && messages.length === 0) seedCoachGreeting(userId, key, greetingText(history[0], history[1]));
  }, [activeSessionId, inbodyLoading, messages.length, userId, key, history]);

  const lastText = messages[messages.length - 1]?.text;
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 60);
    return () => clearTimeout(t);
  }, [messages.length, lastText]);

  const invalidateSessions = useCallback(() => void queryClient.invalidateQueries({ queryKey: sessionsKey(userId) }), [queryClient, userId]);

  const onAdopted = useCallback(
    (sessionId: string) => {
      setActiveSessionId(sessionId);
      invalidateSessions();
    },
    [invalidateSessions],
  );

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || processing) return;
      setInput("");
      sendCoachQuestion(userId, key, text, onAdopted);
    },
    [processing, userId, key, onAdopted],
  );

  const receiveAgentReply = useCallback(
    (reply: AgentReply) => {
      appendAgentReply(userId, key, reply);
      if (reply.sessionId && reply.sessionId !== activeSessionId) setActiveSessionId(reply.sessionId);
      setView("chat");
      invalidateSessions();
    },
    [userId, key, activeSessionId, invalidateSessions],
  );

  const sendImageChat = async () => {
    if (!staged || imageBusy || processing) return;
    const picked = staged;
    const question = input.trim();
    setInput("");
    setStaged(null);
    setImageBusy("chat");
    setImageError("");
    try {
      const reply = await fitnessAgentService.imageChat(picked.image, question, activeSessionId ?? undefined);
      appendImageChatExchange(userId, key, reply, question, picked.uri);
      if (reply.sessionId !== activeSessionId) setActiveSessionId(reply.sessionId);
      invalidateSessions();
    } catch (e) {
      setImageError(agentErrorMessage(e, "Không thể phân tích ảnh. Vui lòng thử lại."));
    } finally {
      setImageBusy(null);
    }
  };

  const pick = async (flow: "chat" | "goal", source: "camera" | "library") => {
    setAttachOpen(false);
    setImageError("");
    let picked: PickedImage | null = null;
    try {
      picked = await pickAgentImage(source);
    } catch (e: any) {
      setImageError(e?.message ?? "Không mở được ảnh.");
      return;
    }
    if (!picked) return;
    if (flow === "chat") {
      setStaged(picked);
      return;
    }
    setImageBusy("goal");
    try {
      receiveAgentReply(await fitnessAgentService.image(picked.image, activeSessionId ?? undefined));
    } catch (e) {
      setImageError(agentErrorMessage(e, "Không thể phân tích ảnh. Bạn có thể nhập mục tiêu bằng lời."));
    } finally {
      setImageBusy(null);
    }
  };

  const startNewChat = () => {
    setDraftKey(newDraftKey());
    setActiveSessionId(null);
    setView("chat");
  };

  const openSession = (id: string) => {
    setActiveSessionId(id);
    setView("chat");
  };

  const confirmArchive = (s: AiChatSessionSummary) => {
    Alert.alert("Xoá cuộc trò chuyện?", "Cuộc trò chuyện sẽ bị ẩn khỏi danh sách. Không thể hoàn tác từ ứng dụng.", [
      { text: "Huỷ", style: "cancel" },
      {
        text: "Xoá",
        style: "destructive",
        onPress: async () => {
          try {
            await coachService.archiveSession(s.id);
            resetCoachSession(userId, s.id);
            if (s.id === activeSessionId) startNewChat();
            invalidateSessions();
          } catch (e) {
            toast.show(agentErrorMessage(e, "Không xoá được cuộc trò chuyện."), "danger");
          }
        },
      },
    ]);
  };

  const submitRename = async () => {
    const target = renameTarget;
    const title = renameValue.trim();
    setRenameTarget(null);
    if (!target || !title || title === target.title) return;
    try {
      await coachService.renameSession(target.id, title);
    } catch (e) {
      toast.show(agentErrorMessage(e, "Không đổi được tên."), "danger");
    } finally {
      invalidateSessions();
    }
  };

  const close = () => (router.canGoBack() ? router.back() : router.replace("/client/dashboard"));
  const busy = processing || imageBusy !== null;
  const canSubmit = staged ? !busy : !!input.trim() && !busy;

  // ── History list ─────────────────────────────────────────────────────────
  if (view === "list") {
    return (
      <View className="flex-1 bg-background">
        <View className="border-b border-border bg-glass px-4 pb-3" style={{ paddingTop: insets.top + 12 }}>
          <View className="flex-row items-center gap-3">
            <Pressable accessibilityLabel="Quay lại cuộc trò chuyện" hitSlop={8} onPress={() => setView("chat")}>
              <ChevronLeft size={26} color={darkColors.foreground} />
            </Pressable>
            <Text className="flex-1 font-display text-lg text-foreground">Lịch sử trò chuyện AI</Text>
          </View>
        </View>
        <ScrollView contentContainerStyle={{ padding: 16, gap: 10, paddingBottom: insets.bottom + 24 }}>
          <Button full icon={Plus} onPress={startNewChat}>
            Cuộc trò chuyện mới
          </Button>
          {sessionsQuery.isLoading ? (
            <ActivityIndicator color={accent.primary} />
          ) : sessions.length === 0 ? (
            <EmptyState icon={MessageSquare} title="Chưa có cuộc trò chuyện nào" description="Hỏi AI Coach một câu để bắt đầu." />
          ) : (
            sessions.map((s) => (
              <Tappable
                key={s.id}
                onPress={() => openSession(s.id)}
                className={`flex-row items-center gap-3 rounded-2xl border p-3.5 ${s.id === activeSessionId ? "border-primary/60 bg-primary/10" : "border-border bg-card"}`}
              >
                <MessageSquare size={18} color={designTokens.mutedForeground} />
                <View className="min-w-0 flex-1">
                  <Text className="font-body-semibold text-sm text-foreground" numberOfLines={1}>
                    {s.title}
                  </Text>
                  <Text className="mt-0.5 font-body text-xs text-muted-foreground">{relativeTime(s.lastMessageAt)}</Text>
                </View>
                <Pressable
                  accessibilityLabel={`Đổi tên ${s.title}`}
                  hitSlop={6}
                  className="p-2"
                  onPress={() => {
                    setRenameTarget(s);
                    setRenameValue(s.title);
                  }}
                >
                  <Pencil size={16} color={designTokens.mutedForeground} />
                </Pressable>
                <Pressable accessibilityLabel={`Xoá ${s.title}`} hitSlop={6} className="p-2" onPress={() => confirmArchive(s)}>
                  <Trash2 size={16} color={darkColors.destructive} />
                </Pressable>
              </Tappable>
            ))
          )}
        </ScrollView>
        <BottomSheet open={!!renameTarget} onClose={() => setRenameTarget(null)} title="Đổi tên cuộc trò chuyện">
          <View className="gap-3 pb-2">
            <Input value={renameValue} onChangeText={setRenameValue} placeholder="Tên cuộc trò chuyện" maxLength={120} autoFocus />
            <Button full disabled={!renameValue.trim()} onPress={() => void submitRename()}>
              Lưu
            </Button>
          </View>
        </BottomSheet>
      </View>
    );
  }

  // ── Thread ───────────────────────────────────────────────────────────────
  return (
    <KeyboardAvoidingView className="flex-1 bg-background" behavior={Platform.OS === "ios" ? "padding" : undefined}>
      <View className="border-b border-border bg-glass px-4 pb-3" style={{ paddingTop: insets.top + 12 }}>
        <View className="flex-row items-center gap-3">
          <Pressable accessibilityLabel="Đóng AI Coach" hitSlop={8} onPress={close}>
            <ChevronLeft size={26} color={darkColors.foreground} />
          </Pressable>
          <View className="h-10 w-10 items-center justify-center rounded-full bg-primary/15">
            <Sparkles size={18} color={accent.primary} />
            <View className="absolute -bottom-0.5 -right-0.5 h-3 w-3 rounded-full border-2 border-card bg-primary" />
          </View>
          <View className="flex-1">
            <Text className="font-display text-base text-foreground">AI Coach</Text>
            <Text className="font-body text-xs text-primary">{processing ? "Đang trả lời…" : "Trợ lý AI · Luôn sẵn sàng"}</Text>
          </View>
          <Pressable accessibilityLabel="Cuộc trò chuyện mới" hitSlop={8} className="p-1.5" onPress={startNewChat}>
            <Plus size={22} color={darkColors.foreground} />
          </Pressable>
          <Pressable accessibilityLabel="Lịch sử trò chuyện" hitSlop={8} className="p-1.5" onPress={() => setView("list")}>
            <History size={21} color={darkColors.foreground} />
          </Pressable>
        </View>
      </View>

      <ScrollView ref={scrollRef} className="flex-1" keyboardShouldPersistTaps="handled" contentContainerStyle={{ padding: 16, gap: 12, flexGrow: 1, justifyContent: "flex-end" }}>
        {(activeSessionId && threadQuery.isLoading && messages.length === 0) || (!activeSessionId && inbodyLoading && messages.length === 0) ? (
          <ActivityIndicator color={accent.primary} />
        ) : (
          messages.map((m) => (
            <Animated.View key={m.id} entering={FadeInDown.springify().stiffness(400).damping(30)} className={`flex-row ${m.from === "user" ? "justify-end" : "justify-start"}`}>
              <View className={m.from === "user" ? "max-w-[82%] rounded-2xl rounded-br-md bg-primary px-3.5 py-2.5" : "max-w-[92%] rounded-2xl rounded-bl-md bg-panel px-3.5 py-2.5"}>
                {m.imageUri ? <Image source={{ uri: m.imageUri }} className="mb-1.5 h-40 w-40 rounded-lg" resizeMode="cover" /> : null}
                {m.from === "user" ? (
                  <Text className="font-body text-sm leading-5 text-on-primary">{m.text}</Text>
                ) : (
                  <>
                    <CoachText text={m.text} />
                    <EvidenceSources items={visibleEvidence(m)} />
                    {m.structuredBlocks?.map((b, i) => (
                      <AgentBlock key={`${m.id}-b${i}`} block={b} sessionId={activeSessionId ?? undefined} onReply={receiveAgentReply} onQuickReply={send} />
                    ))}
                  </>
                )}
              </View>
            </Animated.View>
          ))
        )}
      </ScrollView>

      {imageBusy || imageError ? (
        <View className="px-4 pt-2">
          {imageBusy ? (
            <View className="flex-row items-center gap-1.5">
              <ActivityIndicator size="small" color={accent.primary} />
              <Text className="font-body text-xs text-primary">{imageBusy === "goal" ? "Đang phân tích ảnh mục tiêu…" : "Đang phân tích ảnh…"}</Text>
            </View>
          ) : null}
          {imageError ? (
            <Text accessibilityRole="alert" className="font-body text-xs text-destructive">
              {imageError}
            </Text>
          ) : null}
        </View>
      ) : null}

      {messages.length <= 1 && !staged ? (
        <ScrollView horizontal showsHorizontalScrollIndicator={false} keyboardShouldPersistTaps="handled" contentContainerStyle={{ gap: 8, paddingHorizontal: 16, paddingTop: 8 }} className="flex-grow-0">
          {suggestions(history.length > 0).map((s) => (
            <Tappable key={s} disabled={busy} onPress={() => send(s)} className="rounded-full border border-border bg-panel px-3.5 py-2">
              <Text className="font-body text-xs text-muted-foreground">{s}</Text>
            </Tappable>
          ))}
        </ScrollView>
      ) : null}

      <View className="border-t border-border bg-glass p-3" style={{ paddingBottom: insets.bottom + 12 }}>
        {staged ? (
          <View className="mb-2 flex-row items-center gap-2 rounded-xl border border-border bg-panel p-2">
            <Image source={{ uri: staged.uri }} className="h-12 w-12 rounded-lg" />
            <Text className="flex-1 font-body text-xs text-muted-foreground" numberOfLines={1}>
              Đã đính kèm ảnh — gõ câu hỏi rồi gửi
            </Text>
            <Pressable accessibilityLabel="Bỏ ảnh đính kèm" hitSlop={8} className="p-1" onPress={() => setStaged(null)}>
              <X size={18} color={designTokens.mutedForeground} />
            </Pressable>
          </View>
        ) : null}
        <View className="flex-row items-end gap-2">
          <Pressable
            accessibilityLabel="Thêm ảnh"
            disabled={busy}
            onPress={() => setAttachOpen(true)}
            className={`h-11 w-11 items-center justify-center rounded-full border border-border bg-panel ${busy ? "opacity-40" : ""}`}
          >
            <Plus size={20} color={darkColors.foreground} />
          </Pressable>
          <TextInput
            value={input}
            onChangeText={setInput}
            placeholder={staged ? "Hỏi gì về ảnh này?" : "Hỏi AI Coach..."}
            placeholderTextColor={inputPlaceholderColor}
            multiline
            editable={!processing}
            style={{ color: inputTextColor, maxHeight: 120 }}
            className="min-h-11 flex-1 rounded-3xl border border-border bg-panel px-4 py-2.5 font-body text-sm"
          />
          <Pressable
            accessibilityLabel="Gửi"
            disabled={!canSubmit}
            onPress={() => (staged ? void sendImageChat() : send(input))}
            className={`h-11 w-11 items-center justify-center rounded-full bg-primary ${canSubmit ? "" : "opacity-40"}`}
          >
            {busy ? <ActivityIndicator size="small" color={accent.onPrimary} /> : <Send size={18} strokeWidth={2.5} color={accent.onPrimary} />}
          </Pressable>
        </View>
        <View className="mt-2 flex-row items-center justify-center gap-1">
          <AlertCircle size={11} color={designTokens.warning} />
          <Text className="font-body text-[11px] text-muted-foreground">Trả lời dựa trên dữ liệu của bạn, không thay thế tư vấn y tế.</Text>
        </View>
      </View>

      <BottomSheet open={attachOpen} onClose={() => setAttachOpen(false)} title="Thêm ảnh">
        <View className="gap-4 pb-2">
          <AttachOption
            title="Gửi ảnh & hỏi AI"
            desc="Máy tập, lịch tập chụp ảnh... hỏi gì cũng được"
            onCamera={() => void pick("chat", "camera")}
            onLibrary={() => void pick("chat", "library")}
          />
          <AttachOption
            title="Ảnh hình thể tham khảo"
            desc="Gợi ý mục tiêu — không lưu làm phép đo cơ thể"
            onCamera={() => void pick("goal", "camera")}
            onLibrary={() => void pick("goal", "library")}
          />
        </View>
      </BottomSheet>
    </KeyboardAvoidingView>
  );
}

function AttachOption({ title, desc, onCamera, onLibrary }: { title: string; desc: string; onCamera: () => void; onLibrary: () => void }) {
  return (
    <View className="gap-2 rounded-2xl border border-border bg-panel p-3.5">
      <Text className="font-body-semibold text-sm text-foreground">{title}</Text>
      <Text className="font-body text-xs text-muted-foreground">{desc}</Text>
      <View className="mt-1 flex-row gap-2">
        <Button size="sm" variant="secondary" icon={Camera} onPress={onCamera}>
          Chụp ảnh
        </Button>
        <Button size="sm" variant="secondary" icon={ImagePlus} onPress={onLibrary}>
          Thư viện
        </Button>
      </View>
    </View>
  );
}
