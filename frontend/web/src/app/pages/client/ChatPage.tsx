import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Search, MoreVertical, Phone, Video, ChevronLeft, Loader2, MessageSquare } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chatService } from "../../services/api";
import { useApp } from "../../context/AppContext";

function safeText(value: unknown, fallback = "") {
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") return String(value);
  if (value && typeof value === "object") {
    const maybeMsg = (value as any).message;
    if (typeof maybeMsg === "string") return maybeMsg;
    return fallback;
  }
  return fallback;
}

export function ChatPage() {
  const queryClient = useQueryClient();
  const { user } = useApp();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversationsData, isLoading: convsLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: chatService.listConversations,
  });

  const { data: messagesData } = useQuery({
    queryKey: ["messages", activeConvId],
    queryFn: () => (activeConvId ? chatService.getMessages(activeConvId) : Promise.resolve({ messages: [] })),
    enabled: !!activeConvId,
  });

  const conversations = conversationsData?.conversations || [];
  const messages = messagesData?.messages || [];

  const sendMutation = useMutation({
    mutationFn: (text: string) => chatService.sendMessage(activeConvId!, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", activeConvId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    },
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const activeConv = conversations.find((c: any) => c.id === activeConvId);
  const activeConvOtherUserId = activeConv?.otherUser?.id || activeConv?.participants?.find((p: any) => p.userId !== user?.id)?.userId;
  const activeConvDisplayName = activeConv?.otherUser?.firstName
    ? `${activeConv.otherUser.firstName} ${activeConv.otherUser.lastName || ""}`.trim()
    : (activeConvOtherUserId ? `User ${String(activeConvOtherUserId).slice(0, 8)}...` : "Unknown User");

  const sendMessage = () => {
    if (!input.trim() || !activeConvId) return;
    sendMutation.mutate(input.trim());
    setInput("");
  };

  if (convsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-56px)] flex bg-zinc-950">
      <div className={`${mobileView === "chat" ? "hidden" : "flex"} lg:flex flex-col w-full lg:w-80 bg-zinc-900 border-r border-zinc-800/60 flex-shrink-0`}>
        <div className="p-4 border-b border-zinc-800/60">
          <h2 className="font-bold text-zinc-100 mb-3">Messages</h2>
          <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/40 rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-zinc-500" />
            <input type="text" placeholder="Search conversations..." className="bg-transparent text-sm outline-none flex-1 text-zinc-300 placeholder-zinc-600" />
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
                <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">
                  {c.otherUser?.firstName?.charAt(0) || c.participants?.find((p: any) => p.userId !== user?.id)?.userId?.charAt(0) || "U"}
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold text-zinc-200 truncate">
                      {c.otherUser?.firstName
                        ? `${c.otherUser.firstName} ${c.otherUser.lastName || ""}`.trim()
                        : `User ${String(c.participants?.find((p: any) => p.userId !== user?.id)?.userId || "").slice(0, 8)}...`}
                    </span>
                    <span className="text-xs text-zinc-600 ml-2">
                      {c.messages?.[0]?.createdAt ? new Date(c.messages[0].createdAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" }) : ""}
                    </span>
                  </div>
                  <p className="text-xs text-zinc-500 truncate">{safeText(c.messages?.[0]?.content, "No messages yet")}</p>
                </div>
              </button>
            ))
          ) : (
            <div className="p-10 text-center">
              <MessageSquare className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-sm text-zinc-500">No active chats in database yet.</p>
            </div>
          )}
        </div>
      </div>

      <div className={`${mobileView === "list" ? "hidden" : "flex"} lg:flex flex-col flex-1 min-w-0`}>
        {activeConv ? (
          <>
            <div className="bg-zinc-900 border-b border-zinc-800/60 px-4 py-3 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <button onClick={() => setMobileView("list")} className="lg:hidden text-zinc-500 hover:text-zinc-300 mr-1 transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="w-9 h-9 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">
                  {activeConv.otherUser?.firstName?.charAt(0) || String(activeConvOtherUserId || "U").charAt(0)}
                </div>
                <div className="text-sm font-semibold text-zinc-200">{activeConvDisplayName}</div>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"><Phone className="w-4 h-4" /></button>
                <button className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"><Video className="w-4 h-4" /></button>
                <button className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors"><MoreVertical className="w-4 h-4" /></button>
              </div>
            </div>

            <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-950">
              {messages.length > 0 ? (
                messages.map((msg: any) => (
                  <div key={msg.id} className={`flex ${msg.senderId === user?.id ? "justify-end" : "justify-start"}`}>
                    <div className={`max-w-[70%] sm:max-w-xs lg:max-w-sm px-4 py-2.5 rounded-2xl text-sm ${msg.senderId === user?.id ? "bg-green-500 text-black rounded-br-sm font-medium" : "bg-zinc-900 text-zinc-300 border border-zinc-800/60 rounded-bl-sm"}`}>
                      {safeText(msg.content, "")}
                    </div>
                  </div>
                ))
              ) : (
                <div className="flex flex-col items-center justify-center h-full text-zinc-600">
                  <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
                  <p className="text-xs">No messages yet.</p>
                </div>
              )}
              <div ref={bottomRef} />
            </div>

            <div className="bg-zinc-900 border-t border-zinc-800/60 p-3 flex-shrink-0">
              <div className="flex items-center gap-2">
                <button className="p-2 text-zinc-500 hover:text-zinc-300 flex-shrink-0 transition-colors"><Paperclip className="w-4 h-4" /></button>
                <input
                  type="text"
                  value={input}
                  onChange={(e) => setInput(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && sendMessage()}
                  placeholder="Type a message..."
                  className="flex-1 px-4 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 text-zinc-200 placeholder-zinc-600 transition-all"
                />
                <button
                  onClick={sendMessage}
                  disabled={!input.trim() || sendMutation.isPending}
                  className="w-9 h-9 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-xl flex items-center justify-center transition-all flex-shrink-0"
                >
                  {sendMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
                </button>
              </div>
            </div>
          </>
        ) : (
          <div className="flex-1 flex flex-col items-center justify-center bg-zinc-950 p-6 text-center">
            <div className="w-20 h-20 bg-zinc-900 border border-zinc-800 rounded-3xl flex items-center justify-center mb-4">
              <MessageSquare className="w-10 h-10 text-zinc-700" />
            </div>
            <h3 className="text-zinc-100 font-bold mb-1">Select a conversation</h3>
            <p className="text-zinc-500 text-sm max-w-xs">Only real conversation data is shown.</p>
          </div>
        )}
      </div>
    </div>
  );
}
