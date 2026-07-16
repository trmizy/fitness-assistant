import { Request, Response, NextFunction } from "express";
import { conversationRepository } from "../repositories/conversation.repository";
import { formatSuccessResponse, formatErrorResponse } from "../errors/api-error";
import type { RenameSessionRequest, GetSessionsQuery } from "../schemas/session.schemas";

export const sessionController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { limit } = req.query as unknown as GetSessionsQuery;

    try {
      const sessions = await conversationRepository.findSessionsByUser(
        userId,
        limit,
      );
      res.json(formatSuccessResponse({ sessions }));
    } catch (err) {
      next(err);
    }
  },

  async getMessages(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { userId } = req.context;
    const { sessionId } = req.params;

    try {
      const session = await conversationRepository.findSessionById(sessionId);
      if (!session) {
        res
          .status(404)
          .json(
            formatErrorResponse(
              "SESSION_NOT_FOUND",
              `Session ${sessionId} not found`,
            ),
          );
        return;
      }
      if (session.userId !== userId) {
        res
          .status(403)
          .json(
            formatErrorResponse(
              "FORBIDDEN",
              "You do not have access to this session",
            ),
          );
        return;
      }
      const messages = await conversationRepository.findSessionMessages(
        userId,
        sessionId,
      );
      res.json(formatSuccessResponse({ session, messages }));
    } catch (err) {
      next(err);
    }
  },

  async rename(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { sessionId } = req.params;
    const { title } = req.body as RenameSessionRequest;

    try {
      const session = await conversationRepository.findSessionById(sessionId);
      if (!session) {
        res
          .status(404)
          .json(
            formatErrorResponse(
              "SESSION_NOT_FOUND",
              `Session ${sessionId} not found`,
            ),
          );
        return;
      }
      if (session.userId !== userId) {
        res
          .status(403)
          .json(
            formatErrorResponse(
              "FORBIDDEN",
              "You do not have access to this session",
            ),
          );
        return;
      }
      const updated = await conversationRepository.renameSession(
        sessionId,
        title,
      );
      res.json(formatSuccessResponse({ session: updated }));
    } catch (err) {
      next(err);
    }
  },

  async archive(
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> {
    const { userId } = req.context;
    const { sessionId } = req.params;

    try {
      const session = await conversationRepository.findSessionById(sessionId);
      if (!session) {
        res
          .status(404)
          .json(
            formatErrorResponse(
              "SESSION_NOT_FOUND",
              `Session ${sessionId} not found`,
            ),
          );
        return;
      }
      if (session.userId !== userId) {
        res
          .status(403)
          .json(
            formatErrorResponse(
              "FORBIDDEN",
              "You do not have access to this session",
            ),
          );
        return;
      }
      if (session.archivedAt) {
        res.json(
          formatSuccessResponse({ sessionId, archived: true, alreadyArchived: true }),
        );
        return;
      }
      await conversationRepository.archiveSession(sessionId);
      res.json(formatSuccessResponse({ sessionId, archived: true }));
    } catch (err) {
      next(err);
    }
  },
};
