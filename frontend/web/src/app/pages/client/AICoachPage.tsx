import { useState, useEffect, useCallback, useRef } from "react";
import { useSearchParams } from "react-router";
import { RobotIcon as Bot, PaperPlaneTiltIcon as Send, LightbulbIcon as Lightbulb, WarningCircleIcon as AlertCircle, ArrowsClockwiseIcon as RefreshCw, UserIcon as User, CircleNotchIcon as Loader2, BookOpenIcon as BookOpen, ArrowSquareOutIcon as ExternalLink, PlusIcon as Plus, ChatTextIcon as MessageSquare, PencilSimpleIcon as Pencil, TrashIcon as Trash2, CheckIcon as Check, XIcon as X, CaretLeftIcon as ChevronLeft } from "@phosphor-icons/react";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { inbodyService, coachService, type AiChatSessionSummary } from "../../services/api";
import { useApp } from "../../context/AppContext";
import {
  useAiCoachSession,
  newDraftSessionKey,
  hydrateSessionMessages,
} from "../../stores/pendingAiTasks";
import { AutoText } from "../../components/i18n/AutoText";
import { useAutoTranslate } from "../../hooks/useAutoTranslate";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "../../components/ui/alert-dialog";

type ChatMessage = {
  id: number | string;
  from: "user" | "ai";
  text: string;
  time: string;
  evidenceUsed?: Array<{
    title: string;
    source_url: string;
    category: string;
    source_type: string;
    summary: string;
  }>;
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
  const weightDiff =
    latest && prev ? (latest.weight - prev.weight).toFixed(1) : "0.0";
  const muscleStr = latest ? `${latest.muscleMass} kg` : "---";
  const muscleDiff =
    latest && prev ? (latest.muscleMass - prev.muscleMass).toFixed(1) : "0.0";
  const fatStr = latest ? `${latest.bodyFatPct}%` : "---";

  return {
    id: 1,
    from: "ai" as const,
    text: `Hi! I'm your AI Fitness Coach. I've analyzed your fitness data. How can I help you today?\n\n📊 **Latest Stats:**\n- Weight: ${weightStr} (${weightDiff.startsWith("-") ? "↓" : "↑"} ${Math.abs(Number(weightDiff))} kg)\n- Muscle: ${muscleStr} (${muscleDiff.startsWith("-") ? "↓" : "↑"} ${Math.abs(Number(muscleDiff))} kg)\n- Body Fat: ${fatStr}\n\nAsk me anything about your progress!`,
    time: "Now",
  };
};

function relativeTime(iso: string): string {
  const diffMs = Date.now() - new Date(iso).getTime();
  const minutes = Math.floor(diffMs / 60000);
  if (minutes < 1) return "Vừa xong";
  if (minutes < 60) return `${minutes} phút trước`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours} giờ trước`;
  const days = Math.floor(hours / 24);
  if (days < 7) return `${days} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}

