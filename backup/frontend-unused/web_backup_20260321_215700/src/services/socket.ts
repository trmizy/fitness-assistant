import { io, Socket } from 'socket.io-client';

const CHAT_WS_URL = import.meta.env.VITE_CHAT_WS_URL || 'http://localhost:3005';

let socket: Socket | null = null;

export function getSocket(): Socket {
  if (!socket) {
    const token = localStorage.getItem('accessToken');
    socket = io(CHAT_WS_URL, {
      auth: { token },
      autoConnect: false,
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
