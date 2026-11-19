import type { Server as HttpServer } from "http";
import { Server } from "socket.io";
import { logger } from "@gym-coach/shared";
import { SERVER_EVENTS, type PresencePayload } from "./events";
import { roomsForUser, userRoom } from "./rooms";
import { getSocketUser, socketAuthMiddleware } from "./socketAuth";
import { registerChatHandlers } from "./handlers/chat.handlers";
import { registerAiHandlers } from "./handlers/ai.handlers";
import { registerDashboardHandlers } from "./handlers/dashboard.handlers";
import { registerNotificationHandlers } from "./handlers/notification.handlers";
import { isAllowedOrigin } from "../utils/corsOrigins";

let io: Server | null = null;

function emitPresence(userId: string, status: PresencePayload["status"]) {
  if (!io) return;
  io.emit(SERVER_EVENTS.userPresenceUpdate, {
    userId,
    status,
    updatedAt: new Date().toISOString(),
  } satisfies PresencePayload);
}

export function initializeSocketServer(server: HttpServer): Server {
  if (io) return io;

  io = new Server(server, {
    cors: {
      origin: (origin, callback) => {
        callback(null, isAllowedOrigin(origin));
      },
      credentials: true,
    },
    maxHttpBufferSize: 1_000_000,
    transports: ["websocket", "polling"],
  });

  io.use(socketAuthMiddleware);

  io.on("connection", async (socket) => {
    const user = getSocketUser(socket);

    await Promise.all(roomsForUser(user).map((room) => socket.join(room)));

    if (process.env.NODE_ENV !== "production") {
      logger.info({ userId: user.id, socketId: socket.id }, "Socket connected");
    }

    emitPresence(user.id, "online");
    registerNotificationHandlers(io!, socket);
    registerChatHandlers(io!, socket);
    registerAiHandlers(io!, socket);
    registerDashboardHandlers(io!, socket);

    socket.on("disconnect", () => {
      if (process.env.NODE_ENV !== "production") {
        logger.info(
          { userId: user.id, socketId: socket.id },
          "Socket disconnected",
        );
      }
      emitPresence(user.id, "offline");
    });
  });

  return io;
}

export function getSocketServer(): Server | null {
  return io;
}

/**
 * Cuts every live gateway socket of one user (all tabs/devices). Used when an admin locks the account:
 * a socket authenticates only at the handshake, so without this the locked user's already-open
 * connection would keep receiving chat messages and notifications. A reconnect re-runs the handshake,
 * which auth-service now refuses. Returns whether a socket server was there to ask.
 */
export function disconnectUserSockets(
  server: Pick<Server, "in"> | null,
  userId: string,
): boolean {
  if (!server) return false;
  server.in(userRoom(userId)).disconnectSockets(true);
  return true;
}

export function emitToUser<TPayload>(
  userId: string,
  event: string,
  payload: TPayload,
) {
  io?.to(userRoom(userId)).emit(event, payload);
}

export function emitToRoom<TPayload>(
  room: string,
  event: string,
  payload: TPayload,
) {
  io?.to(room).emit(event, payload);
}
