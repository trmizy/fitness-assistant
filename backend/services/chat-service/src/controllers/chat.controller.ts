import { Response } from "express";
import { z } from "zod";
import { logger } from "@gym-coach/shared";
import { chatService, NOT_PARTICIPANT_MESSAGE } from "../services/chat.service";
import { chatRepository } from "../repositories/chat.repository";
import {
  createDirectConversationSchema,
  paginationSchema,
  sendMessageSchema,
} from "../models/chat.models";
import type { AuthRequest } from "../middleware/auth.middleware";

function extractToken(req: AuthRequest): string {
  return req.headers.authorization?.substring(7) ?? "";
}

export const chatController = {
  async createDirectConversation(
    req: AuthRequest,
    res: Response,
  ): Promise<void> {
    try {
      const { targetUserId } = createDirectConversationSchema.parse(req.body);
      const result = await chatService.createOrGetDirectConversation(
        req.user!.id,
        targetUserId,
        extractToken(req),
      );
      res.status(result.created ? 201 : 200).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error: error.errors[0]?.message || "Dữ liệu không hợp lệ",
            details: error.errors,
          });
        return;
      }
      logger.error(error, "Create conversation error");
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Lỗi máy chủ, vui lòng thử lại" });
    }
  },

  async listConversations(req: AuthRequest, res: Response): Promise<void> {
    try {
      const result = await chatService.listConversations(req.user!.id);
      res.json(result);
    } catch (error: any) {
      logger.error(error, "List conversations error");
      res.status(500).json({ error: "Lỗi máy chủ, vui lòng thử lại" });
    }
  },

  async getMessages(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { page, limit, before } = paginationSchema.parse(req.query);
      const result = await chatService.getMessages(
        req.params.id,
        req.user!.id,
        page,
        limit,
        before,
      );
      res.json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({ error: "Tham số phân trang không hợp lệ", details: error.errors });
        return;
      }
      logger.error(error, "Get messages error");
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Lỗi máy chủ, vui lòng thử lại" });
    }
  },

  async sendMessage(req: AuthRequest, res: Response): Promise<void> {
    try {
      const { content } = sendMessageSchema.parse(req.body);
      const result = await chatService.sendMessage(
        req.params.id,
        req.user!.id,
        content,
      );
      res.status(201).json(result);
    } catch (error: any) {
      if (error instanceof z.ZodError) {
        res
          .status(400)
          .json({
            error: error.errors[0]?.message || "Dữ liệu không hợp lệ",
            details: error.errors,
          });
        return;
      }
      logger.error(error, "Send message error");
      res
        .status(error.statusCode || 500)
        .json({ error: error.message || "Lỗi máy chủ, vui lòng thử lại" });
    }
  },

  // PATCH /chat/conversations/:id/read — only participants can mark-read.
  async markRead(req: AuthRequest, res: Response): Promise<void> {
    try {
      const userId = req.user?.id;
      if (!userId) {
        res.status(401).json({ error: "Phiên đăng nhập không hợp lệ" });
        return;
      }
      const conversationId = req.params.id;
      const allowed = await chatRepository.isUserParticipant(
        conversationId,
        userId,
      );
      if (!allowed) {
        res
          .status(403)
          .json({ error: NOT_PARTICIPANT_MESSAGE });
        return;
      }
      const updated = await chatRepository.markConversationRead(
        conversationId,
        userId,
      );
      res.json({ updated });
    } catch (error: any) {
      logger.error(error, "Mark-read error");
      res.status(500).json({ error: "Lỗi máy chủ, vui lòng thử lại" });
    }
  },
};
