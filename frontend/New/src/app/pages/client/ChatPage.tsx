import { useState, useRef, useEffect } from "react";
import {
  Send, Paperclip, Search, MoreVertical, Phone, Video,
  FileText, Calendar, ChevronLeft, AlertCircle
} from "lucide-react";

interface Message {
  id: number;
  from: "client" | "pt";
  text: string;
  time: string;
  read?: boolean;
}

const conversations = [
  {
    id: 1, name: "Sarah Mitchell", role: "Personal Trainer",
    avatar: "SM", online: true, lastMsg: "Looking forward to your session tomorrow!", time: "2m",
    unread: 1, contractId: "CTR-2025-001",
    messages: [
      { id: 1, from: "pt" as const, text: "Hi Alex! How did your upper body workout go today?", time: "10:12 AM" },
      { id: 2, from: "client" as const, text: "It went great! Hit a new PR on bench press — 90kg for 5 reps 💪", time: "10:15 AM" },
      { id: 3, from: "pt" as const, text: "That's amazing progress! Your strength gains are really showing. How did your body feel after?", time: "10:17 AM" },
      { id: 4, from: "client" as const, text: "A bit fatigued but good. Slept 7 hours last night.", time: "10:20 AM" },
      { id: 5, from: "pt" as const, text: "Good sleep is key. I've updated your plan — added an extra rest day this week. Please check your AI plan for the changes.", time: "10:25 AM" },
      { id: 6, from: "pt" as const, text: "Also, don't forget your InBody is due this month. Try to get it done before our session.", time: "10:26 AM" },
      { id: 7, from: "client" as const, text: "Will do! I'll upload it this weekend.", time: "10:30 AM" },
      { id: 8, from: "pt" as const, text: "Perfect 👍 Looking forward to your session tomorrow!", time: "10:35 AM" },
    ] as Message[],
  },
  {
    id: 2, name: "Mike Torres", role: "Personal Trainer",
    avatar: "MT", online: false, lastMsg: "Contract completed. Great work!", time: "2d",
    unread: 0, contractId: "CTR-2024-008",
    messages: [
      { id: 1, from: "pt" as const, text: "Congratulations on completing the 3-month program! You've made incredible progress.", time: "Mar 31" },
      { id: 2, from: "client" as const, text: "Thank you Mike! Couldn't have done it without your guidance.", time: "Mar 31" },
      { id: 3, from: "pt" as const, text: "Contract completed. Great work!", time: "Mar 31" },
    ] as Message[],
  },
];

