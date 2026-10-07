/**
 * SH-04 / CL-21 — pure parts of "Trò chuyện" (web's ChatPage + useRealtimeChat).
 *
 * The chat-service answers `GET /chat/conversations` and `.../messages` as bare arrays (checked
 * 22/9); an `{ data: [...] }` envelope is accepted too so a gateway change cannot blank the list.
 * No unread count, avatar or presence exists server-side, so none is drawn (the design shows
 * them with mock data).
 */
import type { RealtimeChatMessage } from "../../realtime/events";

export type Conversation = {
  id: string;
  otherUser: { id: string; firstName?: string | null; lastName?: string | null; role?: string | null } | null;
  lastMessage: { content: string; createdAt: string } | null;
  lastMessageAt: string | null;
};

export type ChatMessage = {
  id: string;
  authorId: string;
  content: string;
  createdAt: string;
  conversationId: string;
};

function asArray(raw: unknown): any[] {
  if (Array.isArray(raw)) return raw;
  const d = (raw as any)?.data;
  if (Array.isArray(d)) return d;
  if (Array.isArray(d?.items)) return d.items;
  return [];
}

export function normalizeConversations(raw: unknown): Conversation[] {
  return asArray(raw)
    .filter((c) => c && typeof c.id === "string")
    .map((c) => ({
      id: c.id,
      otherUser: c.otherUser ?? null,
      lastMessage: c.lastMessage ?? null,
      lastMessageAt: c.lastMessageAt ?? c.lastMessage?.createdAt ?? null,
    }))
    .sort((a, b) => Date.parse(b.lastMessageAt ?? "") - Date.parse(a.lastMessageAt ?? "") || 0);
}

export function normalizeMessage(m: RealtimeChatMessage | any): ChatMessage {
  return {
    id: String(m.id),
    authorId: String(m.authorId ?? m.senderId ?? ""),
    content: String(m.content ?? ""),
    createdAt: String(m.createdAt ?? new Date().toISOString()),
    conversationId: String(m.conversationId ?? ""),
  };
}

export function normalizeMessages(raw: unknown): ChatMessage[] {
  return asArray(raw)
    .map(normalizeMessage)
    .sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

/** Append a pushed message once — the gateway emits it on two event names and to the sender too. */
export function mergeMessage(list: ChatMessage[] | undefined, m: ChatMessage): ChatMessage[] {
  const cur = list ?? [];
  if (cur.some((x) => x.id === m.id)) return cur;
  return [...cur, m].sort((a, b) => Date.parse(a.createdAt) - Date.parse(b.createdAt));
}

export function peerName(c: Conversation | null | undefined): string {
  const u = c?.otherUser;
  const name = [u?.firstName, u?.lastName].filter(Boolean).join(" ").trim();
  return name || "Người dùng";
}

export function peerRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case "PT":
      return "Huấn luyện viên";
    case "GYM_OWNER":
      return "Phòng gym";
    case "ADMIN":
      return "Quản trị Gymini";
    default:
      return "Học viên";
  }
}

export function isSystemMessage(m: ChatMessage): boolean {
  return m.authorId === "system";
}

/** The server prefixes call-log lines with 📞 (web's only icon for them); the app draws its own icon. */
export function systemMessageText(content: string): string {
  return content.replace(/^📞\s*/u, "");
}

/** "09:16" today, "Hôm qua", "3 ngày" within a week, else dd/mm — the design's thread timestamps. */
export function threadTime(iso: string | null | undefined, now = new Date()): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const days = Math.round((startOf(now) - startOf(d)) / 86_400_000);
  if (days <= 0) return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
  if (days === 1) return "Hôm qua";
  if (days < 7) return `${days} ngày`;
  return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}`;
}

export function messageTime(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/** A divider label when the calendar day changes between two messages. */
export function dayDivider(prev: ChatMessage | undefined, cur: ChatMessage, now = new Date()): string | null {
  const dc = new Date(cur.createdAt);
  if (prev) {
    const dp = new Date(prev.createdAt);
    if (dp.toDateString() === dc.toDateString()) return null;
  }
  if (dc.toDateString() === now.toDateString()) return "Hôm nay";
  const y = new Date(now);
  y.setDate(now.getDate() - 1);
  if (dc.toDateString() === y.toDateString()) return "Hôm qua";
  return `${String(dc.getDate()).padStart(2, "0")}/${String(dc.getMonth() + 1).padStart(2, "0")}/${dc.getFullYear()}`;
}

// Same cap as chat-service's sendMessageSchema (content: z.string().min(1).max(5000)).
export const MAX_MESSAGE_LENGTH = 5000;

export function canSend(text: string): boolean {
  const t = text.trim();
  return t.length > 0 && t.length <= MAX_MESSAGE_LENGTH;
}

/** The conversation id out of `POST /chat/conversations/direct` (`{ id, conversation }`). */
export function conversationIdOf(reply: any): string | null {
  const id = reply?.id ?? reply?.conversation?.id ?? reply?.data?.id;
  return typeof id === "string" && id ? id : null;
}
