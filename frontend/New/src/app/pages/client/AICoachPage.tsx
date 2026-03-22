import { useState, useRef, useEffect } from "react";
import { Bot, Send, Lightbulb, AlertCircle, RefreshCw, User, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { inbodyService } from "../../services/api";

interface ChatMessage { id: number; from: "user" | "ai"; text: string; time: string; }

const suggestions = [
  "Why is my body fat not decreasing?",
  "How much protein should I eat today?",
  "What exercises target my weak lower body?",
  "Explain my InBody skeletal muscle score",
  "Can I train if I feel sore?",
  "What's the best time to do cardio?",
];

const initialMessage = (latest: any, prev: any) => {
  const weightStr = latest ? `${latest.weight} kg` : "---";
  const weightDiff = (latest && prev) ? (latest.weight - prev.weight).toFixed(1) : "0.0";
  const muscleStr = latest ? `${latest.muscleMass} kg` : "---";
  const muscleDiff = (latest && prev) ? (latest.muscleMass - prev.muscleMass).toFixed(1) : "0.0";
  const fatStr = latest ? `${latest.bodyFatPct}%` : "---";

  return {
    id: 1,
    from: "ai" as const,
    text: `Hi! I'm your AI Fitness Coach. I've analyzed your fitness data. How can I help you today?\n\n📊 **Latest Stats:**\n- Weight: ${weightStr} (${weightDiff.startsWith("-") ? "↓" : "↑"} ${Math.abs(Number(weightDiff))} kg)\n- Muscle: ${muscleStr} (${muscleDiff.startsWith("-") ? "↓" : "↑"} ${Math.abs(Number(muscleDiff))} kg)\n- Body Fat: ${fatStr}\n\nAsk me anything about your progress!`,
    time: "Now"
  };
};

const getAiReply = (text: string, latest: any) => {
  const lower = text.toLowerCase();
  const weight = latest?.weight || "---";
  
  if (lower.includes("protein")) {
    const proteinFactor = 2.0;
    const proteinTarget = latest?.weight ? Math.round(latest.weight * proteinFactor) : 150;
    return `Based on your weight of ${weight} kg, I recommend **${proteinTarget}g of protein per day**.\n\n📌 **Tips:**\n• Scale: ${proteinFactor}g per kg\n• Sources: Chicken, Eggs, Whey, Greek Yogurt.`;
  }
  
  if (lower.includes("fat")) {
    return `Your latest body fat is ${latest?.bodyFatPct || "---"}%.\n\n💡 **Focus:**\n1. Maintain a slight caloric deficit\n2. Keep protein high\n3. Consistency with your training sessions.`;
  }

  return "That's a great question! Based on your data, the best strategy is consistent training and proper recovery. Do you have a specific goal in mind?";
};

export function AICoachPage() {
  const { data: history = [], isLoading } = useQuery({
    queryKey: ["inbody-history"],
    queryFn: inbodyService.getHistory
  });

  const latest = history[0];
  const prev = history[1];

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [aiLoading, setAiLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!isLoading && messages.length === 0) {
      setMessages([initialMessage(latest, prev)]);
    }
  }, [isLoading, latest, prev]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { id: Date.now(), from: "user", text: text.trim(), time: "Now" };
    setMessages(prevMsgs => [...prevMsgs, userMsg]);
    setInput("");
    setAiLoading(true);
    setTimeout(() => {
      const replyText = getAiReply(text, latest);
      setMessages(prevMsgs => [...prevMsgs, { id: Date.now() + 1, from: "ai", text: replyText, time: "Now" }]);
      setAiLoading(false);
    }, 1200);
  };

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const renderText = (text: string) => {
    return text.split("\n").map((line, i) => {
      if (line.startsWith("**") && line.endsWith("**")) {
        return <p key={i} className="font-semibold text-zinc-100">{line.replace(/\*\*/g, "")}</p>;
      }
      if (line.startsWith("• ") || line.startsWith("• ")) {
        return <p key={i} className="ml-2">• {line.slice(2)}</p>;
      }
      if (line.match(/^\d+\. /)) return <p key={i} className="ml-2">{line}</p>;
      if (line.startsWith("📊") || line.startsWith("📌") || line.startsWith("💡") || line.startsWith("⚠️")) {
        return <p key={i} className="font-semibold">{line}</p>;
      }
      return line ? <p key={i}>{line}</p> : <br key={i} />;
    });
  };

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col max-w-3xl mx-auto w-full">
      {/* Header */}
      <div className="bg-zinc-900 border-b border-zinc-800/60 px-4 py-3 flex items-center gap-3 flex-shrink-0">
        <div className="w-9 h-9 bg-green-500/15 border border-green-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
          <Bot className="w-5 h-5 text-green-400" />
        </div>
        <div>
          <div className="text-sm font-semibold text-zinc-200">AI Fitness Coach</div>
          <div className="flex items-center gap-1 text-xs text-green-400">
            <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
            Analyzing your data
          </div>
        </div>
        <div className="ml-auto">
          <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
            <AlertCircle className="w-3 h-3" /> Not medical advice
          </span>
        </div>
      </div>

      {/* Messages */}
      <div className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-950">
        {messages.map((msg) => (
          <div key={msg.id} className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"} gap-2`}>
            {msg.from === "ai" && (
              <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                <Bot className="w-4 h-4 text-green-400" />
              </div>
            )}
            <div className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-sm space-y-1 ${
              msg.from === "user"
                ? "bg-green-500 text-black rounded-br-sm font-medium"
                : "bg-zinc-900 border border-zinc-800/60 text-zinc-300 rounded-bl-sm"
            }`}>
              {renderText(msg.text)}
            </div>
            {msg.from === "user" && (
              <div className="w-7 h-7 bg-zinc-800 rounded-full flex items-center justify-center flex-shrink-0 mt-1 border border-zinc-700">
                <User className="w-4 h-4 text-zinc-400" />
              </div>
            )}
          </div>
        ))}
        {aiLoading && (
          <div className="flex items-center gap-2">
            <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center">
              <Bot className="w-4 h-4 text-green-400" />
            </div>
            <div className="bg-zinc-900 border border-zinc-800/60 rounded-2xl rounded-bl-sm px-4 py-3">
              <div className="flex gap-1">
                {[0, 1, 2].map(i => <div key={i} className="w-2 h-2 bg-green-500 rounded-full animate-bounce" style={{ animationDelay: `${i * 0.15}s` }} />)}
              </div>
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800/60 flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-zinc-500">Suggested questions</span>
          </div>
          <div className="flex gap-2 overflow-x-auto pb-1">
            {suggestions.map(s => (
              <button key={s} onClick={() => send(s)} className="whitespace-nowrap px-3 py-1.5 bg-zinc-800 border border-zinc-700/60 rounded-full text-xs text-zinc-400 hover:border-green-500/50 hover:text-green-400 transition-all">
                {s}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Input */}
      <div className="bg-zinc-900 border-t border-zinc-800/60 p-3 flex-shrink-0">
        <div className="flex items-center gap-2">
          <input
            type="text"
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={e => e.key === "Enter" && !aiLoading && send(input)}
            placeholder="Ask your AI coach anything…"
            className="flex-1 px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 text-zinc-200 placeholder-zinc-600 transition-all"
            disabled={aiLoading}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || aiLoading}
            className="w-10 h-10 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-xl flex items-center justify-center transition-all flex-shrink-0 shadow-lg shadow-green-500/20"
          >
            {aiLoading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-center text-xs text-zinc-600 mt-2">AI responses are based on your fitness data and are not medical advice.</p>
      </div>
    </div>
  );
}