export function AICoachPage() {
  const { user } = useApp();
  const userScopeId = user?.id ?? "guest";
  const queryClient = useQueryClient();
  const [searchParams, setSearchParams] = useSearchParams();
  const activeSessionId = searchParams.get("sessionId");
  const [draftKey, setDraftKey] = useState(() => newDraftSessionKey());
  const [mobileView, setMobileView] = useState<"list" | "chat">(
    activeSessionId ? "chat" : "list",
  );
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [archiveTarget, setArchiveTarget] =
    useState<AiChatSessionSummary | null>(null);

  const sessionKey = activeSessionId ?? draftKey;

  const { session, setInitialMessage, sendQuestion } = useAiCoachSession(
    userScopeId,
    sessionKey,
  );

  const { data: sessions = [] } = useQuery({
    queryKey: ["ai-sessions", userScopeId],
    queryFn: coachService.listSessions,
    refetchInterval: 10000,
  });

  const { data: sessionMessages } = useQuery({
    queryKey: ["ai-session-messages", userScopeId, activeSessionId],
    queryFn: () =>
      activeSessionId
        ? coachService.getSessionMessages(activeSessionId)
        : Promise.resolve([]),
    enabled: !!activeSessionId,
  });

  useEffect(() => {
    if (activeSessionId && sessionMessages) {
      hydrateSessionMessages(userScopeId, activeSessionId, sessionMessages);
    }
  }, [userScopeId, activeSessionId, sessionMessages]);

  const { data: history = [], isLoading } = useQuery({
    queryKey: ["inbody-history", userScopeId],
    queryFn: inbodyService.getHistory,
  });

  const latest = history[0];
  const prev = history[1];

  const inBodySuggestion = latest
    ? "Phân tích InBody mới nhất của tôi"
    : "Phân tích InBody của tôi";
  const suggestions = [inBodySuggestion, ...BASE_SUGGESTIONS];

  const [input, setInput] = useState("");
  const { text: inputPlaceholder } = useAutoTranslate(
    "Ask your AI coach anything...",
    "en",
  );
  const messagesEndRef = useRef<HTMLDivElement | null>(null);
  const messages = session.messages;
  const aiLoading = session.status === "processing";
  const isStreaming = aiLoading;
  const latestMessage = messages[messages.length - 1];

  const scrollToLatestMessage = useCallback(
    (behavior: ScrollBehavior = "smooth") => {
      messagesEndRef.current?.scrollIntoView({ behavior, block: "end" });
    },
    [],
  );

  // Only seed the InBody-stats greeting for a brand-new (draft) thread — a
  // real loaded thread's messages come from hydrateSessionMessages instead.
  useEffect(() => {
    if (!activeSessionId && !isLoading && messages.length === 0) {
      setInitialMessage(initialMessage(latest, prev));
    }
  }, [
    activeSessionId,
    isLoading,
    latest,
    prev,
    messages.length,
    setInitialMessage,
  ]);

  useEffect(() => {
    scrollToLatestMessage(messages.length <= 1 ? "auto" : "smooth");
  }, [
    latestMessage?.id,
    latestMessage?.text,
    messages.length,
    aiLoading,
    scrollToLatestMessage,
  ]);

  const handleSessionAdopted = useCallback(
    (newSessionId: string) => {
      setSearchParams({ sessionId: newSessionId }, { replace: true });
      void queryClient.invalidateQueries({
        queryKey: ["ai-sessions", userScopeId],
      });
    },
    [setSearchParams, queryClient, userScopeId],
  );

  const send = useCallback(
    (text: string) => {
      if (!text.trim() || aiLoading) return;
      setInput("");
      sendQuestion(text.trim(), handleSessionAdopted);
      window.requestAnimationFrame(() => scrollToLatestMessage("smooth"));
    },
    [aiLoading, scrollToLatestMessage, sendQuestion, handleSessionAdopted],
  );

  const startNewChat = useCallback(() => {
    setDraftKey(newDraftSessionKey());
    setSearchParams({}, { replace: true });
    setMobileView("chat");
  }, [setSearchParams]);

  const selectSession = useCallback(
    (id: string) => {
      setSearchParams({ sessionId: id });
      setMobileView("chat");
    },
    [setSearchParams],
  );

  const renameMutation = useCallback(
    async (id: string, title: string) => {
      const trimmed = title.trim();
      if (!trimmed) {
        setRenamingId(null);
        return;
      }
      try {
        await coachService.renameSession(id, trimmed);
      } finally {
        setRenamingId(null);
        void queryClient.invalidateQueries({
          queryKey: ["ai-sessions", userScopeId],
        });
      }
    },
    [queryClient, userScopeId],
  );

  const confirmArchive = useCallback(async () => {
    if (!archiveTarget) return;
    const wasActive = archiveTarget.id === activeSessionId;
    await coachService.archiveSession(archiveTarget.id);
    setArchiveTarget(null);
    void queryClient.invalidateQueries({
      queryKey: ["ai-sessions", userScopeId],
    });
    if (wasActive) {
      setDraftKey(newDraftSessionKey());
      setSearchParams({}, { replace: true });
    }
  }, [archiveTarget, activeSessionId, queryClient, userScopeId, setSearchParams]);

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
          part.startsWith("**") && part.endsWith("**") ? (
            <strong key={j} className="font-semibold text-zinc-100">
              {part.slice(2, -2)}
            </strong>
          ) : (
            <span key={j}>{part}</span>
          ),
        )}
      </span>
    );
  };

  const renderTable = (
    lines: string[],
    startIdx: number,
  ): { el: React.ReactNode; consumed: number } => {
    const tableLines = [];
    let i = startIdx;
    while (i < lines.length && lines[i].trim().startsWith("|")) {
      tableLines.push(lines[i]);
      i++;
    }
    if (tableLines.length < 2) return { el: null, consumed: 0 };

    const isHeaderSep = (l: string) => {
      const cells = l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());
      return cells.length > 0 && cells.every((c) => /^[\-:]*$/.test(c));
    };
    const parseRow = (l: string) =>
      l
        .trim()
        .replace(/^\||\|$/g, "")
        .split("|")
        .map((c) => c.trim());

    const headers = parseRow(tableLines[0]);
    const dataRows = tableLines
      .filter((l, idx) => idx > 0 && !isHeaderSep(l))
      .map(parseRow);

    return {
      consumed: tableLines.length,
      el: (
        <div
          key={startIdx}
          className="overflow-x-auto my-2 rounded-lg border border-zinc-700/60"
        >
          <table className="w-full text-xs border-collapse">
            <thead>
              <tr className="bg-zinc-800/80">
                {headers.map((h, j) => (
                  <th
                    key={j}
                    className="px-2 py-1.5 text-left font-semibold text-zinc-200 border-b border-zinc-700/60 whitespace-nowrap"
                  >
                    {renderInline(h, j)}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {dataRows.map((row, ri) => (
                <tr
                  key={ri}
                  className={ri % 2 === 0 ? "bg-zinc-900/40" : "bg-zinc-800/20"}
                >
                  {row.map((cell, ci) => (
                    <td
                      key={ci}
                      className="px-2 py-1.5 text-zinc-300 border-b border-zinc-800/40 whitespace-nowrap"
                    >
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
        if (consumed > 0) {
          result.push(el);
          i += consumed;
          continue;
        }
      }

      if (line.startsWith("## ")) {
        result.push(
          <p key={i} className="font-bold text-zinc-100 text-base mt-3 mb-0.5">
            {renderInline(line.slice(3), i)}
          </p>,
        );
      } else if (line.startsWith("### ")) {
        result.push(
          <p key={i} className="font-semibold text-zinc-200 text-sm mt-2">
            {renderInline(line.slice(4), i)}
          </p>,
        );
      } else if (line.startsWith("> ")) {
        result.push(
          <p
            key={i}
            className="text-xs text-zinc-500 border-l-2 border-zinc-700 pl-2 italic my-0.5"
          >
            {line.slice(2)}
          </p>,
        );
      } else if (line.startsWith("- ")) {
        result.push(
          <p key={i} className="ml-2 flex gap-1.5">
            <span className="text-green-500 mt-0.5 shrink-0">•</span>
            <span>{renderInline(line.slice(2), i)}</span>
          </p>,
        );
      } else if (line.match(/^\d+\. /)) {
        const m = line.match(/^(\d+)\. (.*)$/);
        if (m)
          result.push(
            <p key={i} className="ml-2 flex gap-1.5">
              <span className="text-green-400 font-medium min-w-[16px] shrink-0">
                {m[1]}.
              </span>
              <span>{renderInline(m[2], i)}</span>
            </p>,
          );
      } else if (!line.trim()) {
        result.push(<div key={i} className="h-1" />);
      } else {
        result.push(<p key={i}>{renderInline(line, i)}</p>);
      }
      i++;
    }
    return result;
  };

  const renderEvidenceSources = (msg: ChatMessage) => {
    const evidence = Array.isArray(msg.evidenceUsed)
      ? msg.evidenceUsed.slice(0, 3)
      : [];
    if (msg.from !== "ai" || evidence.length === 0) return null;

    return (
      <div className="mt-3 border-t border-zinc-800/80 pt-2 space-y-1.5">
        <div className="flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-wide text-cyan-300">
          <BookOpen className="w-3 h-3" />
          Sources
        </div>
        {evidence.map((item, index) => (
          <a
            key={`${item.source_url || item.title}-${index}`}
            href={item.source_url || undefined}
            target="_blank"
            rel="noreferrer"
            className="group block rounded-lg border border-zinc-800 bg-zinc-950/70 px-2.5 py-2 hover:border-cyan-500/50 transition-colors"
          >
            <div className="flex items-start gap-2">
              <span className="mt-0.5 shrink-0 text-[10px] font-mono text-cyan-400">
                E{index + 1}
              </span>
              <div className="min-w-0 flex-1">
                <div className="flex items-start gap-1.5">
                  <span className="truncate text-xs font-medium text-zinc-200 group-hover:text-cyan-200">
                    {item.title || item.source_url}
                  </span>
                  {item.source_url && (
                    <ExternalLink className="mt-0.5 h-3 w-3 shrink-0 text-zinc-500 group-hover:text-cyan-300" />
                  )}
                </div>
                <div className="mt-0.5 text-[10px] text-zinc-500">
                  {[item.source_type, item.category]
                    .filter(Boolean)
                    .join(" · ")}
                </div>
              </div>
            </div>
          </a>
        ))}
      </div>
    );
  };

  return (
    <div className="h-[calc(100vh-56px)] flex bg-zinc-950">
      {/* Session sidebar */}
      <div
        className={`${mobileView === "chat" ? "hidden" : "flex"} lg:flex flex-col w-full lg:w-72 bg-zinc-900 border-r border-zinc-800/60 flex-shrink-0`}
      >
        <div className="p-3 border-b border-zinc-800/60">
          <button
            onClick={startNewChat}
            className="w-full flex items-center justify-center gap-2 px-3 py-2 bg-green-500 hover:bg-green-400 text-black text-sm font-semibold rounded-xl transition-colors"
          >
            <Plus className="w-4 h-4" />
            Cuộc trò chuyện mới
          </button>
        </div>
        <div className="flex-1 overflow-y-auto">
          {sessions.length > 0 ? (
            sessions.map((s) => (
              <div
                key={s.id}
                onClick={() => renamingId !== s.id && selectSession(s.id)}
                className={`group flex items-start gap-2 px-3 py-3 border-b border-zinc-800/40 cursor-pointer transition-colors ${
                  activeSessionId === s.id
                    ? "bg-green-500/8 border-l-2 border-l-green-500"
                    : "hover:bg-zinc-800/40"
                }`}
              >
                <MessageSquare className="w-4 h-4 text-zinc-600 mt-0.5 flex-shrink-0" />
                <div className="flex-1 min-w-0">
                  {renamingId === s.id ? (
                    <div className="flex items-center gap-1">
                      <input
                        autoFocus
                        value={renameValue}
                        onChange={(e) => setRenameValue(e.target.value)}
                        onClick={(e) => e.stopPropagation()}
                        onKeyDown={(e) => {
                          if (e.key === "Enter") renameMutation(s.id, renameValue);
                          if (e.key === "Escape") setRenamingId(null);
                        }}
                        className="flex-1 min-w-0 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-xs text-zinc-200 outline-none focus:border-green-500/50"
                      />
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          renameMutation(s.id, renameValue);
                        }}
                        className="text-green-400 hover:text-green-300 flex-shrink-0"
                      >
                        <Check className="w-3.5 h-3.5" />
                      </button>
                      <button
                        onClick={(e) => {
                          e.stopPropagation();
                          setRenamingId(null);
                        }}
                        className="text-zinc-500 hover:text-zinc-300 flex-shrink-0"
                      >
                        <X className="w-3.5 h-3.5" />
                      </button>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm text-zinc-200 truncate">
                        {s.title}
                      </div>
                      <div className="text-xs text-zinc-600 mt-0.5">
                        {relativeTime(s.lastMessageAt)}
                      </div>
                    </>
                  )}
                </div>
                {renamingId !== s.id && (
                  <div className="hidden group-hover:flex items-center gap-1 flex-shrink-0">
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(s.id);
                        setRenameValue(s.title);
                      }}
                      className="p-1 text-zinc-500 hover:text-zinc-200 transition-colors"
                      title="Đổi tên"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        setArchiveTarget(s);
                      }}
                      className="p-1 text-zinc-500 hover:text-red-400 transition-colors"
                      title="Xoá"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                )}
              </div>
            ))
          ) : (
            <div className="p-6 text-center">
              <MessageSquare className="w-8 h-8 text-zinc-800 mx-auto mb-2" />
              <p className="text-xs text-zinc-600">
                Chưa có cuộc trò chuyện nào.
              </p>
            </div>
          )}
        </div>
      </div>

      {/* Chat panel */}
      <div
        className={`${mobileView === "list" ? "hidden" : "flex"} lg:flex flex-col flex-1 min-w-0`}
      >
        {/* Header */}
        <div className="bg-zinc-900 border-b border-zinc-800/60 px-4 py-3 flex items-center gap-3 flex-shrink-0">
          <button
            onClick={() => setMobileView("list")}
            className="lg:hidden text-zinc-500 hover:text-zinc-300 transition-colors"
          >
            <ChevronLeft className="w-5 h-5" />
          </button>
          <div className="w-9 h-9 bg-green-500/15 border border-green-500/30 rounded-xl flex items-center justify-center flex-shrink-0">
            <Bot className="w-5 h-5 text-green-400" />
          </div>
          <div>
            <div className="text-sm font-semibold text-zinc-200">
              AI Fitness Coach
            </div>
            <div className="flex items-center gap-1 text-xs text-green-400">
              <div className="w-1.5 h-1.5 bg-green-500 rounded-full shadow-[0_0_6px_rgba(34,197,94,0.8)]" />
              Analyzing your data
            </div>
          </div>
          <div className="ml-auto">
            <span className="text-xs bg-amber-500/10 text-amber-400 border border-amber-500/20 px-2 py-0.5 rounded-full flex items-center gap-1">
              <AlertCircle className="w-3 h-3" />
              <AutoText sourceLang="en">Not medical advice</AutoText>
            </span>
          </div>
        </div>

        {/* Messages */}
        <div
          className="flex-1 overflow-y-auto p-4 space-y-4 bg-zinc-950"
          onClick={() => scrollToLatestMessage("smooth")}
        >
          {messages.map((msg) => (
            <div
              key={msg.id}
              className={`flex ${msg.from === "user" ? "justify-end" : "justify-start"} gap-2`}
            >
              {msg.from === "ai" && (
                <div className="w-7 h-7 bg-green-500/15 border border-green-500/20 rounded-full flex items-center justify-center flex-shrink-0 mt-1">
                  <Bot className="w-4 h-4 text-green-400" />
                </div>
              )}
              <div
                className={`max-w-[85%] sm:max-w-[70%] rounded-2xl px-4 py-3 text-sm space-y-1 ${
                  msg.from === "user"
                    ? "bg-green-500 text-black rounded-br-sm font-medium"
                    : "bg-zinc-900 border border-zinc-800/60 text-zinc-300 rounded-bl-sm"
                }`}
              >
                {renderText(msg.text)}
                {renderEvidenceSources(msg)}
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
                  {[0, 1, 2].map((i) => (
                    <div
                      key={i}
                      className="w-2 h-2 bg-green-500 rounded-full animate-bounce"
                      style={{ animationDelay: `${i * 0.15}s` }}
                    />
                  ))}
                </div>
              </div>
            </div>
          )}
          <div ref={messagesEndRef} aria-hidden="true" />
        </div>

        {/* Suggestions */}
        {messages.length <= 1 && (
          <div className="px-4 py-2 bg-zinc-900 border-t border-zinc-800/60 flex-shrink-0">
            <div className="flex items-center gap-1.5 mb-2">
              <Lightbulb className="w-3.5 h-3.5 text-amber-400" />
              <AutoText className="text-xs text-zinc-500">
                Gợi ý câu hỏi
              </AutoText>
            </div>
            <div className="flex gap-2 overflow-x-auto pb-1">
              {suggestions.map((s) => (
                <button
                  key={s}
                  onClick={() => send(s)}
                  className="whitespace-nowrap px-3 py-1.5 rounded-full text-xs transition-all"
                  style={{
                    backgroundColor: "var(--panel-bg)",
                    borderColor: "var(--border-color)",
                    color: "var(--muted-text-color)",
                    borderWidth: 1,
                  }}
                >
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {/* Input */}
        <div
          className="border-t p-3 flex-shrink-0"
          style={{
            backgroundColor: "var(--card-bg)",
            borderColor: "var(--border-color)",
          }}
        >
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onFocus={() => scrollToLatestMessage("smooth")}
              onKeyDown={(e) => e.key === "Enter" && !aiLoading && send(input)}
              placeholder={inputPlaceholder}
              className="flex-1 px-4 py-2.5 border rounded-xl text-sm outline-none focus:ring-2 focus:ring-green-500/50 focus:border-green-500/50 transition-all"
              disabled={aiLoading}
            />
            <button
              onClick={() => send(input)}
              disabled={!input.trim() || aiLoading}
              className="w-10 h-10 rounded-xl flex items-center justify-center transition-all flex-shrink-0 shadow-lg shadow-green-500/20 disabled:opacity-50"
              style={{
                backgroundColor: "var(--button-bg)",
                color: "var(--button-text)",
              }}
            >
              {aiLoading ? (
                <RefreshCw className="w-4 h-4 animate-spin" />
              ) : (
                <Send className="w-4 h-4" />
              )}
            </button>
          </div>
          <p
            className="text-center text-xs mt-2"
            style={{ color: "var(--muted-text-color)" }}
          >
            <AutoText sourceLang="en">
              AI responses are based on your fitness data and are not medical advice.
            </AutoText>
          </p>
        </div>
      </div>

      <AlertDialog
        open={Boolean(archiveTarget)}
        onOpenChange={(open) => {
          if (!open) setArchiveTarget(null);
        }}
      >
        <AlertDialogContent className="bg-zinc-950 border-zinc-800 text-zinc-100">
          <AlertDialogHeader>
            <AlertDialogTitle>Xoá cuộc trò chuyện?</AlertDialogTitle>
            <AlertDialogDescription className="text-zinc-400">
              Cuộc trò chuyện sẽ bị ẩn khỏi danh sách. Hành động này không thể
              hoàn tác từ giao diện.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel className="border-zinc-700 text-zinc-200 hover:bg-zinc-900">
              Huỷ
            </AlertDialogCancel>
            <AlertDialogAction
              onClick={() => void confirmArchive()}
              className="bg-red-500 text-white hover:bg-red-400"
            >
              Xoá
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
