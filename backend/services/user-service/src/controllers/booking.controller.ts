import { Response } from "express";
import { logger } from "@gym-coach/shared";
import { bookingService } from "../services/booking.service";

export const bookingController = {
  // Client books a session
  async bookSession(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      const { contractId, ...data } = req.body;
      const session = await bookingService.bookSession(
        clientUserId,
        contractId,
        data,
      );
      res.status(201).json(session);
    } catch (error: any) {
      logger.error(error, "Book session error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to book session" });
    }
  },

  // Get a single session by ID (used by chat-service call policy)
  async getSessionById(req: any, res: Response) {
    try {
      // x-user-id is set by gateway; req.user.id is set by auth middleware (direct calls)
      const userId = (req.headers["x-user-id"] as string) || req.user?.id;
      const session = await bookingService.getSessionById(
        req.params.id,
        userId,
      );
      res.json(session);
    } catch (error: any) {
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to get session" });
    }
  },

  // Get sessions for a contract
  async getContractSessions(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const sessions = await bookingService.getContractSessions(
        req.params.contractId,
        userId,
      );
      res.json(sessions);
    } catch (error: any) {
      logger.error(error, "Get contract sessions error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to fetch sessions" });
    }
  },

  // Get my upcoming sessions
  async getMyUpcoming(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const sessions = await bookingService.getMyUpcoming(userId);
      res.json(sessions);
    } catch (error: any) {
      logger.error(error, "Get upcoming sessions error");
      res.status(500).json({ error: "Failed to fetch upcoming sessions" });
    }
  },

  // PT confirms a session
  async confirmSession(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const session = await bookingService.confirmSession(
        req.params.id,
        ptUserId,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Confirm session error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to confirm session" });
    }
  },

  // PT completes a session
  async completeSession(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const { ptNotes } = req.body;
      const session = await bookingService.completeSession(
        req.params.id,
        ptUserId,
        ptNotes,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Complete session error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to complete session" });
    }
  },

  // Client confirms the session the PT reported (this is what consumes quota)
  async clientConfirmSession(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      const session = await bookingService.clientConfirmSession(
        req.params.id,
        clientUserId,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Client confirm session error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to confirm session" });
    }
  },

  // Client disputes what the PT reported — quota stays untouched
  async disputeSession(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      const { reason } = req.body ?? {};
      const session = await bookingService.disputeSession(
        req.params.id,
        clientUserId,
        reason,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Dispute session error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to dispute session" });
    }
  },

  // Money-flow plan 4.3 — client reports the PT never showed up
  async reportPtNoShow(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      const { reason } = req.body ?? {};
      const session = await bookingService.reportPtNoShow(
        req.params.id,
        clientUserId,
        reason,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Report PT no-show error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to report no-show" });
    }
  },

  // PT responds to a client's no-show report (AGREE settles it exactly like a PT
  // self-admitted no-show; DENY escalates to the same admin dispute flow as 4.2)
  async respondToNoShowReport(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const { response, note } = req.body ?? {};
      const session = await bookingService.respondToNoShowReport(
        req.params.id,
        ptUserId,
        response,
        note,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Respond to no-show report error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to respond to no-show report" });
    }
  },

  // Sessions where a client reported this PT as a no-show, awaiting the PT's response
  async listNoShowReportsForPT(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      res.json(await bookingService.listNoShowReportsForPT(ptUserId));
    } catch (error: any) {
      logger.error(error, "List no-show reports error");
      res.status(error.status || 500).json({ error: error.message });
    }
  },

  // Sessions this client still has to confirm or dispute
  async listPendingConfirmation(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      res.json(await bookingService.listPendingConfirmation(clientUserId));
    } catch (error: any) {
      logger.error(error, "List pending-confirmation sessions error");
      res.status(error.status || 500).json({ error: error.message });
    }
  },

  // ── Admin ──────────────────────────────────────────────────────────
  async listDisputed(_req: any, res: Response) {
    try {
      res.json(await bookingService.listDisputed());
    } catch (error: any) {
      logger.error(error, "List disputed sessions error");
      res.status(error.status || 500).json({ error: error.message });
    }
  },

  async resolveDispute(req: any, res: Response) {
    try {
      const adminId = req.headers["x-user-id"] as string;
      const { resolution, note } = req.body ?? {};
      const session = await bookingService.resolveDispute(
        req.params.id,
        adminId,
        resolution,
        note,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Resolve dispute error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to resolve dispute" });
    }
  },

  // Cancel session (either party)
  async cancelSession(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const { reason } = req.body;
      const session = await bookingService.cancelSession(
        req.params.id,
        userId,
        reason,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Cancel session error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to cancel session" });
    }
  },

  // PT marks no-show
  async markNoShow(req: any, res: Response) {
    try {
      const ptUserId = req.headers["x-user-id"] as string;
      const { noShowBy } = req.body;
      const session = await bookingService.markNoShow(
        req.params.id,
        ptUserId,
        noShowBy,
      );
      res.json(session);
    } catch (error: any) {
      logger.error(error, "Mark no-show error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to mark no-show" });
    }
  },

  // Join an online session (returns joinToken)
  async joinSession(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      if (!userId) return res.status(401).json({ error: "Unauthorized" });
      const result = await bookingService.joinSession(req.params.id, userId);
      return res.json(result);
    } catch (error: any) {
      logger.error(error, "Join session error");
      return res
        .status(error.status || 500)
        .json({ error: error.message || "Không thể tham gia buổi học" });
    }
  },

  // Client reviews a completed session
  async reviewSession(req: any, res: Response) {
    try {
      const clientUserId = req.headers["x-user-id"] as string;
      const { rating, comment } = req.body;
      const review = await bookingService.reviewSession(
        req.params.id,
        clientUserId,
        rating,
        comment,
      );
      res.status(201).json(review);
    } catch (error: any) {
      logger.error(error, "Review session error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to review session" });
    }
  },

  // ── Session Rescheduling ────────────────────────────────────────

  async requestReschedule(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const { proposedStartAt, proposedEndAt, reason } = req.body;
      const result = await bookingService.requestReschedule(
        req.params.id,
        userId,
        { proposedStartAt, proposedEndAt, reason }
      );
      res.json(result);
    } catch (error: any) {
      logger.error(error, "Request reschedule error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to request reschedule" });
    }
  },

  // VĐ4: the requester withdraws their own still-open proposal.
  async cancelReschedule(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const result = await bookingService.cancelRescheduleRequest(req.params.id, userId);
      res.json(result);
    } catch (error: any) {
      logger.error(error, "Cancel reschedule error");
      res.status(error.status || 500).json({ error: error.message || "Failed to cancel" });
    }
  },

  // VĐ4: every proposal ever made on a session — for dispute resolution.
  async rescheduleHistory(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const result = await bookingService.getRescheduleHistory(req.params.id, userId);
      res.json(result);
    } catch (error: any) {
      logger.error(error, "Reschedule history error");
      res.status(error.status || 500).json({ error: error.message || "Failed to load history" });
    }
  },

  async respondToReschedule(req: any, res: Response) {
    try {
      const userId = req.headers["x-user-id"] as string;
      const { action, responseNote } = req.body;
      const result = await bookingService.respondToReschedule(
        req.params.id,
        userId,
        action,
        responseNote
      );
      res.json(result);
    } catch (error: any) {
      logger.error(error, "Respond to reschedule error");
      res
        .status(error.status || 500)
        .json({ error: error.message || "Failed to respond to reschedule" });
    }
  },
};
