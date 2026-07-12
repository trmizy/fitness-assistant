import { useEffect } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  REALTIME_EVENTS,
  type AiJobRealtimePayload,
} from "../realtime/events";
import { useSocket } from "./useSocket";

type UseAiJobProgressOptions = {
  jobId?: string | null;
  onProgress?: (payload: AiJobRealtimePayload) => void;
  onCompleted?: (payload: AiJobRealtimePayload) => void;
  onFailed?: (payload: AiJobRealtimePayload) => void;
};

export function useAiJobProgress({
  jobId,
  onProgress,
  onCompleted,
  onFailed,
}: UseAiJobProgressOptions) {
  const queryClient = useQueryClient();
  const { socket, status } = useSocket();

  useEffect(() => {
    if (!socket || !jobId) return;

    const handleProgress = (payload: AiJobRealtimePayload) => {
      if (payload.jobId !== jobId) return;
      queryClient.setQueryData(["ai-plan-job", jobId], payload);
      onProgress?.(payload);
    };

    const handleCompleted = (payload: AiJobRealtimePayload) => {
      if (payload.jobId !== jobId) return;
      queryClient.setQueryData(["ai-plan-job", jobId], payload);
      queryClient.invalidateQueries({ queryKey: ["ai-plans"] });
      onCompleted?.(payload);
    };

    const handleFailed = (payload: AiJobRealtimePayload) => {
      if (payload.jobId !== jobId) return;
      queryClient.setQueryData(["ai-plan-job", jobId], payload);
      onFailed?.(payload);
    };

    socket.emit(REALTIME_EVENTS.aiPlanSubscribe, { jobId });
    socket.on(REALTIME_EVENTS.aiPlanJobProgress, handleProgress);
    socket.on(REALTIME_EVENTS.aiPlanJobCompleted, handleCompleted);
    socket.on(REALTIME_EVENTS.aiPlanJobFailed, handleFailed);

    return () => {
      socket.emit(REALTIME_EVENTS.aiPlanUnsubscribe, { jobId });
      socket.off(REALTIME_EVENTS.aiPlanJobProgress, handleProgress);
      socket.off(REALTIME_EVENTS.aiPlanJobCompleted, handleCompleted);
      socket.off(REALTIME_EVENTS.aiPlanJobFailed, handleFailed);
    };
  }, [jobId, onCompleted, onFailed, onProgress, queryClient, socket]);

  return { status };
}
