import React, { useState, useEffect, useRef, useCallback } from 'react';
import { Send, MessageSquare, Plus, User } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { chatService, profileService } from '../services/api';
import { connectSocket, disconnectSocket } from '../services/socket';
import type { Conversation, ChatMessage } from '../types';

interface PTProfile {
  userId: string;
  id: string;
}

export default function Chat() {
  const { user } = useAuth();
  const [conversations, setConversations]   = useState<Conversation[]>([]);
  const [activeConvId, setActiveConvId]     = useState<string | null>(null);
  const [messages, setMessages]             = useState<ChatMessage[]>([]);
  const [input, setInput]                   = useState('');
  const [pts, setPts]                       = useState<PTProfile[]>([]);
  const [showNewChat, setShowNewChat]       = useState(false);
  const [loadingMsgs, setLoadingMsgs]       = useState(false);
  const [sendingMsg, setSendingMsg]         = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  // ── Load conversations on mount ───────────────────────────────
  useEffect(() => {
    chatService.listConversations()
      .then(d => setConversations(d.conversations ?? []))
      .catch(() => {});

    profileService.listPTs()
      .then(d => setPts(d.pts ?? []))
      .catch(() => {});
  }, []);

  // ── Socket.IO setup ───────────────────────────────────────────
  useEffect(() => {
    const socket = connectSocket();

    socket.on('chat:new_message', (msg: ChatMessage) => {
      // Add message if we're viewing that conversation
      setMessages(prev =>
        prev.length > 0 && prev[0].conversationId === msg.conversationId
          ? [...prev, msg]
          : prev,
      );
      // Update lastMessageAt in conversation list
      setConversations(prev =>
        prev.map(c =>
          c.id === msg.conversationId
            ? { ...c, lastMessageAt: msg.createdAt, messages: [msg] }
            : c,
        ),
      );
    });

    return () => {
      socket.off('chat:new_message');
      disconnectSocket();
    };
  }, []);

  // ── Load messages when conversation changes ───────────────────
  useEffect(() => {
    if (!activeConvId) return;

    const socket = connectSocket();
    // Leave previous room first (handled by leaving)
    socket.emit('chat:join_conversation', { conversationId: activeConvId });

    setLoadingMsgs(true);
    chatService.getMessages(activeConvId)
      .then(d => setMessages(d.messages ?? []))
      .catch(() => setMessages([]))
      .finally(() => setLoadingMsgs(false));

    return () => {
      socket.emit('chat:leave_conversation', { conversationId: activeConvId });
    };
  }, [activeConvId]);

  // ── Auto-scroll ───────────────────────────────────────────────
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  // ── Send message ──────────────────────────────────────────────
  const handleSend = useCallback(async () => {
    const content = input.trim();
    if (!content || !activeConvId || sendingMsg) return;

    setInput('');
    setSendingMsg(true);
    try {
      // Use Socket.IO for real-time delivery
      const socket = connectSocket();
      socket.emit('chat:send_message', { conversationId: activeConvId, content });
    } catch {
      setInput(content); // restore on failure
    } finally {
      setSendingMsg(false);
    }
  }, [input, activeConvId, sendingMsg]);

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  // ── Start conversation with a PT ──────────────────────────────
  const startChatWith = async (targetUserId: string) => {
    try {
      const { conversation } = await chatService.createDirectConversation(targetUserId);
      setConversations(prev => {
        const exists = prev.find(c => c.id === conversation.id);
        return exists ? prev : [conversation, ...prev];
      });
      setActiveConvId(conversation.id);
      setShowNewChat(false);
    } catch {
      // silently ignore for now
    }
  };

  // ── Get display name for a conversation ───────────────────────
  const getOtherParticipantId = (conv: Conversation) =>
    conv.participants.find(p => p.userId !== user?.id)?.userId ?? 'Unknown';

  return (
    <div className="flex h-[calc(100vh-130px)] rounded-xl overflow-hidden border border-zinc-800 bg-zinc-900">

      {/* ── Conversation list ────────────────────────────────── */}
      <div className="w-64 flex-shrink-0 border-r border-zinc-800 flex flex-col">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-800 flex items-center justify-between">
          <span className="text-sm font-semibold text-white">Conversations</span>
          <button
            id="new-chat-btn"
            onClick={() => setShowNewChat(v => !v)}
            className="w-7 h-7 rounded-md bg-zinc-800 hover:bg-emerald-600/20 text-zinc-400 hover:text-emerald-400 transition-colors flex items-center justify-center"
            title="Start new chat"
          >
            <Plus className="w-4 h-4" />
          </button>
        </div>

        {/* New chat: list PTs */}
        {showNewChat && (
          <div className="border-b border-zinc-800 p-3 space-y-1 bg-zinc-800/40">
            <p className="text-[10px] text-zinc-500 uppercase tracking-wide mb-2">Chat with PT</p>
            {pts.length === 0 && (
              <p className="text-xs text-zinc-500">No PTs available</p>
            )}
            {pts.map(pt => (
              <button
                key={pt.userId}
                id={`start-chat-${pt.userId}`}
                onClick={() => startChatWith(pt.userId)}
                className="w-full flex items-center gap-2 px-2 py-1.5 rounded-md text-sm text-zinc-300 hover:bg-zinc-700 transition-colors"
              >
                <div className="w-6 h-6 rounded-full bg-emerald-600 flex items-center justify-center text-white text-[10px] font-bold shrink-0">
                  PT
                </div>
                <span className="truncate">{pt.userId.slice(0, 8)}…</span>
              </button>
            ))}
          </div>
        )}

        {/* Conversation items */}
        <div className="flex-1 overflow-y-auto py-2">
          {conversations.length === 0 && (
            <div className="px-4 py-8 text-center">
              <MessageSquare className="w-8 h-8 text-zinc-700 mx-auto mb-2" />
              <p className="text-xs text-zinc-500">No conversations yet</p>
            </div>
          )}
          {conversations.map(conv => {
            const otherId = getOtherParticipantId(conv);
            const lastMsg = conv.messages?.[0];
            const isActive = conv.id === activeConvId;
            return (
              <button
                key={conv.id}
                id={`conv-${conv.id}`}
                onClick={() => setActiveConvId(conv.id)}
                className={`w-full flex items-center gap-3 px-4 py-3 text-left transition-colors border-b border-zinc-800/50 ${
                  isActive ? 'bg-emerald-600/10 border-l-2 border-l-emerald-600' : 'hover:bg-zinc-800'
                }`}
              >
                <div className="w-8 h-8 rounded-full bg-zinc-700 flex items-center justify-center shrink-0">
                  <User className="w-4 h-4 text-zinc-400" />
                </div>
                <div className="min-w-0 flex-1">
                  <p className="text-xs font-medium text-zinc-200 truncate">{otherId.slice(0, 8)}…</p>
                  <p className="text-[11px] text-zinc-500 truncate">
                    {lastMsg?.content ?? 'No messages yet'}
                  </p>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* ── Message panel ───────────────────────────────────── */}
      <div className="flex-1 flex flex-col min-w-0">
        {!activeConvId ? (
          <div className="flex-1 flex items-center justify-center flex-col gap-3 text-center px-8">
            <MessageSquare className="w-12 h-12 text-zinc-700" />
            <p className="text-zinc-500 text-sm">Select a conversation or start a new one</p>
          </div>
        ) : (
          <>
            {/* Messages */}
            <div className="flex-1 overflow-y-auto px-4 py-4 space-y-3">
              {loadingMsgs && (
                <div className="flex justify-center py-8">
                  <div className="w-5 h-5 rounded-full border-2 border-emerald-500 border-t-transparent animate-spin" />
                </div>
              )}
              {messages.map(msg => {
                const isMine = msg.senderId === user?.id;
                return (
                  <div key={msg.id} className={`flex ${isMine ? 'justify-end' : 'justify-start'}`}>
                    {!isMine && (
                      <div className="w-7 h-7 rounded-full bg-zinc-700 flex items-center justify-center shrink-0 mr-2 mt-1">
                        <User className="w-3.5 h-3.5 text-zinc-400" />
                      </div>
                    )}
                    <div
                      className={`max-w-xs lg:max-w-md xl:max-w-lg px-3 py-2 rounded-lg text-sm leading-relaxed ${
                        isMine
                          ? 'bg-emerald-600 text-white rounded-br-none'
                          : 'bg-zinc-800 text-zinc-200 rounded-bl-none'
                      }`}
                    >
                      {msg.content}
                      <p className={`text-[10px] mt-1 ${isMine ? 'text-emerald-200' : 'text-zinc-500'}`}>
                        {new Date(msg.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}
                      </p>
                    </div>
                  </div>
                );
              })}
              <div ref={endRef} />
            </div>

            {/* Input bar */}
            <div className="px-4 py-3 border-t border-zinc-800 flex items-end gap-2">
              <textarea
                id="message-input"
                rows={1}
                value={input}
                onChange={e => setInput(e.target.value)}
                onKeyDown={handleKeyDown}
                placeholder="Type a message… (Enter to send)"
                className="flex-1 bg-zinc-800 text-white text-sm rounded-lg px-3 py-2.5 resize-none outline-none border border-zinc-700 focus:border-emerald-600 transition-colors min-h-[40px] max-h-[120px]"
              />
              <button
                id="send-btn"
                onClick={handleSend}
                disabled={!input.trim() || sendingMsg}
                className="w-10 h-10 rounded-lg bg-emerald-600 hover:bg-emerald-500 disabled:opacity-40 disabled:cursor-not-allowed flex items-center justify-center transition-colors shrink-0"
              >
                <Send className="w-4 h-4 text-white" />
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
