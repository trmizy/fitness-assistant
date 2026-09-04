import type { Server, Socket } from "socket.io";
import { CLIENT_EVENTS } from "../events";
import { dashboardRoom } from "../rooms";
import { getSocketUser } from "../socketAuth";

type DashboardPayload = {
  scope?: unknown;
};

function allowedDashboardScope(socket: Socket, requestedScope: unknown) {
  const user = getSocketUser(socket);
  const scope =
    typeof requestedScope === "string" && requestedScope.trim()
      ? requestedScope.trim()
      : user.role.toLowerCase();

  if (scope === "admin" && user.role !== "ADMIN") return null;
  if (scope === "trainer" && user.role !== "PT") return null;
  if (scope === "client" && user.role === "ADMIN") return null;

  return scope;
}

export function registerDashboardHandlers(_io: Server, socket: Socket) {
  socket.on(
    CLIENT_EVENTS.dashboardSubscribe,
    async (payload: DashboardPayload = {}) => {
      const scope = allowedDashboardScope(socket, payload.scope);
      if (!scope) return;
      await socket.join(dashboardRoom(scope));
    },
  );

  socket.on(
    CLIENT_EVENTS.dashboardUnsubscribe,
    async (payload: DashboardPayload = {}) => {
      const scope = allowedDashboardScope(socket, payload.scope);
      if (!scope) return;
      await socket.leave(dashboardRoom(scope));
    },
  );
}
