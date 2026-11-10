import { z } from "zod";

/** Longest chat message accepted, in characters. The web composer mirrors this number. */
export const CHAT_MESSAGE_MAX_LENGTH = 5000;

export const createDirectConversationSchema = z.object({
  targetUserId: z
    .string({ required_error: "Thiếu người nhận", invalid_type_error: "Người nhận không hợp lệ" })
    .uuid("Người nhận không hợp lệ"),
});

// `.trim()` runs before the length checks: a message of only spaces/newlines is "empty", and the
// stored text never carries leading/trailing blanks (the socket path already trimmed; REST did not).
export const sendMessageSchema = z.object({
  content: z
    .string({
      required_error: "Tin nhắn không được để trống",
      invalid_type_error: "Nội dung tin nhắn không hợp lệ",
    })
    .trim()
    .min(1, "Tin nhắn không được để trống")
    .max(
      CHAT_MESSAGE_MAX_LENGTH,
      `Tin nhắn quá dài (tối đa ${CHAT_MESSAGE_MAX_LENGTH.toLocaleString("vi-VN")} ký tự)`,
    ),
});

// Thread paging. Page 1 is the NEWEST `limit` messages, page 2 the `limit` before those, and so on;
// every page is returned oldest-first. `before` (a message id) is a cursor that stays correct while
// new messages arrive: it returns the `limit` messages older than that one and ignores `page`.
export const paginationSchema = z.object({
  page: z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
  before: z.string().uuid().optional(),
});

export type CreateDirectConversationDto = z.infer<
  typeof createDirectConversationSchema
>;
export type SendMessageDto = z.infer<typeof sendMessageSchema>;
export type PaginationQuery = z.infer<typeof paginationSchema>;
