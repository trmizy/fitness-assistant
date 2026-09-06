import axios from "axios";
import { Server, Socket } from "socket.io";
import { CallType, CallOrigin } from "@prisma/client";
import { logger } from "@gym-coach/shared";
import { callService } from "../services/call.service";
import { canInitiateCallFromChat } from "../services/call.policy";
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

// STUN alone only helps two peers on simple/compatible NATs find each other directly — it
// does nothing when either side is behind symmetric NAT (the default on most mobile carrier
// networks) or a restrictive firewall. Confirmed reproducing exactly that: a real phone
// (mobile data) calling a real laptop (a different home network) failed with "ice_failed"
// every time with STUN-only servers, even though signaling (initiate/accept) worked fine —
// TURN (a relay both sides CAN reach) is what's missing, not a signaling bug.
function staticIceServers(): any[] {
  const servers: any[] = [
    { urls: "stun:stun.l.google.com:19302" },
    { urls: "stun:stun1.l.google.com:19302" },
  ];
  // TURN_URL takes a comma-separated list (same convention as CORS_ORIGIN elsewhere) since a
  // real TURN deployment publishes several transports (UDP/TCP/TLS on different ports) for
  // reliability across different network restrictions — one URL is rarely enough in practice.
  // This is the fallback path — see getIceServers() below for the primary one.
  if (process.env.TURN_URL) {
    const urls = process.env.TURN_URL.split(",").map((u) => u.trim()).filter(Boolean);
    if (urls.length > 0) {
      servers.push({
        urls,
        username: process.env.TURN_USERNAME || "",
        credential: process.env.TURN_CREDENTIAL || "",
      });
    }
  }
  return servers;
}

const METERED_DOMAIN = process.env.METERED_DOMAIN;
const METERED_API_KEY = process.env.METERED_API_KEY;
// Metered issues time-limited TURN credentials (not a fixed username/password) valid for
// roughly 24h — refetching well before that (6h) means a credential handed to a client is
// never close to its own expiry mid-call, at the cost of one cheap HTTP call per 6h, not
// per call.
const METERED_CACHE_TTL_MS = 6 * 60 * 60 * 1000;
let meteredCache: { servers: any[]; fetchedAt: number } | null = null;

/**
 * Own (non-shared) TURN credentials from metered.ca, fetched fresh and cached — replaces the
 * Open Relay Project's free shared credentials, which are public/well-known and can be rate-
 * limited or exhausted by unrelated traffic with no way to tell from this side. Falls back to
 * the static TURN_URL/STUN-only servers (staticIceServers) if Metered isn't configured, the
 * fetch fails, or the response isn't the array of ICE servers it's documented to return — a
 * broken TURN fetch must never be the reason a call can't even try to connect.
 */