export function ChatPage() {
  const [activeConv, setActiveConv] = useState(conversations[0]);
  const [input, setInput] = useState("");
  const [messages, setMessages] = useState<Message[]>(conversations[0].messages);
  const [mobileView, setMobileView] = useState<"list" | "chat">("list");
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages]);

  const sendMessage = () => {
    if (!input.trim()) return;
    const newMsg: Message = {
      id: messages.length + 1,
      from: "client",
      text: input.trim(),
      time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
    };
    setMessages([...messages, newMsg]);
    setInput("");
    setTimeout(() => {
      setMessages((prev) => [...prev, {
        id: prev.length + 1,
        from: "pt",
        text: "Got it! I'll follow up on that soon. 💪",
        time: new Date().toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" }),
      }]);
    }, 1500);
  };

  const selectConv = (c: typeof conversations[0]) => {
    setActiveConv(c);
    setMessages(c.messages);
    setMobileView("chat");
  };

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
          {conversations.map((c) => (
            <button
              key={c.id}
              onClick={() => selectConv(c)}
              className={`w-full flex items-start gap-3 px-4 py-3.5 text-left border-b border-zinc-800/40 transition-colors ${activeConv.id === c.id ? "bg-green-500/8 border-l-2 border-l-green-500" : "hover:bg-zinc-800/40"}`}
            >
              <div className="relative flex-shrink-0">
                <div className="w-10 h-10 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">{c.avatar}</div>
                {c.online && <div className="absolute bottom-0 right-0 w-3 h-3 bg-green-500 rounded-full border-2 border-zinc-900 shadow-[0_0_6px_rgba(34,197,94,0.6)]" />}
              </div>
              <div className="flex-1 min-w-0">
                <div className="flex items-center justify-between mb-0.5">
                  <span className="text-sm font-semibold text-zinc-200 truncate">{c.name}</span>
                  <span className="text-xs text-zinc-600 flex-shrink-0 ml-2">{c.time}</span>
                </div>
                <div className="text-xs text-zinc-600 mb-0.5">{c.role}</div>
                <div className="flex items-center justify-between">
                  <p className="text-xs text-zinc-500 truncate">{c.lastMsg}</p>
                  {c.unread > 0 && <span className="ml-2 w-4 h-4 bg-green-500 rounded-full text-black text-xs font-bold flex items-center justify-center flex-shrink-0">{c.unread}</span>}
                </div>
              </div>
            </button>
          ))}
        </div>
      </div>

      {/* Chat panel */}
      <div className={`${mobileView === "list" ? "hidden" : "flex"} lg:flex flex-col flex-1 min-w-0`}>
        {/* Chat header */}
        <div className="bg-zinc-900 border-b border-zinc-800/60 px-4 py-3 flex items-center justify-between flex-shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setMobileView("list")} className="lg:hidden text-zinc-500 hover:text-zinc-300 mr-1 transition-colors">
              <ChevronLeft className="w-5 h-5" />
            </button>
            <div className="relative">
              <div className="w-9 h-9 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-sm font-bold text-emerald-400">{activeConv.avatar}</div>
              {activeConv.online && <div className="absolute bottom-0 right-0 w-2.5 h-2.5 bg-green-500 rounded-full border-2 border-zinc-900" />}
            </div>
            <div>
              <div className="text-sm font-semibold text-zinc-200">{activeConv.name}</div>
              <div className="text-xs text-zinc-500">{activeConv.online ? <span className="text-green-400">Online now</span> : "Last seen 2 days ago"}</div>
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

        {/* Contract context banner */}
        <div className="bg-green-500/5 border-b border-green-500/15 px-4 py-2 flex items-center gap-2 flex-shrink-0">
          <FileText className="w-3.5 h-3.5 text-green-400 flex-shrink-0" />
          <span className="text-xs text-zinc-400">Contract: <span className="font-semibold text-zinc-200">{activeConv.contractId}</span></span>
          <span className={`text-xs px-2 py-0.5 rounded-full font-semibold ml-auto border ${activeConv.id === 1 ? "bg-green-500/10 text-green-400 border-green-500/20" : "bg-zinc-700/50 text-zinc-400 border-zinc-700"}`}>
            {activeConv.id === 1 ? "Active" : "Completed"}
          </span>
          {activeConv.id === 1 && (
            <>
              <span className="text-zinc-700 mx-1">·</span>
              <div className="flex items-center gap-1 text-xs text-zinc-500">
                <Calendar className="w-3 h-3" /> Session tomorrow 10:00 AM
              </div>
            </>
          )}
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
          {messages.map((msg) => (
            <div key={msg.id} className={`flex ${msg.from === "client" ? "justify-end" : "justify-start"}`}>
              {msg.from === "pt" && (
                <div className="w-7 h-7 bg-emerald-500/15 border border-emerald-500/20 rounded-full flex items-center justify-center text-xs font-bold text-emerald-400 mr-2 flex-shrink-0 mt-0.5">
                  {activeConv.avatar}
                </div>
              )}
              <div className={`max-w-[70%] sm:max-w-xs lg:max-w-sm`}>
                <div className={`px-4 py-2.5 rounded-2xl text-sm ${
                  msg.from === "client"
                    ? "bg-green-500 text-black rounded-br-sm font-medium"
                    : "bg-zinc-900 text-zinc-300 border border-zinc-800/60 rounded-bl-sm"
                }`}>
                  {msg.text}
                </div>
                <div className={`text-xs mt-1 text-zinc-600 ${msg.from === "client" ? "text-right" : ""}`}>
                  {msg.time}
                </div>
              </div>
            </div>
          ))}
          <div ref={bottomRef} />
        </div>

        {/* Input */}
        <div className="bg-zinc-900 border-t border-zinc-800/60 p-3 flex-shrink-0">
          {activeConv.id === 2 ? (
            <div className="text-center text-xs text-zinc-600 py-2">Contract has ended — messaging disabled</div>
          ) : (
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
                disabled={!input.trim()}
                className="w-9 h-9 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-xl flex items-center justify-center transition-all flex-shrink-0 shadow-lg shadow-green-500/20"
              >
                <Send className="w-4 h-4" />
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
