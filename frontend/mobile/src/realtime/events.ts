/**
 * Realtime event types shared by the gateway socket and its consumers. Ported from web's
 * `realtime/events.ts` — only the connection status for now. The chat message and notification
 * payload types join here with the screens that consume them (Phase 9), rather than landing as
 * unused declarations.
 */
export type RealtimeConnectionStatus =
  | "idle"
  | "connecting"
  | "connected"
  | "disconnected"
  | "error";
