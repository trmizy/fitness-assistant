import { z } from 'zod';

export const AskRequestSchema = z.object({
  question: z
    .string({ required_error: 'question is required' })
    .min(1, 'question must not be empty')
    .max(2000, 'question must be at most 2000 characters'),
});
export type AskRequest = z.infer<typeof AskRequestSchema>;

export const FeedbackRequestSchema = z.object({
  conversationId: z
    .string({ required_error: 'conversationId is required' })
    .uuid('conversationId must be a valid UUID'),
  feedback: z
    .number({ required_error: 'feedback is required' })
    .refine((v) => v === 1 || v === -1, { message: 'feedback must be 1 (thumbs up) or -1 (thumbs down)' }),
});
export type FeedbackRequest = z.infer<typeof FeedbackRequestSchema>;

export const GenerateWorkoutRequestSchema = z.object({
  goal: z
    .string()
    .min(1, 'goal must not be empty')
    .max(200)
    .optional()
    .default('general fitness'),
  duration: z
    .number()
    .int()
    .min(10, 'duration must be at least 10 minutes')
    .max(300, 'duration must be at most 300 minutes')
    .optional()
    .default(60),
  equipment: z
    .array(z.string().min(1).max(100))
    .max(20)
    .optional()
    .default([]),
  bodyParts: z
    .array(z.string().min(1).max(100))
    .max(20)
    .optional()
    .default([]),
});
export type GenerateWorkoutRequest = z.infer<typeof GenerateWorkoutRequestSchema>;

export const GetConversationsQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/, 'limit must be a positive integer')
    .transform(Number)
    .refine((n) => n >= 1 && n <= 100, 'limit must be between 1 and 100')
    .optional()
    .default('10'),
});
export type GetConversationsQuery = z.infer<typeof GetConversationsQuerySchema>;
