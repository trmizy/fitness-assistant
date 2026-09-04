import { Server, Socket } from "socket.io";
import { CallType, CallOrigin } from "@prisma/client";
import { logger } from "@gym-coach/shared";
import { callService } from "../services/call.service";
import {
  canInitiateCallFromChat,
  canInitiateCallFromSession,
} from "../services/call.policy";
import { verifyJoinToken } from "../utils/joinToken";
import { onlineUsers } from "./index";
import { chatRepository } from "../repositories/chat.repository";

// Track ring timeouts: callSessionId → timeout handle
const ringTimeouts = new Map<string, NodeJS.Timeout>();

// Track reconnect grace timers: userId → { callSessionId, timeout }
export const graceTimers = new Map<
  string,
  { callSessionId: string; timeout: NodeJS.Timeout }
>();

function getIceServers() {
  const servers: any[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  if (process.env.TURN_URL) {
    servers.push({
      urls: process.env.TURN_URL,
      username: process.env.TURN_USERNAME || "",
      credential: process.env.TURN_CREDENTIAL || "",
    });
  }
  return servers;
}

function clearRingTimeout(callSessionId: string) {
  const t = ringTimeouts.get(callSessionId);
  if (t) {
    clearTimeout(t);
    ringTimeouts.delete(callSessionId);
  }
}

/**
 * True only for the two real participants of a call. Shared by every
 * signaling-relay event (ice_candidate, media_toggle, ...) so the check
 * lives in exactly one place — see the regression this fixed: computing
 * `targetId` via `user.id === call.callerId ? call.calleeId : call.callerId`
 * with no membership check first falsely resolves to `call.callerId` for
 * ANY third party too (since "not the caller" is also true for someone who
 * isn't the callee), letting an unrelated authenticated user inject fake
 * signaling into someone else's active call just by guessing/knowing its
 * callSessionId.
 */
export function isCallParticipant(
  userId: string,
  call: { callerId: string; calleeId: string },
): boolean {
  return userId === call.callerId || userId === call.calleeId;
}

async function emitCallLogMessage(io: Server, call: any, isMissed: boolean = false) {
  if (!call.conversationId || call.origin !== CallOrigin.CHAT) return;
  try {
    let content = "";
    if (isMissed) {
      content = `📞 Missed ${call.callType === 'VIDEO' ? 'video' : 'voice'} call`;
    } else {
      const durationMs = call.startedAt && call.endedAt ? call.endedAt.getTime() - call.startedAt.getTime() : 0;
      const durationMins = Math.floor(durationMs / 60000);
      const durationSecs = Math.floor((durationMs % 60000) / 1000);
      const timeStr = `${durationMins}:${durationSecs.toString().padStart(2, '0')}`;
      content = `📞 ${call.callType === 'VIDEO' ? 'Video' : 'Voice'} call ended (${timeStr})`;
    }
    const msg = await chatRepository.createMessage(call.conversationId, "system", content);
    
    // Map senderId → authorId for frontend
    const payload = {
      id: msg.id,
      authorId: msg.senderId,
      content: msg.content,
      createdAt: msg.createdAt,
      conversationId: msg.conversationId,
    };
    io.to(`user:${call.callerId}`).emit("chat:message", payload);
    io.to(`user:${call.calleeId}`).emit("chat:message", payload);
  } catch (err) {
    logger.error(err, "Failed to emit call log message");
  }
}

export function registerCallHandlers(
  io: Server,
  socket: Socket,
  user: { id: string; email: string },
) {
  const authToken = socket.handshake.auth?.token as string;

  // ── Initiate a call ──────────────────────────────────────────
  socket.on(
    "call:initiate",
    async (payload: {
      calleeId: string;
      callType: string;
      conversationId?: string;
      origin?: string;
      coachingSessionId?: string;
      joinToken?: string;
    }) => {
      try {
        const {
          calleeId,
          callType,
          conversationId,
          origin,
          coachingSessionId,
          joinToken,
        } = payload;

        const isSessionCall = origin === "SESSION" && coachingSessionId;
        if (!calleeId || !callType || (!conversationId && !isSessionCall)) {
          socket.emit("call:error", { message: "Missing required fields" });
          return;
        }

        // Verify join token for session calls
        if (isSessionCall) {
          if (!joinToken) {
            socket.emit("call:error", {
              message: "Join token required for session calls",
            });
            return;
          }
          const check = verifyJoinToken(
            joinToken,
            user.id,
            coachingSessionId!,
            calleeId,
          );
          if (!check.valid) {
            socket.emit("call:error", {
              message: "Invalid or expired join token",
            });
            return;
          }
        }

        // Permission check
        if (origin === "SESSION" && coachingSessionId) {
          const perm = await canInitiateCallFromSession(
            user.id,
            coachingSessionId,
            authToken,
          );
          if (!perm.allowed) {
            socket.emit("call:error", {
              message: perm.reason || "Not allowed",
            });
            return;
          }
        } else {
          const perm = await canInitiateCallFromChat(
            user.id,
            calleeId,
            conversationId!,
            authToken,
          );
          if (!perm.allowed) {
            socket.emit("call:error", {
              message: perm.reason || "Not allowed",
            });
            return;
          }
        }

        // Check if callee is online
        if (!onlineUsers.has(calleeId)) {
          // Create call as MISSED immediately
          const result = await callService.initiateCall({
            conversationId: conversationId || undefined,
            callerId: user.id,
            calleeId,
            callType: callType as CallType,
            origin: (origin as CallOrigin) || CallOrigin.CHAT,
            coachingSessionId,
          });
          if ("call" in result && result.call) {
            await callService.markMissed(result.call.id);
          }
          socket.emit("call:missed", {
            callSessionId: result && "call" in result ? result.call?.id : null,
          });
          return;
        }

        const result = await callService.initiateCall({
          conversationId: conversationId || undefined,
          callerId: user.id,
          calleeId,
          callType: callType as CallType,
          origin: (origin as CallOrigin) || CallOrigin.CHAT,
          coachingSessionId,
        });

        if ("error" in result) {
          socket.emit("call:error", { message: result.error });
          return;
        }

        // Session-linked: existing call found, auto-join
        if ("existingCall" in result && result.existingCall) {
          socket.emit("call:existing", {
            callSessionId: result.existingCall.id,
            status: result.existingCall.status,
            iceServers: getIceServers(),
          });
          return;
        }

        const call = result.call!;
        const iceServers = getIceServers();

        // Notify callee (all tabs via user room)
        io.to(`user:${calleeId}`).emit("call:incoming", {
          callSessionId: call.id,
          callerId: user.id,
          callerName: user.email,
          callType: call.callType,
          origin: call.origin,
          conversationId: call.conversationId,
          iceServers,
        });

        // Confirm to caller
        socket.emit("call:initiated", {
          callSessionId: call.id,
          iceServers,
        });

        // 30s ring timeout
        const timeout = setTimeout(async () => {
          ringTimeouts.delete(call.id);
          const missed = await callService.markMissed(call.id);
          if (missed) {
            io.to(`user:${user.id}`).emit("call:missed", {
              callSessionId: call.id,
            });
            io.to(`user:${calleeId}`).emit("call:missed", {
              callSessionId: call.id,
            });
            await emitCallLogMessage(io, missed, true);
          }
        }, 30_000);
        ringTimeouts.set(call.id, timeout);

        logger.info(
          { callSessionId: call.id, callerId: user.id, calleeId },
          "Call initiated",
        );
      } catch (error) {
        logger.error(error, "call:initiate error");
        socket.emit("call:error", { message: "Failed to initiate call" });
      }
    },
  );

  // ── Accept a call ────────────────────────────────────────────
  socket.on(
    "call:accept",
    async ({ callSessionId }: { callSessionId: string }) => {
      try {
        const result = await callService.acceptCall(callSessionId, user.id);
        if ("error" in result) {
          if (result.alreadyHandled) {
            // Multi-tab: this tab lost the race
            socket.emit("call:accepted_elsewhere", { callSessionId });
          } else {
            socket.emit("call:error", { message: result.error });
          }
          return;
        }

        clearRingTimeout(callSessionId);
        const call = result.call!;
        const iceServers = getIceServers();

        // Notify caller
        io.to(`user:${call.callerId}`).emit("call:accepted", {
          callSessionId,
          iceServers,
        });

        // Notify other callee sockets (multi-tab: dismiss incoming modal)
        const calleeSockets = onlineUsers.get(user.id);
        if (calleeSockets) {
          for (const sid of calleeSockets) {
            if (sid !== socket.id) {
              io.to(sid).emit("call:accepted_elsewhere", { callSessionId });
            }
          }
        }

        logger.info({ callSessionId, acceptedBy: user.id }, "Call accepted");
      } catch (error) {
        logger.error(error, "call:accept error");
        socket.emit("call:error", { message: "Failed to accept call" });
      }
    },
  );

  // ── Reject a call ────────────────────────────────────────────
  socket.on(
    "call:reject",
    async ({ callSessionId }: { callSessionId: string }) => {
      try {
        const result = await callService.rejectCall(callSessionId, user.id);
        if ("error" in result) {
          socket.emit("call:error", { message: result.error });
          return;
        }

        clearRingTimeout(callSessionId);
        const call = result.call!;

        io.to(`user:${call.callerId}`).emit("call:rejected", { callSessionId });
        await emitCallLogMessage(io, call, true);

        logger.info({ callSessionId, rejectedBy: user.id }, "Call rejected");
      } catch (error) {
        logger.error(error, "call:reject error");
        socket.emit("call:error", { message: "Failed to reject call" });
      }
    },
  );

  // ── Cancel a call (caller hangs up before answer) ────────────
  socket.on(
    "call:cancel",
    async ({ callSessionId }: { callSessionId: string }) => {
      try {
        const result = await callService.cancelCall(callSessionId, user.id);
        if ("error" in result) {
          socket.emit("call:error", { message: result.error });
          return;
        }

        clearRingTimeout(callSessionId);
        const call = result.call!;

        io.to(`user:${call.calleeId}`).emit("call:cancelled", {
          callSessionId,
        });

        logger.info({ callSessionId, cancelledBy: user.id }, "Call cancelled");
      } catch (error) {
        logger.error(error, "call:cancel error");
        socket.emit("call:error", { message: "Failed to cancel call" });
      }
    },
  );

  // ── SDP Offer (caller → callee) ─────────────────────────────
  socket.on(
    "call:offer",
    async ({ callSessionId, sdp }: { callSessionId: string; sdp: any }) => {
      try {
        const call = await callService.findById(callSessionId);
        if (!call || call.callerId !== user.id) return;

        await callService.setConnecting(callSessionId);
        io.to(`user:${call.calleeId}`).emit("call:offer", {
          callSessionId,
          sdp,
        });
      } catch (error) {
        logger.error(error, "call:offer error");
      }
    },
  );

  // ── SDP Answer (callee → caller) ────────────────────────────
  socket.on(
    "call:answer",
    async ({ callSessionId, sdp }: { callSessionId: string; sdp: any }) => {
      try {
        const call = await callService.findById(callSessionId);
        if (!call || call.calleeId !== user.id) return;

        io.to(`user:${call.callerId}`).emit("call:answer", {
          callSessionId,
          sdp,
        });
      } catch (error) {
        logger.error(error, "call:answer error");
      }
    },
  );

  // ── ICE Candidate relay ──────────────────────────────────────
  socket.on(
    "call:ice_candidate",
    async ({
      callSessionId,
      candidate,
    }: {
      callSessionId: string;
      candidate: any;
    }) => {
      try {
        const call = await callService.findById(callSessionId);
        if (!call || !isCallParticipant(user.id, call)) return;

        const targetId =
          user.id === call.callerId ? call.calleeId : call.callerId;
        io.to(`user:${targetId}`).emit("call:ice_candidate", {
          callSessionId,
          candidate,
        });
      } catch (error) {
        logger.error(error, "call:ice_candidate error");
      }
    },
  );

  // ── End call (hangup) ────────────────────────────────────────
  socket.on(
    "call:end",
    async ({
      callSessionId,
      reason,
    }: {
      callSessionId: string;
      reason?: string;
    }) => {
      try {
        const result = await callService.endCall(
          callSessionId,
          user.id,
          reason,
        );
        if ("error" in result) {
          socket.emit("call:error", { message: result.error });
          return;
        }

        const call = result.call!;
        const otherUserId =
          user.id === call.callerId ? call.calleeId : call.callerId;

        io.to(`user:${otherUserId}`).emit("call:ended", {
          callSessionId,
          endReason: reason || "hangup",
        });
        await emitCallLogMessage(io, call, false);

        logger.info({ callSessionId, endedBy: user.id, reason }, "Call ended");
      } catch (error) {
        logger.error(error, "call:end error");
        socket.emit("call:error", { message: "Failed to end call" });
      }
    },
  );

  // ── Media toggle (mute/camera) ───────────────────────────────
  socket.on(
    "call:media_toggle",
    async ({
      callSessionId,
      kind,
      enabled,
    }: {
      callSessionId: string;
      kind: "audio" | "video";
      enabled: boolean;
    }) => {
      try {
        const call = await callService.findById(callSessionId);
        if (!call || !isCallParticipant(user.id, call)) return;

        const targetId =
          user.id === call.callerId ? call.calleeId : call.callerId;
        io.to(`user:${targetId}`).emit("call:media_toggled", {
          callSessionId,
          userId: user.id,
          kind,
          enabled,
        });
      } catch (error) {
        logger.error(error, "call:media_toggle error");
      }
    },
  );

  // ── Rejoin after disconnect (grace period) ───────────────────
  socket.on(
    "call:rejoin",
    async ({ callSessionId }: { callSessionId: string }) => {
      try {
        const grace = graceTimers.get(user.id);
        if (grace && grace.callSessionId === callSessionId) {
          clearTimeout(grace.timeout);
          graceTimers.delete(user.id);
          logger.info(
            { callSessionId, userId: user.id },
            "Call rejoined within grace period",
          );

          // Notify the other party that user reconnected
          const call = await callService.findById(callSessionId);
          if (call) {
            const otherUserId =
              user.id === call.callerId ? call.calleeId : call.callerId;
            io.to(`user:${otherUserId}`).emit("call:peer_reconnected", {
              callSessionId,
            });
          }
        } else {
          socket.emit("call:error", {
            message: "No active grace period for this call",
          });
        }
      } catch (error) {
        logger.error(error, "call:rejoin error");
      }
    },
  );
}
