import { useState, useEffect, useCallback } from "react";
import { Bot, Send, Lightbulb, AlertCircle, RefreshCw, User, Loader2 } from "lucide-react";
import { useQuery } from "@tanstack/react-query";
import { inbodyService } from "../../services/api";
import { useApp } from "../../context/AppContext";
import { useAiCoachSession } from "../../stores/pendingAiTasks";

type ChatMessage = {
  id: number | string;
  from: "user" | "ai";
  text: string;
  time: string;
};

const BASE_SUGGESTIONS = [
  "Lập lịch tập cho tôi",
  "Tôi nên ăn gì?",
  "Tạo lịch tập 3 ngày/tuần",
  "Tôi muốn giảm mỡ nhưng giữ cơ",
  "Tôi muốn tăng cơ",
] as const;

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


export function AICoachPage() {
  const { user } = useApp();
  const userScopeId = user?.id ?? "guest";
  const { session, setInitialMessage, sendQuestion } = useAiCoachSession(userScopeId);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["inbody-history", userScopeId],
    queryFn: inbodyService.getHistory
  });

  const latest = history[0];
  const prev = history[1];

  const inBodySuggestion = latest ? "Phân tích InBody mới nhất của tôi" : "Phân tích InBody của tôi";
  const suggestions = [inBodySuggestion, ...BASE_SUGGESTIONS];

  const [input, setInput] = useState("");
  const messages = session.messages;
  const aiLoading = session.status === "processing";
  const isStreaming = aiLoading;

  useEffect(() => {
    if (!isLoading && messages.length === 0) {
      setInitialMessage(initialMessage(latest, prev));
    }
  }, [isLoading, latest, prev, messages.length, setInitialMessage]);

  const send = useCallback((text: string) => {
    if (!text.trim() || aiLoading) return;
    setInput("");
    sendQuestion(text.trim());
  }, [aiLoading, sendQuestion]);

  if (isLoading) {
    return (
      <div className="flex-1 flex items-center justify-center bg-zinc-950">
        <Loader2 className="w-8 h-8 text-green-500 animate-spin" />
      </div>
    );
  }

  const renderInline = (text: string, key: number) => {
    const parts = text.split(/(\*\*[^*]+\*\*)/g);
    return (
      <span key={key}>
        {parts.map((part, j) =>
          part.startsWith("**") && part.endsWith("**")
            ? <strong key={j} className="font-semibold text-zinc-100">{part.slice(2, -2)}</strong>
            : <span key={j}>{part}</span>
        )}
      </span>
    );
  };

  const renderTable = (lines: string[], startIdx: number): { el: React.ReactNode; consumed: number } => {
    const tableLines = [];
    let i = startIdx;
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      tableLines.push(lines[i]);
      i++;
    }
    if (tableLines.length < 2) return { el: null, consumed: 0 };

    const isHeaderSep = (l: string) => {
      const cells = l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());
      return cells.length > 0 && cells.every(c => /^[\-:]*$/.test(c));
    };
    const parseRow = (l: string) =>
      l.trim().replace(/^\||\|$/g, "").split("|").map(c => c.trim());

    const headers = parseRow(tableLines[0]);
    const dataRows = tableLines.filter((l, idx) => idx > 0 && !isHeaderSep(l)).map(parseRow);

    return {
      consumed: tableLines.length,
      el: (
        <div key={startIdx} className="overflow-x-auto my-2 rounded-lg border border-zinc-700/60">
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-800/80">
                {headers.map((h, j) => (
                  <th key={j} className="px-2 py-1.5 text-left font-semibold text-zinc-200 border-b border-zinc-700/60 whitespace-nowrap">
                    {renderInline(h, j)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr key={ri} className={ri % 2 === 0 ? "bg-zinc-900/40" : "bg-zinc-800/20"}>
                  {row.map((cell, ci) => (
                    <td key={ci} className="px-2 py-1.5 text-zinc-300 border-b border-zinc-800/40 whitespace-nowrap">
                      {renderInline(cell, ci)}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ),
    };
  };

  const renderText = (text: string) => {
    const lines = text.split("\n");
    const result: React.ReactNode[] = [];
    let i = 0;
    while (i < lines.length) {
      const line = lines[i];

      // Markdown table
      if (line.trim().startsWith("|")) {
        const { el, consumed } = renderTable(lines, i);
        if (consumed > 0) { result.push(el); i += consumed; continue; }
      }

      if (line.startsWith("## ")) {
        result.push(<p key={i} className="font-bold text-zinc-100 text-base mt-3 mb-0.5">{renderInline(line.slice(3), i)}</p>);
      } else if (line.startsWith("### ")) {
        result.push(<p key={i} className="font-semibold text-zinc-200 text-sm mt-2">{renderInline(line.slice(4), i)}</p>);
      } else if (line.startsWith("> ")) {
        result.push(<p key={i} className="text-xs text-zinc-500 border-l-2 border-zinc-700 pl-2 italic my-0.5">{line.slice(2)}</p>);
      } else if (line.startsWith("- ")) {
        result.push(<p key={i} className="ml-2 flex gap-1.5"><span className="text-green-500 mt-0.5 shrink-0">•</span><span>{renderInline(line.slice(2), i)}</span></p>);
      } else if (line.match(/^\d+\. /)) {
        const m = line.match(/^(\d+)\. (.*)$/);
        if (m) result.push(<p key={i} className="ml-2 flex gap-1.5"><span className="text-green-400 font-medium min-w-[16px] shrink-0">{m[1]}.</span><span>{renderInline(m[2], i)}</span></p>);
      } else if (!line.trim()) {
        result.push(<div key={i} className="h-1" />);
      } else {
        result.push(<p key={i}>{renderInline(line, i)}</p>);
      }
      i++;
    }
    return result;
  };

  return (
    <div className="h-[calc(100vh-56px)] flex flex-col w-full">
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
        {/* Bounce dots only for non-streaming fallback; streaming messages render inline above. */}
        {aiLoading && !isStreaming && (
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
          <div />
      </div>

      {/* Suggestions */}
      {messages.length <= 1 && (
        <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800/60 flex-shrink-0">
          <div className="flex items-center gap-1.5 mb-2">
            <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
            <span className="text-xs text-zinc-500">Gợi ý câu hỏi</span>
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
