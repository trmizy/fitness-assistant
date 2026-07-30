import { io, Socket } from "socket.io-client";

// Empty string tells socket.io-client to connect to the CURRENT page origin
// (its documented default-URL behavior) at the default "/socket.io" path —
// proxied by Vite in dev (see vite.config.ts) to the gateway's own
// Socket.IO server. This must NOT reuse API_URL's "/api" default: passing a
// bare path like "/api" as socket.io-client's server-URL argument is not
// the same thing as a same-origin connection and is not a supported input.
// Set VITE_SOCKET_URL to an absolute URL to bypass the proxy entirely.
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || "";

let socket: Socket | null = null;

function readAccessToken(): string | null {
  const token = localStorage.getItem("accessToken");
  return token && token !== "null" && token !== "undefined" ? token : null;
}

export function getSocket(): Socket {
  if (!socket) {
    socket = io(SOCKET_URL, {
      auth: (cb) => cb({ token: readAccessToken() }),
      autoConnect: false,
      reconnection: true,
      reconnectionAttempts: 8,
      reconnectionDelay: 800,
      reconnectionDelayMax: 5000,
      timeout: 8000,
      transports: ["websocket", "polling"],
    });
  }

  return socket;
}

export function connectSocket(): Socket {
  const current = getSocket();
  current.auth = { token: readAccessToken() };
  if (!current.connected && !current.active) {
    current.connect();
  }
  return current;
}

export function disconnectSocket() {
  socket?.disconnect();
}

export function resetSocket() {
  socket?.disconnect();
  socket = null;
}

export function getSocketUrl(): string {
  return SOCKET_URL;
}
