import { io, Socket } from "socket.io-client";

const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL || "http://localhost:3005";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(CHAT_WS_URL, {
      auth: (cb) => cb({ token: localStorage.getItem("accessToken") }),
      autoConnect: false,
      // WebSocket-only: skip HTTP long-polling which triggers the browser tab loading
      // indicator and hangs indefinitely when the chat service is unavailable.
      transports: ["websocket"],
      // Give up after 5 failed reconnects instead of retrying forever (default: Infinity).
      reconnectionAttempts: 5,
      // 5 s connection timeout — fail fast rather than leaving a pending request open.
      timeout: 5000,
    });
  }
  return socket;
}

export function connectSocket(): Socket {
  const s = getSocket();
  if (!s.connected) {
    s.connect();
  }
  return s;
}

export function disconnectSocket() {
  socket?.disconnect();
  socket = null; // reset so next call re-creates with fresh token
}
