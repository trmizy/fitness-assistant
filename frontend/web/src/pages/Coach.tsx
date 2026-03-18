import React, { useState, useRef, useEffect } from 'react';
import { Send, Bot, User, Sparkles } from 'lucide-react';

import type { Message } from '../types';

export default function Coach() {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput]       = useState('');
  const [loading, setLoading]   = useState(false);
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const send = async (text: string) => {
    if (!text.trim() || loading) return;
    const userMsg: Message = { id: Date.now().toString(), role: 'user', content: text, timestamp: new Date() };
    setMessages(ms => [...ms, userMsg]);
    setInput('');
    setLoading(true);

    try {
      const res = await fetch('/api/ai/chat', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${localStorage.getItem('accessToken')}`,
        },
        body: JSON.stringify({ message: text }),
      });

      if (!res.ok) throw new Error('AI service unavailable');
      const data = await res.json();
      const aiMsg: Message = { id: (Date.now() + 1).toString(), role: 'assistant', content: data.response, timestamp: new Date() };
      setMessages(ms => [...ms, aiMsg]);
    } catch {
      const fallback: Message = {
        id: (Date.now() + 1).toString(),
        role: 'assistant',
        content: 'I’m currently running in demo mode — connect the AI service to get personalized responses. In the meantime, feel free to explore the app!',
        timestamp: new Date(),
      };
      setMessages(ms => [...ms, fallback]);
    } finally {
      setLoading(false);
    }
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    send(input);
  };

  const formatTime = (d: Date) =>
    d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });

  return (
    <div className="flex flex-col h-[calc(100vh-8rem)]">
      {/* Header */}
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

      {/* Messages */}
      <div className="flex-1 overflow-y-auto py-4 space-y-4 min-h-0">
        {messages.map(m => (
          <div key={m.id} className={`flex items-start gap-3 ${m.role === 'user' ? 'flex-row-reverse' : ''}`}>
            <div className={`w-8 h-8 rounded-full flex items-center justify-center flex-shrink-0
              ${m.role === 'assistant' ? 'bg-emerald-600/20 border border-emerald-600/30' : 'bg-zinc-700'}`}>
              {m.role === 'assistant'
                ? <Bot className="w-4 h-4 text-emerald-400" />
                : <User className="w-4 h-4 text-zinc-300" />}
            </div>
            <div className={`max-w-[80%] ${m.role === 'user' ? 'items-end' : 'items-start'} flex flex-col gap-1`}>
              <div className={`px-4 py-3 rounded-2xl text-sm leading-relaxed
                ${m.role === 'assistant'
                  ? 'bg-zinc-800 text-zinc-100 rounded-tl-sm'
                  : 'bg-emerald-600 text-white rounded-tr-sm'}`}>
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
              {[0, 150, 300].map(d => (
                <span key={d} className="w-1.5 h-1.5 rounded-full bg-zinc-500 animate-bounce"
                  style={{ animationDelay: `${d}ms` }} />
              ))}
            </div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Suggestions */}
      <div className="flex-shrink-0 flex gap-2 overflow-x-auto pb-3 pt-1 scrollbar-none">
        {/* No suggestions without mock data */}
      </div>

      {/* Input */}
      <form onSubmit={handleSubmit} className="flex-shrink-0 flex gap-3 pt-3 border-t border-zinc-800">
        <input
          value={input}
          onChange={e => setInput(e.target.value)}
          className="input flex-1"
          placeholder="Ask your AI coach anything…"
          disabled={loading}
        />
        <button type="submit" disabled={loading || !input.trim()}
          className="w-10 h-10 rounded-lg bg-emerald-600 flex items-center justify-center
                     hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed transition-colors flex-shrink-0">
          <Send className="w-4 h-4 text-white" />
        </button>
      </form>
    </div>
  );
}
