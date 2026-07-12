import axios from "axios";
import type { Socket } from "socket.io";
import { logger } from "@gym-coach/shared";
import type { SocketUser, SocketUserRole } from "./events";

const AUTH_SERVICE_URL =
  process.env.AUTH_SERVICE_URL || "http://localhost:3001";

type AuthVerifyResponse = {
  user?: {
    id?: string;
    email?: string;
    role?: SocketUserRole;
  };
};

function readSocketToken(socket: Socket): string | null {
  const authToken = socket.handshake.auth?.token;
  if (typeof authToken === "string" && authToken.trim()) {
    return authToken.trim();
  }

  const header = socket.handshake.headers.authorization;
  if (typeof header === "string" && header.startsWith("Bearer ")) {
    return header.slice("Bearer ".length).trim();
  }

  return null;
}

export function getSocketUser(socket: Socket): SocketUser {
  return socket.data.user as SocketUser;
}

export async function socketAuthMiddleware(
  socket: Socket,
  next: (err?: Error) => void,
) {
  const token = readSocketToken(socket);
  if (!token) {
    return next(new Error("UNAUTHORIZED"));
  }

  try {
    const { data } = await axios.post<AuthVerifyResponse>(
      `${AUTH_SERVICE_URL}/auth/verify`,
      {},
      {
        headers: { Authorization: `Bearer ${token}` },
        timeout: 5000,
      },
    );

    const user = data.user;
    if (!user?.id) {
      return next(new Error("UNAUTHORIZED"));
    }

    socket.data.user = {
      id: user.id,
      email: user.email,
      role: user.role || "CUSTOMER",
    } satisfies SocketUser;

    socket.data.authToken = token;
    return next();
  } catch (err) {
    logger.warn(
      { socketId: socket.id, message: err instanceof Error ? err.message : String(err) },
      "Socket auth failed",
    );
    return next(new Error("UNAUTHORIZED"));
  }
}
