import { io, Socket } from "socket.io-client";

const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL || "http://localhost:3005";

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    socket = io(CHAT_WS_URL, {
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
