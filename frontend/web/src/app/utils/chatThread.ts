/**
 * Pure helpers behind the web chat thread (ChatPage + useRealtimeChat): message-length rules, merging
 * message lists, what to call a conversation partner, and the Vietnamese text of a failed send.
 * Kept free of React so it runs under `node --test`.
 */

/** Same ceiling as chat-service's sendMessageSchema. */
export const CHAT_MESSAGE_MAX_LENGTH = 5000;
/** The counter only appears once the draft is this close to the limit. */
export const CHAT_COUNTER_FROM = 4500;
/** How many messages one page of a thread holds (newest first, then "Xem tin cũ hơn"). */
export const CHAT_PAGE_SIZE = 30;

export type ChatDraftCheck = {
  ok: boolean;
  text: string;
  length: number;
  showCounter: boolean;
  error: string | null;
};

/** The draft as it would be sent (trimmed). `error` is shown to the user; null means "just empty, nothing to say". */
export function checkChatDraft(draft: string): ChatDraftCheck {
  const text = draft.trim();
  const length = text.length;
  const showCounter = length >= CHAT_COUNTER_FROM;
  if (length === 0) return { ok: false, text, length, showCounter, error: null };
  if (length > CHAT_MESSAGE_MAX_LENGTH) {
    return {
      ok: false,
      text,
      length,
      showCounter: true,
      error: `Tin nhắn quá dài, tối đa ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString("vi-VN")} ký tự (đang ${length.toLocaleString("vi-VN")}). Hãy rút gọn hoặc chia thành nhiều tin.`,
    };
  }
  return { ok: true, text, length, showCounter, error: null };
}

export type ThreadMessage = { id: string; createdAt: string; [key: string]: unknown };

const time = (m: ThreadMessage) => {
  const t = Date.parse(m.createdAt);
  return Number.isNaN(t) ? 0 : t;
};

/** Union of message lists by id, oldest first. A later list wins for the same id. */
export function mergeMessages<T extends ThreadMessage>(...lists: Array<readonly T[] | undefined>): T[] {
  const byId = new Map<string, T>();
  for (const list of lists) for (const m of list ?? []) if (m?.id) byId.set(m.id, m);
  return Array.from(byId.values()).sort((a, b) => time(a) - time(b));
}

type Partner = { firstName?: string | null; lastName?: string | null; role?: string | null } | null | undefined;

/** Label for the partner's role. Unknown roles get a neutral word, never a wrong one ("Học viên" for an owner). */
export function chatRoleLabel(role: string | null | undefined): string {
  switch (role) {
    case "PT":
      return "Huấn luyện viên";
    case "CUSTOMER":
      return "Học viên";
    case "GYM_OWNER":
      return "Chủ phòng tập";
    case "ADMIN":
      return "Quản trị viên";
    default:
      return "Thành viên";
  }
}

/** The partner's name, or their role when the account has no name (a gym owner signed up without one). */
export function chatPartnerName(partner: Partner): string {
  const full = [partner?.firstName, partner?.lastName]
    .map((part) => (part ?? "").trim())
    .filter(Boolean)
    .join(" ");
  if (full) return full;
  return partner?.role ? chatRoleLabel(partner.role) : "Người dùng";
}

export function chatPartnerInitial(partner: Partner): string {
  return chatPartnerName(partner).charAt(0).toLocaleUpperCase("vi-VN") || "U";
}

const HAS_VIETNAMESE = /[ăâđêôơưáàảãạấầẩẫậắằẳẵặéèẻẽẹếềểễệíìỉĩịóòỏõọốồổỗộớờởỡợúùủũụứừửữựýỳỷỹỵ]/i;

/**
 * What to tell the user when a send failed. The server's own sentence is used when it is already Vietnamese
 * (locked recipient, message too long); otherwise the HTTP status decides.
 */
export function chatSendErrorText(err: unknown): string {
  const e = err as { response?: { status?: number; data?: { error?: unknown } }; code?: string } | undefined;
  const serverText = e?.response?.data?.error;
  if (typeof serverText === "string" && HAS_VIETNAMESE.test(serverText)) return serverText;
  const status = e?.response?.status;
  if (status === 413) return `Tin nhắn quá dài, tối đa ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString("vi-VN")} ký tự.`;
  if (status === 401) return "Phiên đăng nhập đã hết hạn. Hãy đăng nhập lại rồi gửi lại.";
  if (status === 403) return "Bạn không gửi được tin nhắn trong cuộc trò chuyện này.";
  if (status === 429) return "Bạn gửi quá nhanh. Đợi một chút rồi thử lại.";
  if (status && status >= 500) return "Máy chủ đang bận. Tin nhắn chưa được gửi, hãy thử lại.";
  return "Chưa gửi được tin nhắn. Kiểm tra kết nối rồi thử lại.";
}