async function getIceServers(): Promise<any[]> {
  if (!METERED_DOMAIN || !METERED_API_KEY) return staticIceServers();

  if (meteredCache && Date.now() - meteredCache.fetchedAt < METERED_CACHE_TTL_MS) {
    return meteredCache.servers;
  }

  try {
    const { data } = await axios.get(
      `https://${METERED_DOMAIN}/api/v1/turn/credentials`,
      { params: { apiKey: METERED_API_KEY }, timeout: 5000 },
    );
    if (Array.isArray(data) && data.length > 0) {
      meteredCache = { servers: data, fetchedAt: Date.now() };
      return data;
    }
    logger.warn({ data }, "Metered TURN credentials response was not the expected array");
  } catch (error) {
    logger.error(error, "Failed to fetch Metered TURN credentials");
  }

  // A stale-but-still-plausible cached credential beats none at all if this fetch failed but
  // an earlier one (within the process's lifetime) succeeded.
  return meteredCache?.servers ?? staticIceServers();
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
            // DIAGNOSTIC (2026-09-05): the client-facing message is intentionally generic,
            // but that meant the ACTUAL reason (expired / user-mismatch / session-mismatch /
            // bad signature — see joinToken.ts's `reason`) was never logged anywhere,
            // making a real "can't join my own session" report unactionable from logs alone.
            logger.warn(
              {
                userId: user.id,
                coachingSessionId,
                calleeId,
                reason: check.reason,
              },
              "call:initiate rejected — invalid/expired join token",
            );
            socket.emit("call:error", {
              message: "Invalid or expired join token",
            });
            return;
          }
        }

        // Permission check. SESSION-linked calls already proved everything this would
        // re-check (identity, session membership, and that the window was open a moment
        // ago) via verifyJoinToken above — skipped here on purpose, not merely redundant
        // with it: canInitiateCallFromSession forwards `authToken`, which is
        // socket.handshake.auth.token captured ONCE at connect time and never refreshed
        // for the socket's whole lifetime. An open room is deliberately long-lived (up to
        // the room's own duration, "ra vào tự do" — leave and rejoin freely) — every rejoin
        // after the user's ~15-minute access token has since expired would otherwise fail
        // this check with a stale-token 401 ("Failed to verify session"), even though the
        // join token used above was minted seconds earlier by the very same REST call that
        // re-validates the room's window every time. The only case this stops catching is a
        // room closing in the last few minutes of a joinToken's own 10-minute lifetime —
        // narrower and far less harmful than legitimately joined users being locked out of
        // their own already-open room.
        if (origin !== "SESSION") {
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

        // Open-room redesign: a SESSION call has no "ring" at all — either side may arrive
        // first and simply waits in the room for the other, for as long as the room's own
        // window (already enforced by joinSession/verifyJoinToken before this point) stays
        // open. The offline-callee-is-a-missed-call and 30s-ring-timeout rules below exist
        // ONLY to model a real phone-style ring, which a CHAT call still is.
        if (!isSessionCall) {
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

        // Session-linked: a room for this coaching session already exists (either the other
        // party is waiting inside it, or this is the SAME person rejoining after a earlier
        // leave/disconnect — the row is never ended just because one side stepped out, see
        // call:leave_room below). `isCaller` tells the client which role it plays on THIS
        // row — fixed for the row's whole lifetime, since call:offer/call:answer are only
        // ever relayed caller→callee / callee→caller, never the other way, even on a rejoin.
        if ("existingCall" in result && result.existingCall) {
          const existing = result.existingCall;
          const isCaller = user.id === existing.callerId;
          socket.emit("call:existing", {
            callSessionId: existing.id,
            status: existing.status,
            iceServers: await getIceServers(),
            isCaller,
          });
          // The rejoining/joining party is the CALLEE — only the CALLER may ever send an
          // offer, so the still-present (or previously-present) caller needs an explicit
          // nudge to (re)negotiate; they have no other way to learn this arrival happened.
          if (!isCaller) {
            io.to(`user:${existing.callerId}`).emit("call:peer_rejoined", {
              callSessionId: existing.id,
            });
          }
          logger.info(
            { callSessionId: existing.id, userId: user.id, isCaller },
            "Session room (re)joined — existing call row reused",
          );
          return;
        }

        const call = result.call!;
        const iceServers = await getIceServers();

        if (!isSessionCall) {
          // Notify callee (all tabs via user room) — a genuine ring, CHAT-origin only.
          io.to(`user:${calleeId}`).emit("call:incoming", {
            callSessionId: call.id,
            callerId: user.id,
            callerName: user.email,
            callType: call.callType,
            origin: call.origin,
            conversationId: call.conversationId,
            iceServers,
          });
        }

        // Confirm to caller. For a SESSION call this is the FIRST person in the room — they
        // are always this row's caller (isCaller: true), and simply wait; nothing is sent to
        // the other party at all (no ring — they'll see the room whenever they open it
        // themselves, same as walking into an empty, already-open Meet/Teams meeting).
        socket.emit("call:initiated", {
          callSessionId: call.id,
          iceServers,
          isCaller: true,
        });

        if (!isSessionCall) {
          // 30s ring timeout — CHAT-origin only; a SESSION room has no timeout of its own
          // here, its ENTIRE lifetime is bounded by the room window enforced above instead.
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
        }

        logger.info(
          { callSessionId: call.id, callerId: user.id, calleeId, isSessionCall },
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
        const iceServers = await getIceServers();

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

  // ── Leave an open-room session (without ending it for the other party) ──
  // The SESSION-call counterpart to call:end/call:cancel: unlike a CHAT call, one side
  // stepping out of an open room must never end it for whoever's left — they may still be
  // there, or may join later, right up until the room's own window closes (settled entirely
  // by user-service's room-close-resolution sweep, not by anything here). No DB status
  // change at all: the row stays exactly as it was, so a later rejoin finds the SAME
  // "existingCall" and reconnects into it rather than starting a fresh one.
  socket.on(
    "call:leave_room",
    async ({ callSessionId }: { callSessionId: string }) => {
      try {
        const call = await callService.findById(callSessionId);
        if (!call || !isCallParticipant(user.id, call)) return;
        if (call.origin !== CallOrigin.SESSION) return;

        const otherUserId =
          user.id === call.callerId ? call.calleeId : call.callerId;
        io.to(`user:${otherUserId}`).emit("call:peer_left_room", {
          callSessionId,
          userId: user.id,
        });

        logger.info({ callSessionId, leftBy: user.id }, "Left open-room session (room stays open)");
      } catch (error) {
        logger.error(error, "call:leave_room error");
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
