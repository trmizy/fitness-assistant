import { Request, Response, NextFunction } from "express";
import { conversationRepository } from "../repositories/conversation.repository";
import { formatSuccessResponse, formatErrorResponse } from "../errors/api-error";

export const memoryController = {
  async list(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;

    try {
      const memories = await conversationRepository.findMemoriesByUser(userId);
      res.json(formatSuccessResponse({ memories }));
    } catch (err) {
      next(err);
    }
  },

  async remove(req: Request, res: Response, next: NextFunction): Promise<void> {
    const { userId } = req.context;
    const { memoryId } = req.params;

    try {
      const memory = await conversationRepository.findMemoryById(memoryId);
      if (!memory) {
        res
          .status(404)
          .json(
            formatErrorResponse(
              "MEMORY_NOT_FOUND",
              `Memory ${memoryId} not found`,
            ),
          );
        return;
      }
      if (memory.userId !== userId) {
        res
          .status(403)
          .json(
            formatErrorResponse(
              "FORBIDDEN",
              "You do not have access to this memory",
            ),
          );
        return;
      }
      await conversationRepository.deleteUserMemory(memoryId);
      res.json(formatSuccessResponse({ memoryId, deleted: true }));
    } catch (err) {
      next(err);
    }
  },
};
