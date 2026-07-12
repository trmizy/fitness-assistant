import { io, Socket } from "socket.io-client";
import { API_URL } from "../services/api";

const DEFAULT_SOCKET_URL = API_URL || "http://localhost:3000";
const SOCKET_URL = import.meta.env.VITE_SOCKET_URL || DEFAULT_SOCKET_URL;

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
