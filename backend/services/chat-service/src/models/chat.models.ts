import { z } from 'zod';

export const createDirectConversationSchema = z.object({
  targetUserId: z.string().uuid(),
});

export const sendMessageSchema = z.object({
  content: z.string().min(1).max(5000),
});

export const paginationSchema = z.object({
  page:  z.coerce.number().int().positive().default(1),
  limit: z.coerce.number().int().min(1).max(100).default(20),
});

export type CreateDirectConversationDto = z.infer<typeof createDirectConversationSchema>;
export type SendMessageDto             = z.infer<typeof sendMessageSchema>;
export type PaginationQuery            = z.infer<typeof paginationSchema>;
