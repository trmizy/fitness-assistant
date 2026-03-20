import { useState, useRef, useEffect } from "react";
import { Bot, Send, Lightbulb, AlertCircle, RefreshCw, User } from "lucide-react";

interface ChatMessage { id: number; from: "user" | "ai"; text: string; time: string; }

const suggestions = [
  "Why is my body fat not decreasing?",
  "How much protein should I eat today?",
  "What exercises target my weak lower body?",
  "Explain my InBody skeletal muscle score",
  "Can I train if I feel sore?",
  "What's the best time to do cardio?",
];

const initialMessages: ChatMessage[] = [
  { id: 1, from: "ai", text: "Hi Alex! I'm your AI Fitness Coach. I've analyzed your latest InBody data and training history. How can I help you today?\n\n📊 **Quick Summary:**\n- Weight: 75.1 kg (↓ 6.9 kg from start)\n- Muscle Mass: 36.5 kg (↑ 2.5 kg)\n- Body Fat: 18.2% (↓ 3.1%)\n\nYou're making great progress! Ask me anything about your fitness journey.", time: "Now" }
];

const aiReplies: Record<string, string> = {
  "protein": "Based on your current weight of 75.1 kg and your goal of fat loss while preserving muscle, I recommend **160g of protein per day** (about 2.1g per kg of body weight).\n\n📌 **High-protein food sources:**\n• Chicken breast: 31g/100g\n• Greek yogurt: 10g/100g\n• Whey protein: 24g/30g serving\n• Eggs: 6g each\n\nYour current meal plan is designed to hit this target. Would you like me to show you a meal timing breakdown?",
  "body fat": "Your body fat has decreased from 21.8% to 18.2% over 5 months — that's excellent progress! Here's why it might feel slow sometimes:\n\n1. **Caloric deficit accuracy** – slight underestimation of portions is common\n2. **Training intensity** – your recent workout data shows some skipped sessions\n3. **Sleep quality** – poor sleep increases cortisol, which can slow fat loss\n\n💡 **My recommendation:** Track your food more precisely for 2 weeks and aim for 7-8 hours of sleep. Do you want a revised plan?",
  "default": "That's a great question! Based on your current fitness data and program, here's what I recommend:\n\nYour progress has been consistent and measurable. The key is to maintain your current habit stack while making small adjustments based on feedback.\n\n⚠️ **Note:** This is AI-generated guidance based on your data. It's not a substitute for medical advice. For medical concerns, please consult a healthcare professional.",
};

export function AICoachPage() {
  const [messages, setMessages] = useState<ChatMessage[]>(initialMessages);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: "smooth" }); }, [messages]);

  const send = (text: string) => {
    if (!text.trim()) return;
    const userMsg: ChatMessage = { id: messages.length + 1, from: "user", text: text.trim(), time: "Now" };
    setMessages(prev => [...prev, userMsg]);
    setInput("");
    setLoading(true);
    setTimeout(() => {
      const lower = text.toLowerCase();
      const reply = lower.includes("protein") ? aiReplies.protein : lower.includes("fat") ? aiReplies["body fat"] : aiReplies.default;
      setMessages(prev => [...prev, { id: prev.length + 1, from: "ai", text: reply, time: "Now" }]);
      setLoading(false);
    }, 1200);
  };

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
        {loading && (
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
            onKeyDown={e => e.key === "Enter" && !loading && send(input)}
            placeholder="Ask your AI coach anything…"
            className="flex-1 px-4 py-2.5 bg-zinc-800/60 border border-zinc-700/60 rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 text-zinc-200 placeholder-zinc-600 transition-all"
            disabled={loading}
          />
          <button
            onClick={() => send(input)}
            disabled={!input.trim() || loading}
            className="w-10 h-10 bg-green-500 hover:bg-green-400 disabled:bg-zinc-700 disabled:text-zinc-500 text-black rounded-xl flex items-center justify-center transition-all flex-shrink-0 shadow-lg shadow-green-500/20"
          >
            {loading ? <RefreshCw className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
          </button>
        </div>
        <p className="text-center text-xs text-zinc-600 mt-2">AI responses are based on your fitness data and are not medical advice.</p>
      </div>
    </div>
  );
}
