import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';
import { coachService } from '../services/api';
import type { Message } from '../types';

const suggestionChips = [
  'Suggest a 45-minute upper body workout',
  'How much protein should I eat today?',
  'Give me a beginner fat-loss plan',
  'What should I do on rest day?',
];

type ConversationItem = {
  id: string;
  question: string;
  answer: string;
  createdAt: string;
};

export default function Coach() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const loadHistory = async () => {
      try {
        const data = await coachService.getConversations();
        const conversations: ConversationItem[] = Array.isArray(data?.conversations)
          ? (data.conversations as ConversationItem[])
          : [];

        const history: Message[] = conversations
          .slice()
          .reverse()
          .flatMap((c) => {
            const ts = new Date(c.createdAt);
            return [
              { id: `${c.id}-q`, role: 'user', content: c.question, timestamp: ts },
              { id: `${c.id}-a`, role: 'assistant', content: c.answer, timestamp: ts },
            ] as Message[];
          });

        setMessages(history);
      } catch {
        setError('Failed to load conversation history');
      }
    };

    loadHistory();
  }, []);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;

    const userMsg: Message = {
      id: Date.now().toString(),
      role: 'user',
      content: text,
      timestamp: new Date(),
    };

    setMessages((ms) => [...ms, userMsg]);
    setInput('');
    setLoading(true);
    setError('');

    try {
      const data = await coachService.chat(text);
      const aiMsg: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: data?.answer || 'No response from AI service.',
        timestamp: new Date(),
      };
      setMessages((ms) => [...ms, aiMsg]);
    } catch {
      setError('AI service is unavailable right now.');
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const formatTime = (d: Date) => d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      <div className="flex-shrink-0 flex items-center gap-3 pb-4 border-b border-zinc-800">
        <div className="w-9 h-9 rounded-xl bg-emerald-600/20 border border-emerald-600/30 flex items-center justify-center">
          <Bot className="w-5 h-5 text-emerald-400" />
        </div>
        <div>
          <h3 className="font-semibold text-white">AI Fitness Coach</h3>
          <div className="flex items-center gap-1.5">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-400 animate-pulse" />
            <span className="text-xs text-zinc-500">Online</span>
          </div>
        </div>
      </div>

      {error && (
        <div className="mt-3 rounded-lg border border-red-500/20 bg-red-500/10 px-4 py-3 text-sm text-red-400">
          {error}
        </div>
      )}

      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {messages.length === 0 && !loading && (
          <div className="text-sm text-zinc-500">No conversation yet. Ask your first question.</div>
        )}

        {messages.map((m) => (
          <div key={m.id} className={`flex items-start gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div
              className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
              ${m.role === 'assistant' ? 'bg-emerald-600/20 border border-emerald-600/30' : 'bg-zinc-700'}`}
            >
              {m.role === 'assistant' ? (
                <Bot className="w-4 h-4 text-emerald-400" />
              ) : (
                <User className="w-4 h-4 text-zinc-300" />
              )}
            </div>
            <div className={`max-w-[80%] ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
              <div
                className={`px-4 py-3 rounded-2xl text-sm leading-relaxed
                ${
                  m.role === 'assistant'
                    ? 'bg-zinc-800 text-zinc-100 rounded-tl-sm'
                    : 'bg-emerald-600 text-white rounded-tr-sm'
                }`}
              >
                {m.content}
              </div>
              <span className="text-xs text-zinc-600 px-1">{formatTime(m.timestamp)}</span>
            </div>
          </div>
        ))}

        {loading && (
          <div className="flex items-start gap-3">
            <div className="w-8 h-8 rounded-full bg-emerald-600/20 border border-emerald-600/30 flex items-center justify-center flex-shrink-0">
              <Bot className="w-4 h-4 text-emerald-400" />
            </div>
            <div className="px-4 py-3 rounded-2xl rounded-tl-sm bg-zinc-800 flex items-center gap-1.5">
              {[0, 150, 300].map((d) => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce" style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      <div className="flex-shrink-0 flex gap-2 overflow-x-auto pb-3 pt-1 scrollbar-none">
        {suggestionChips.map((chip) => (
          <button
            key={chip}
            onClick={() => send(chip)}
            className="flex-shrink-0 flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs bg-zinc-800 text-zinc-400 border border-zinc-700 hover:border-emerald-600/50 hover:text-emerald-400 transition-colors whitespace-nowrap"
          >
            <Sparkles className="w-3 h-3" />
            {chip}
          </button>
        ))}
      </div>

      <form onSubmit={handleSubmit} className="flex-shrink-0 flex gap-3 pt-3 border-t border-zinc-800">
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          className="input flex-1"
          placeholder="Ask your AI coach anything..."
          disabled={loading}
        />
        <button
          type="submit"
          disabled={loading || !input.trim()}
          className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0"
        >
          <Send className="w-4 h-4 text-white" />
        </button>
      </form>
    </div>
  );
}
