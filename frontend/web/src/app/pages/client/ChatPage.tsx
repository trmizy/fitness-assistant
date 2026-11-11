import { useState, useRef, useEffect, useCallback } from "react";
import { useSearchParams } from "react-router";
import { PaperPlaneTiltIcon as Send, PaperclipIcon as Paperclip, MagnifyingGlassIcon as Search, DotsThreeVerticalIcon as MoreVertical, PhoneIcon as Phone, VideoCameraIcon as Video, FileTextIcon as FileText, CalendarIcon as Calendar, CaretLeftIcon as ChevronLeft, WarningCircleIcon as AlertCircle, UserIcon as User, CircleNotchIcon as Loader2, PlusIcon as Plus, ChatTextIcon as MessageSquare } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { chatService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useCall } from "../../context/CallContext";
import { useRealtimeChat } from "../../hooks/useRealtimeChat";
import { getSocket as getChatSocket } from "../../services/socket";
import {
  CHAT_MESSAGE_MAX_LENGTH,
  CHAT_PAGE_SIZE,
  checkChatDraft,
  chatPartnerInitial,
  chatPartnerName,
  chatRoleLabel,
  chatSendErrorText,
  mergeMessages,
} from "../../utils/chatThread";

export function ChatPage() {
  const [searchParams] = useSearchParams();
  const { user } = useApp();
  const userScopeId = user?.id ?? "guest";
  const { initiateCall } = useCall();
  const queryClient = useQueryClient();
  const [activeConvId, setActiveConvId] = useState<string | null>(
    searchParams.get("conversationId"),
  );
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [mobileView, setMobileView] = useState<"list" | "chat">(
    searchParams.get("conversationId") ? "chat" : "list",
  );
  const bottomRef = useRef<HTMLDivElement>(null);
  const scrollerRef = useRef<HTMLDivElement>(null);
  // Older pages of the open thread ("Xem tin cũ hơn"). The query itself always holds the newest page plus
  // whatever arrives live, so a refetch (reconnect) can never throw away history the user already loaded.
  const [olderMessages, setOlderMessages] = useState<any[]>([]);
  const [noMoreOlder, setNoMoreOlder] = useState(false);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const [olderError, setOlderError] = useState<string | null>(null);

  // REST: initial conversation list
  const {
    data: conversations = [],
    isLoading: convsLoading,
    error: convsError,
  } = useQuery({
    queryKey: ["conversations", userScopeId],
    queryFn: chatService.listConversations,
    refetchInterval: 10000, // light polling as fallback
  });

  const realtimeChat = useRealtimeChat(
    activeConvId,
    conversations.map((c: any) => c.id),
  );

  // A failed fetch used to fall back to [] and render the "no chats yet" empty state, so a
  // wrong server address, an expired session or a server error all looked identical to
  // "you have no conversations" — with no console to check on a phone.
  const convsErrorText = convsError
    ? (() => {
        const e = convsError as any;
        const status = e?.response?.status;
        const msg = e?.response?.data?.error?.message ?? e?.response?.data?.error ?? e?.message;
        return status ? `Lỗi tải hội thoại (${status}${msg ? `: ${msg}` : ""})` : `Không kết nối được máy chủ: ${msg ?? "lỗi không rõ"}`;
      })()
    : null;

  // REST: initial messages for selected conversation
  const { data: latestMessages = [] } = useQuery({
    queryKey: ["messages", userScopeId, activeConvId],
    queryFn: () =>
      activeConvId
        ? chatService.getMessages(activeConvId, 1, CHAT_PAGE_SIZE)
        : Promise.resolve([]),
    enabled: !!activeConvId,
  });
  const messages = olderMessages.length
    ? mergeMessages<any>(olderMessages, latestMessages as any[])
    : (latestMessages as any[]);
  // A first page that came back full means there may be more behind it.
  const canLoadOlder =
    !noMoreOlder && (olderMessages.length > 0 || (latestMessages as any[]).length >= CHAT_PAGE_SIZE);

  useEffect(() => {
    setOlderMessages([]);
    setNoMoreOlder(false);
    setOlderError(null);
  }, [activeConvId, userScopeId]);

  const loadOlder = useCallback(async () => {
    const first = (messages as any[])[0];
    if (!activeConvId || !first?.id || loadingOlder) return;
    const scroller = scrollerRef.current;
    const heightBefore = scroller?.scrollHeight ?? 0;
    setLoadingOlder(true);
    setOlderError(null);
    try {
      const page = await chatService.getMessages(activeConvId, 1, CHAT_PAGE_SIZE, first.id);
      const rows = Array.isArray(page) ? page : [];
      if (rows.length < CHAT_PAGE_SIZE) setNoMoreOlder(true);
      setOlderMessages((current) => mergeMessages<any>(rows, current));
      // Keep what the user was reading in place instead of jumping to the top of the new rows.
      requestAnimationFrame(() => {
        if (scroller) scroller.scrollTop += scroller.scrollHeight - heightBefore;
      });
    } catch {
      setOlderError("Chưa tải được tin nhắn cũ. Thử lại nhé.");
    } finally {
      setLoadingOlder(false);
    }
  }, [messages, activeConvId, loadingOlder]);

  // Call log lines ("Cuộc gọi video đã kết thúc", "bị từ chối", "nhỡ") are saved by chat-service
  // and pushed on ITS socket as "chat:message" (the one calls already use) - the gateway socket
  // behind useRealtimeChat never carries them, so only the polled conversation list showed them.
  // Put the line straight into the open thread when it arrives.
  useEffect(() => {
    if (!user?.id) return;
    const chatSocket = getChatSocket();
    const onCallLog = (msg: any) => {
      if (!msg?.id || !msg?.conversationId) return;
      const mapped = {
        id: msg.id,
        authorId: msg.authorId || msg.senderId,
        content: msg.content,
        createdAt: msg.createdAt,
        conversationId: msg.conversationId,
      };
      queryClient.setQueryData(
        ["messages", userScopeId, mapped.conversationId],
        (old: any[] | undefined) => {
          if (!old) return [mapped];
          if (old.some((item) => item.id === mapped.id)) return old;
          return [...old, mapped];
        },
      );
      queryClient.invalidateQueries({ queryKey: ["conversations", userScopeId] });
    };
    chatSocket.on("chat:message", onCallLog);
    return () => {
      chatSocket.off("chat:message", onCallLog);
    };
  }, [user?.id, userScopeId, queryClient]);

  // Fallback that reuses what the conversation list already polls: when its last message is one
  // the open thread does not have yet (socket down, or the push was missed), reload the thread.
  const lastMessageId = (conversations as any[]).find((c: any) => c.id === activeConvId)?.lastMessage?.id;
  useEffect(() => {
    if (!activeConvId || !lastMessageId) return;
    if ((latestMessages as any[]).some((m: any) => m.id === lastMessageId)) return;
    queryClient.invalidateQueries({ queryKey: ["messages", userScopeId, activeConvId] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [lastMessageId, activeConvId]);

  useEffect(() => {
    setActiveConvId(searchParams.get("conversationId"));
    setMobileView(searchParams.get("conversationId") ? "chat" : "list");
  }, [userScopeId]);

  // Auto-scroll on new messages (not when an older page is prepended: that keeps its own scroll position)
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [latestMessages]);

  const activeConv = conversations.find((c: any) => c.id === activeConvId);

  // Send message via Socket.IO. Backend persists messages before broadcasting.
  const draft = checkChatDraft(input);
  const sendMessage = useCallback(async () => {
    const check = checkChatDraft(input);
    if (!activeConvId || sending) return;
    if (!check.ok) {
      // Nothing is sent and nothing is cleared: the text stays so it can be shortened.
      setSendError(check.error);
      return;
    }
    const text = check.text;
    setSending(true);
    setSendError(null);
    try {
      // Resolves only after the server stored the message; the box is cleared then and not before.
      const sent = await realtimeChat.sendMessage(activeConvId, text);
      // Clear only what was sent — the user may have kept typing while it was in flight.
      if (sent) setInput((current) => (current.trim() === text ? "" : current));
    } catch (err) {
      setSendError(chatSendErrorText(err));
    } finally {
      setSending(false);
    }
  }, [input, activeConvId, realtimeChat, sending]);

  if (convsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-full flex bg-zinc-950">
      {/* Conversation list */}
      <div
        className={`${mobileView === "chat" ? "hidden" : "flex"} lg:flex flex-col w-full lg:w-80 bg-zinc-900 border-r border-zinc-800/60 flex-shrink-0`}
      >
        <div className="p-4 border-b border-zinc-800/60">
          <h2 className="font-bold text-zinc-100 mb-3">Tin nhắn</h2>
          <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/40 rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-zinc-500" />
            <input
              type="text"
              placeholder="Tìm cuộc trò chuyện..."
              className="bg-transparent text-sm outline-none flex-1 text-zinc-300 placeholder-zinc-600"
            />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length > 0 ? (
            conversations.map((c: any) => (
              <button
                key={c.id}
                onClick={() => {
                  setActiveConvId(c.id);
                  setMobileView("chat");
                }}
                className={`w-full flex items-start gap-3 px-4 py-3.5 text-left border-b border-zinc-800/40 transition-colors ${activeConvId === c.id ? "bg-green-500/8 border-l-2 border-l-green-500" : "hover:bg-zinc-800/40"}`}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">
                    {chatPartnerInitial(c.otherUser)}
                  </div>
                  
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold text-zinc-200 truncate">
                      {chatPartnerName(c.otherUser)}
                    </span>
                    <span className="text-xs text-zinc-600 flex-shrink-0 ml-2">
                      {c.lastMessage
                        ? new Date(c.lastMessage.createdAt).toLocaleTimeString(
                        "vi-VN",
                        { hour: "2-digit", minute: "2-digit" },
                        )
                        : ""}
                    </span>
                  </div>
                  <div className="text-xs text-zinc-600 mb-0.5">
                    {chatRoleLabel(c.otherUser?.role)}
                  </div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-zinc-500 truncate">
                      {c.lastMessage?.content || "Chưa có tin nhắn"}
                    </p>
                  </div>
                </div>
              </button>
            ))
          ) : convsErrorText ? (
            <div className="p-10 text-center">
              <MessageSquare className="w-12 h-12 text-red-500/30 mx-auto mb-3" />
              <p className="text-sm text-red-400 break-words">{convsErrorText}</p>
              <p className="text-xs text-zinc-600 mt-2">
                Kiểm tra "Cấu hình máy chủ" ở màn hình đăng nhập, hoặc đăng nhập lại.
              </p>
            </div>
          ) : (
            <div className="p-10 text-center">
              <MessageSquare className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">
                Chưa có cuộc trò chuyện nào. Hãy kết nối với một huấn luyện viên
                ở trang Tìm huấn luyện viên để bắt đầu!
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Chat panel */}
      <div
        className={`${mobileView === "list" ? "hidden" : "flex"} lg:flex flex-col flex-1 min-w-0`}
      >
        {activeConv ? (
          <>
            {/* Chat header */}
            <div className="bg-zinc-900 border-b border-zinc-800/60 px-4 py-3 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <button
                  onClick={() => setMobileView("list")}
                  className="lg:hidden text-zinc-500 hover:text-zinc-300 mr-1 transition-colors"
                >
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="relative">
                  <div className="w-9 h-9 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">
                    {chatPartnerInitial(activeConv.otherUser)}
                  </div>
                  
                </div>
                <div className="min-w-0">
                  <div className="text-sm font-semibold text-zinc-200 truncate">
                    {chatPartnerName(activeConv.otherUser)}
                  </div>
                  <div className="text-xs text-zinc-500">
                    {chatRoleLabel(activeConv.otherUser?.role)}
                  </div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button
                  onClick={() => {
                    const otherUserId = activeConv.otherUser?.id;
                    if (otherUserId && activeConvId)
                      initiateCall(otherUserId, "VOICE", activeConvId);
                  }}
                  className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                  title="Gọi thoại"
                >
                  <Phone className="w-4 h-4" />
                </button>
                <button
                  onClick={() => {
                    const otherUserId = activeConv.otherUser?.id;
                    if (otherUserId && activeConvId)
                      initiateCall(otherUserId, "VIDEO", activeConvId);
                  }}
                  className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"
                  title="Gọi video"
                >
                  <Video className="w-4 h-4" />
                </button>
                <button className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

            {/* Messages */}
            <div ref={scrollerRef} className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-950">
              {canLoadOlder && (
                <div className="flex flex-col items-center gap-1">
                  <button
                    type="button"
                    onClick={loadOlder}
                    disabled={loadingOlder}
                    className="px-3 py-1.5 text-xs font-medium text-zinc-300 bg-zinc-900 border border-zinc-800 rounded-full hover:bg-zinc-800 disabled:opacity-60 transition-colors"
                  >
                    {loadingOlder ? "Đang tải..." : "Xem tin cũ hơn"}
                  </button>
                  {olderError && (
                    <p role="alert" className="text-xs text-red-400">
                      {olderError}
                    </p>
                  )}
                </div>
              )}
              {messages.length > 0 ? (
                messages.map((msg: any) => (
                  msg.authorId === "system" ? (
                    <div key={msg.id} className="flex justify-center w-full my-2">
                      <div className="bg-zinc-800/40 border border-zinc-700/50 rounded-full px-4 py-1.5 flex items-center gap-2 max-w-[90%]">
                        <span className="text-xs text-zinc-400 text-center font-medium">
                          {msg.content}
                        </span>
                        <span className="text-[10px] text-zinc-500">
                          {new Date(msg.createdAt).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </span>
                      </div>
                    </div>
                  ) : (
                    <div
                      key={msg.id}
                      className={`flex ${msg.authorId === user?.id ? "justify-end" : "justify-start"}`}
                    >
                      {msg.authorId !== user?.id && (
                        <div className="w-7 h-7 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-xs font-bold text-emerald-400 mr-2 flex-shrink-0 mt-0.5">
                          {chatPartnerInitial(activeConv.otherUser)}
                        </div>
                      )}
                      <div className={`min-w-0 max-w-[70%] sm:max-w-xs lg:max-w-sm`}>
                        <div
                          className={`px-4 py-2.5 rounded-2xl text-sm break-words [overflow-wrap:anywhere] ${
                            msg.authorId === user?.id
                              ? "bg-green-500 text-black rounded-br-sm font-medium"
                              : "bg-zinc-900 text-zinc-300 border border-zinc-800/60 rounded-bl-sm"
                          }`}
                        >
                          {msg.content}
                        </div>
                        <div
                          className={`text-xs mt-1 text-zinc-600 ${msg.authorId === user?.id ? "text-right" : ""}`}
                        >
                          {new Date(msg.createdAt).toLocaleTimeString("vi-VN", {
                            hour: "2-digit",
                            minute: "2-digit",
                          })}
                        </div>
                      </div>
                    </div>
                  )
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs">Chưa có tin nhắn nào. Hãy gửi lời chào!</p>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            {/* Input */}
            <div className="bg-zinc-900 border-t border-zinc-800/60 p-3 flex-shrink-0">
              {(sendError || draft.error) && (
                <div role="alert" className="mb-2 flex items-start gap-1.5 text-xs text-red-400">
                  <AlertCircle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
                  <span className="min-w-0 flex-1 break-words">{draft.error || sendError}</span>
                  {sendError && !draft.error && (
                    <button
                      type="button"
                      onClick={sendMessage}
                      disabled={sending}
                      className="flex-shrink-0 font-semibold underline underline-offset-2 hover:text-red-300 disabled:opacity-60"
                    >
                      Thử lại
                    </button>
                  )}
                </div>
              )}
              <div className="flex items-center gap-2">
                <button className="p-2 text-zinc-500 hover:text-zinc-300 flex-shrink-0 transition-colors">
                  <Paperclip className="w-4 h-4" />
                </button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => {
                    setInput(e.target.value);
                    if (sendError) setSendError(null);
                  }}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Nhập tin nhắn..."
                  aria-invalid={!!draft.error}
                  className="flex-1 min-w-0 px-4 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 text-zinc-200 placeholder-zinc-600 transition-all"
                />
                <button
                  onClick={sendMessage}
                  disabled={!draft.ok || sending}
                  aria-label="Gửi tin nhắn"
                  className="w-9 h-9 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-xl flex items-center justify-center transition-all flex-shrink-0 shadow-lg shadow-green-500/20"
                >
                  <Send className="w-4 h-4" />
                </button>
              </div>
              {draft.showCounter && (
                <p
                  className={`mt-1.5 text-right text-xs ${draft.length > CHAT_MESSAGE_MAX_LENGTH ? "text-red-400" : "text-zinc-500"}`}
                >
                  {draft.length.toLocaleString("vi-VN")}/{CHAT_MESSAGE_MAX_LENGTH.toLocaleString("vi-VN")}
                </p>
              )}
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 p-6 text-center">
            <div className="w-20 h-20 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center mb-4">
              <MessageSquare className="w-10 h-10 text-zinc-700" />
            </div>
            <h3 className="text-zinc-100 font-bold mb-1">
              Chọn một cuộc trò chuyện
            </h3>
            <p className="text-zinc-500 text-sm max-w-xs">
              Chọn một cuộc trò chuyện ở bên trái hoặc bắt đầu cuộc trò chuyện mới với PT.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
