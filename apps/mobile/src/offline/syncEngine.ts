import axios from "axios";
import NetInfo from "@react-native-community/netinfo";
import { submitWorkoutLog } from "../features/workouts/submitWorkoutLog";
import {
  isOfflineQueueSupported,
  listQueuedWorkoutLogs,
  markQueuedWorkoutLogFailed,
  removeQueuedWorkoutLog,
} from "./workoutQueue";
import { getApiErrorMessage } from "../api/client";
import { queryClient } from "../api/queryClient";
import { queryKeys } from "../api/queries";

let isSyncing = false;

function isNetworkError(err: unknown): boolean {
  // No `response` means the request never reached the server — a real
  // network failure, as opposed to a 4xx/5xx the server actually replied
  // with (which should surface as a real error, not retry forever).
  return axios.isAxiosError(err) && !err.response;
}

export async function syncQueuedWorkoutLogs(): Promise<{ synced: number; failed: number }> {
  if (!isOfflineQueueSupported() || isSyncing) return { synced: 0, failed: 0 };
  isSyncing = true;
  let synced = 0;
  let failed = 0;

  try {
    const items = await listQueuedWorkoutLogs();
    for (const item of items) {
      if (item.status === "failed") continue; // needs user attention, not auto-retried

      try {
        await submitWorkoutLog(item.payload);
        await removeQueuedWorkoutLog(item.clientId);
        synced += 1;
      } catch (err) {
        failed += 1;
        if (isNetworkError(err)) {
          // Still offline — stop this pass, leave item pending for retry.
          break;
        }
        await markQueuedWorkoutLogFailed(item.clientId, getApiErrorMessage(err, "Đồng bộ thất bại"));
      }
    }
  } finally {
    isSyncing = false;
    void queryClient.invalidateQueries({ queryKey: queryKeys.pendingWorkoutLogs });
    if (synced > 0) {
      void queryClient.invalidateQueries({ queryKey: ["workouts"] });
    }
  }

  return { synced, failed };
}

let netInfoUnsubscribe: (() => void) | null = null;

export function startAutoSyncListener(): void {
  if (netInfoUnsubscribe || !isOfflineQueueSupported()) return;
  netInfoUnsubscribe = NetInfo.addEventListener((state) => {
    if (state.isConnected && state.isInternetReachable !== false) {
      void syncQueuedWorkoutLogs();
    }
  });
}
