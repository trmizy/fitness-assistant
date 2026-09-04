import type { Server, Socket } from "socket.io";
import { CLIENT_EVENTS } from "../events";
import { aiJobRoom } from "../rooms";

type JobPayload = {
  jobId?: unknown;
};

function readJobId(payload: JobPayload): string | null {
  return typeof payload?.jobId === "string" && payload.jobId.trim()
    ? payload.jobId.trim()
    : null;
}

export function registerAiHandlers(_io: Server, socket: Socket) {
  socket.on(CLIENT_EVENTS.aiPlanSubscribe, async (payload: JobPayload) => {
    const jobId = readJobId(payload);
    if (!jobId) return;
    await socket.join(aiJobRoom(jobId));
  });

  socket.on(CLIENT_EVENTS.aiPlanUnsubscribe, async (payload: JobPayload) => {
    const jobId = readJobId(payload);
    if (!jobId) return;
    await socket.leave(aiJobRoom(jobId));
  });
}
