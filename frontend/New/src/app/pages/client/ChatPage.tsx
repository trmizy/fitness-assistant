import { useState, useRef, useEffect } from "react";
import { Send, Paperclip, Search, MoreVertical, Phone, Video, FileText, Calendar, ChevronLeft, AlertCircle, User, Loader2, Plus, MessageSquare } from "lucide-react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { chatService, profileService } from "../../services/api";
import { useApp } from "../../context/AppContext";

interface Message {
  id: number;
  from: "client" | "pt";
  text: string;
  time: string;
  read?: boolean;
}

// Mock data removed, now using real services

export function ChatPage() {
  const queryClient = useQueryClient();
  const { user } = useApp();
  const [activeConvId, setActiveConvId] = useState<string | null>(null);
  const [input, setInput] = useState("");
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const bottomRef = useRef<HTMLDivElement>(null);

  const { data: conversations = [], isLoading: convsLoading } = useQuery({
    queryKey: ["conversations"],
    queryFn: chatService.listConversations
  });

  const { data: messages = [], isLoading: msgsLoading } = useQuery({
    queryKey: ["messages", activeConvId],
    queryFn: () => activeConvId ? chatService.getMessages(activeConvId) : Promise.resolve([]),
    enabled: !!activeConvId
  });

  const { data: availablePTs = [], isLoading: ptsLoading } = useQuery({
    queryKey: ["available-pts"],
    queryFn: profileService.listPTs,
    enabled: conversations.length === 0
  });

  const sendMutation = useMutation({
    mutationFn: (text: string) => chatService.sendMessage(activeConvId!, text),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["messages", activeConvId] });
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
    }
  });

  const createConvMutation = useMutation({
    mutationFn: (ptUserId: string) => chatService.createDirectConversation(ptUserId),
    onSuccess: (newConv) => {
      queryClient.invalidateQueries({ queryKey: ["conversations"] });
      setActiveConvId(newConv.id);
      setMobileView("chat");
    }
  });

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const activeConv = conversations.find((c: any) => c.id === activeConvId);

  const sendMessage = () => {
    if (!input.trim() || !activeConvId) return;
    sendMutation.mutate(input.trim());
    setInput("");
  };

  if (convsLoading || ptsLoading) {
    return (
      <div className="flex h-screen items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  return (
    <div className="h-[calc(100vh-56px)] flex bg-zinc-950">
      {/* Conversation list */}
      <div className={`${mobileView === "chat" ? "hidden" : "flex"} lg:flex flex-col w-full lg:w-80 bg-zinc-900 border-r border-zinc-800/60 flex-shrink-0`}>
        <div className="p-4 border-b border-zinc-800/60">
          <h2 className="font-bold text-zinc-100 mb-3">Messages</h2>
          <div className="flex items-center gap-2 bg-zinc-800/60 border border-zinc-700/40 rounded-xl px-3 py-2">
            <Search className="w-4 h-4 text-zinc-500" />
            <input type="text" placeholder="Search conversations…" className="bg-transparent text-sm outline-none flex-1 text-zinc-300 placeholder-zinc-600" />
          </div>
        </div>
        <div className="flex-1 overflow-y-auto">
          {conversations.length > 0 ? (
            conversations.map((c: any) => (
              <button
                key={c.id}
                onClick={() => { setActiveConvId(c.id); setMobileView("chat"); }}
                className={`w-full flex items-start gap-3 px-4 py-3.5 text-left border-b border-zinc-800/40 transition-colors ${activeConvId === c.id ? "bg-green-500/8 border-l-2 border-l-green-500" : "hover:bg-zinc-800/40"}`}
              >
                <div className="relative flex-shrink-0">
                  <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">
                    {c.otherUser?.firstName?.charAt(0) || "U"}
                  </div>
                  <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-zinc-900 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />
                </div>
                <div className="flex-1 min-w-0">
                  <div className="flex items-center justify-between mb-0.5">
                    <span className="text-sm font-semibold text-zinc-200 truncate">{c.otherUser?.firstName} {c.otherUser?.lastName}</span>
                    <span className="text-xs text-zinc-600 flex-shrink-0 ml-2">Now</span>
                  </div>
                  <div className="text-xs text-zinc-600 mb-0.5">Personal Trainer</div>
                  <div className="flex items-center justify-between">
                    <p className="text-xs text-zinc-500 truncate">{c.lastMessage?.content || "Start a conversation"}</p>
                  </div>
                </div>
              </button>
            ))
          ) : (
            <div className="p-6 text-center">
              <MessageSquare className="w-12 h-12 text-zinc-800 mx-auto mb-3" />
              <p className="text-sm text-zinc-500 mb-4">No active chats yet. Connect with a PT to get started!</p>
              <div className="space-y-2">
                <p className="text-[10px] text-zinc-600 uppercase font-bold tracking-widest text-left mb-2">Available Trainers</p>
                {availablePTs?.pts?.length > 0 ? availablePTs.pts.map((pt: any) => (
                  <button
                    key={pt.userId}
                    onClick={() => createConvMutation.mutate(pt.userId)}
                    className="w-full flex items-center gap-3 p-3 bg-zinc-800/40 border border-zinc-700/30 rounded-xl hover:border-green-500/50 transition-all text-left group"
                  >
                    <div className="w-9 h-9 bg-green-500/10 rounded-full flex items-center justify-center text-xs font-bold text-green-400 border border-green-500/20">
                      {pt.firstName?.charAt(0) || "PT"}
                    </div>
                    <div>
                      <div className="text-sm font-semibold text-zinc-200 group-hover:text-green-400 transition-colors">{pt.firstName} {pt.lastName}</div>
                      <div className="text-[10px] text-zinc-600">Certified Fitness Expert</div>
                    </div>
                    <Plus className="w-4 h-4 text-zinc-700 group-hover:text-green-400 ml-auto" />
                  </button>
                )) : (
                  <p className="text-xs text-zinc-700 italic">No trainers available at the moment.</p>
                )}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Chat panel */}
      <div className={`${mobileView === "list" ? "hidden" : "flex"} lg:flex flex-col flex-1 min-w-0`}>
        {activeConv ? (
          <>
            {/* Chat header */}
            <div className="bg-zinc-900 border-b border-zinc-800/60 px-4 py-3 flex items-center justify-between flex-shrink-0">
              <div className="flex items-center gap-3">
                <button onClick={() => setMobileView("list")} className="lg:hidden text-zinc-500 hover:text-zinc-300 mr-1 transition-colors">
                  <ChevronLeft className="w-5 h-5" />
                </button>
                <div className="relative">
                  <div className="w-9 h-9 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">
                    {activeConv.otherUser?.firstName?.charAt(0) || "PT"}
                  </div>
                  <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-zinc-900" />
                </div>
                <div>
                  <div className="text-sm font-semibold text-zinc-200">{activeConv.otherUser?.firstName} {activeConv.otherUser?.lastName}</div>
                  <div className="text-xs text-green-400">Online now</div>
                </div>
              </div>
              <div className="flex items-center gap-1">
                <button className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                  <Phone className="w-4 h-4" />
                </button>
                <button className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                  <Video className="w-4 h-4" />
                </button>
                <button className="p-2 text-zinc-500 hover:text-zinc-300 hover:bg-zinc-800 rounded-lg transition-colors">
                  <MoreVertical className="w-4 h-4" />
                </button>
              </div>
            </div>

        {/* Contract context banner - Generic for now */}
        <div className="bg-green-500/5 border-b border-green-500/15 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <FileText className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
          <span className="text-xs text-zinc-400">Consultation Channel</span>
          <span className="text-xs px-2 py-0.5 rounded-full font-semibold ml-auto border bg-green-500/10 text-green-400 border-green-500/20">
            Active
          </span>
        </div>

        {/* Restricted banner */}
        {activeConv.id === 2 && (
          <div className="bg-zinc-800/40 border-b border-zinc-700/40 px-4 py-2 flex items-center gap-2">
            <AlertCircle className="w-3.5 h-3.5 text-zinc-500" />
            <span className="text-xs text-zinc-500">This contract has ended. Messaging is read-only.</span>
          </div>
        )}

        {/* Messages */}
        <div className="flex-1 overflow-y-auto p-4 space-y-3 bg-zinc-950">
          {messages.length > 0 ? messages.map((msg: any) => (
            <div key={msg.id} className={`flex ${msg.authorId === user?.id ? "justify-end" : "justify-start"}`}>
              {msg.authorId !== user?.id && (
                <div className="w-7 h-7 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-xs font-bold text-emerald-400 mr-2 flex-shrink-0 mt-0.5">
                  {activeConv.otherUser?.firstName?.charAt(0) || "PT"}
                </div>
              )}
              <div className={`max-w-[70%] sm:max-w-xs lg:max-w-sm`}>
                <div className={`px-4 py-2.5 rounded-2xl text-sm ${
                  msg.authorId === user?.id
                    ? "bg-green-500 text-black rounded-br-sm font-medium"
                    : "bg-zinc-900 text-zinc-300 border border-zinc-800/60 rounded-bl-sm"
                }`}>
                  {msg.content}
                </div>
                <div className={`text-xs mt-1 text-zinc-600 ${msg.authorId === user?.id ? "text-right" : ""}`}>
                  {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                </div>
              </div>
            </div>
          )) : (
            <div className="flex flex-col items-center justify-center h-full text-zinc-600">
               <MessageSquare className="w-8 h-8 mb-2 opacity-20" />
               <p className="text-xs">No messages here yet. Say hi!</p>
            </div>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="bg-zinc-900 border-t border-zinc-800/60 p-3 flex-shrink-0">
          <div className="flex items-center gap-2">
            <button className="p-2 text-zinc-500 hover:text-zinc-300 flex-shrink-0 transition-colors">
              <Paperclip className="w-4 h-4" />
            </button>
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && sendMessage()}
              placeholder="Type a message…"
              className="flex-1 px-4 py-2 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 text-zinc-200 placeholder-zinc-600 transition-all"
            />
            <button
              onClick={sendMessage}
              disabled={!input.trim() || sendMutation.isPending}
              className="w-9 h-9 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-xl flex items-center justify-center transition-all flex-shrink-0 shadow-lg shadow-green-500/20"
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
        <p className="text-zinc-500 text-sm max-w-xs">Pick an existing chat from the left or start a new one with a PT.</p>
      </div>
    )}
  </div>
</div>
);
}
