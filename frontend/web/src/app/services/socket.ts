import { io, Socket } from "socket.io-client";

// Empty string = same-origin (current page), proxied by Vite in dev under
// "/chat-socket.io" (see vite.config.ts) to chat-service's real
// "/socket.io" path — a distinct proxy path is needed because chat-service
// runs a SEPARATE Socket.IO server from the gateway's, and both default to
// the same "/socket.io" path, which would otherwise collide on one origin.
// Set VITE_CHAT_WS_URL to an absolute URL to bypass the proxy and connect
// directly to chat-service, which still expects its own real "/socket.io"
// path in that case.
const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL || "";
const CHAT_WS_PATH = CHAT_WS_URL ? "/socket.io" : "/chat-socket.io";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(CHAT_WS_URL, {
      path: CHAT_WS_PATH,
      auth: (cb) => cb({ token: localStorage.getItem("accessToken") }),
      autoConnect: false,
      // Voice/video call signaling still runs on chat-service until the call
      // service is moved behind the gateway socket.
      transports: ["websocket"],
      reconnectionAttempts: 5,
      timeout: 5000,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const current = getSocket();
  if (!current.connected) {
    current.connect();
  }
  return current;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null;
}
