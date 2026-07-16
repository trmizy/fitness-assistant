import { z } from "zod";

export const RenameSessionRequestSchema = z.object({
  title: z
    .string({ required_error: "title is required" })
    .min(1, "title must not be empty")
    .max(200, "title must be at most 200 characters"),
});
export type RenameSessionRequest = z.infer<typeof RenameSessionRequestSchema>;

export const GetSessionsQuerySchema = z.object({
  limit: z
    .string()
    .regex(/^\d+$/, "limit must be a positive integer")
    .transform(Number)
    .refine((n) => n >= 1 && n <= 100, "limit must be between 1 and 100")
    .optional()
    .default("50"),
});
export type GetSessionsQuery = z.infer<typeof GetSessionsQuerySchema>;
