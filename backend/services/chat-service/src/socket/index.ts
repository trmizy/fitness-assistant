import http from 'http';
import { Server, Socket } from 'socket.io';
import axios from 'axios';
import { logger } from '@gym-coach/shared';
import { registerChatHandlers } from './chat.handler';

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

    // Track online presence
    if (!onlineUsers.has(user.id)) onlineUsers.set(user.id, new Set());
    onlineUsers.get(user.id)!.add(socket.id);
    socket.broadcast.emit('user:online', { userId: user.id });

    // Register event handlers, passing io so handlers can emit to rooms
    registerChatHandlers(io, socket, user);

    socket.on('disconnect', () => {
      const sockets = onlineUsers.get(user.id);
      if (sockets) {
        sockets.delete(socket.id);
        if (sockets.size === 0) {
          onlineUsers.delete(user.id);
          socket.broadcast.emit('user:offline', { userId: user.id });
        }
      }
      logger.info({ userId: user.id, socketId: socket.id }, 'Socket disconnected');
    });
  });

  logger.info('Socket.IO initialized');
  return io;
}
