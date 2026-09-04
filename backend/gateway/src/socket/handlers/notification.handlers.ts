import type { Server, Socket } from "socket.io";

export function registerNotificationHandlers(_io: Server, _socket: Socket) {
  // Notifications are emitted server-side through emitToUser(userId, "notification:new", payload).
  // There is intentionally no client subscription event: authenticated users are
  // automatically placed in their own user:{userId} room on connect.
}
