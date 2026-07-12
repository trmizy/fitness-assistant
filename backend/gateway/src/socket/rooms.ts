import type { SocketUser } from "./events";

export function userRoom(userId: string): string {
  return `user:${userId}`;
}

export function roleRoom(role: SocketUser["role"]): string {
  return `role:${role.toLowerCase()}`;
}

export function trainerRoom(userId: string): string {
  return `trainer:${userId}`;
}

export function clientRoom(userId: string): string {
  return `client:${userId}`;
}

export function chatRoom(conversationId: string): string {
  return `chat:${conversationId}`;
}

export function aiJobRoom(jobId: string): string {
  return `ai-job:${jobId}`;
}

export function dashboardRoom(scope: string): string {
  return `dashboard:${scope}`;
}

export function roomsForUser(user: SocketUser): string[] {
  const rooms = [userRoom(user.id), roleRoom(user.role)];

  if (user.role === "ADMIN") {
    rooms.push("role:admin");
  } else if (user.role === "PT") {
    rooms.push(trainerRoom(user.id));
  } else {
    rooms.push(clientRoom(user.id));
  }

  return Array.from(new Set(rooms));
}
