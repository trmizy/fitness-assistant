import http from 'http';
import { Server, Socket } from 'socket.io';
import axios from 'axios';
import { logger, websocketConnectionsActive } from '@gym-coach/shared';
import { registerChatHandlers } from './chat.handler';
import { registerCallHandlers, graceTimers } from './call.handler';
import { callService } from '../services/call.service';

// Track online users: userId → Set of socket IDs (user may have multiple tabs)
export const onlineUsers = new Map<string, Set<string>>();

export function initSocket(httpServer: http.Server) {
  const io = new Server(httpServer, {
    cors: {
      origin: process.env.CORS_ORIGIN || 'http://localhost:5173',
      credentials: true,
    },
  });

  // ── JWT authentication ────────────────────────────────────────
  io.use(async (socket: Socket, next) => {
    try {
      const token = socket.handshake.auth?.token as string | undefined;
      if (!token) {
        return next(new Error('Authentication required'));
      }

      const authServiceUrl = process.env.AUTH_SERVICE_URL || 'http://localhost:3001';
      const { data } = await axios.post(
        `${authServiceUrl}/auth/verify`,
        {},
        { headers: { Authorization: `Bearer ${token}` }, timeout: 5000 },
      );

      (socket as any).user = data.user;
      next();
    } catch {
      next(new Error('Invalid token'));
    }
  });

  io.on('connection', (socket: Socket) => {
    const user = (socket as any).user as { id: string; email: string };
    logger.info({ userId: user.id, socketId: socket.id }, 'Socket connected');

    // Track metrics
    websocketConnectionsActive.inc();

    // Track online presence
    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
    onlineUsers.get(user.id)!.add(socket.id);

    // Auto-join personal room so user receives notifications for all their conversations
    socket.join(`user:${user.id}`);

    socket.broadcast.emit('user:online', { userId: user.id });

    // Register event handlers, passing io so handlers can emit to rooms
    registerChatHandlers(io, socket, user);
    registerCallHandlers(io, socket, user);

    // If user reconnects during a grace period, cancel the grace timer
    const existingGrace = graceTimers.get(user.id);
    if (existingGrace) {
      clearTimeout(existingGrace.timeout);
      graceTimers.delete(user.id);
      logger.info({ userId: user.id, callSessionId: existingGrace.callSessionId }, 'Grace timer cleared on reconnect');
    }

    socket.on('disconnect', () => {
      websocketConnectionsActive.dec();

      const sockets = onlineUsers.get(user.id);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(user.id);
          socket.broadcast.emit('user:offline', { userId: user.id });

          // Check if user was in an active call — start 30s grace period
          callService.findActiveCallForUser(user.id).then((activeCall) => {
            if (activeCall && (activeCall.status === 'ACTIVE' || activeCall.status === 'CONNECTING' || activeCall.status === 'ACCEPTED')) {
              const otherUserId = user.id === activeCall.callerId ? activeCall.calleeId : activeCall.callerId;

              const timeout = setTimeout(async () => {
                graceTimers.delete(user.id);
                // Grace period expired — end the call
                const ended = await callService.endCall(activeCall.id, user.id, 'disconnect_timeout');
                if (ended && 'call' in ended) {
                  io.to(`user:${otherUserId}`).emit('call:ended', {
                    callSessionId: activeCall.id,
                    endReason: 'disconnect_timeout',
                  });
                }
                logger.info({ userId: user.id, callSessionId: activeCall.id }, 'Call ended after grace period');
              }, 30_000);

              graceTimers.set(user.id, { callSessionId: activeCall.id, timeout });

              // Notify the other party about temporary disconnect
              io.to(`user:${otherUserId}`).emit('call:peer_disconnected', {
                callSessionId: activeCall.id,
                userId: user.id,
              });

              logger.info({ userId: user.id, callSessionId: activeCall.id }, 'Grace period started (30s)');
            }
          }).catch((err) => {
            logger.error(err, 'Error checking active call on disconnect');
          });
        }
      }
      logger.info({ userId: user.id, socketId: socket.id }, 'Socket disconnected');
    });
  });

  logger.info('Socket.IO initialized');
  return io;
}

