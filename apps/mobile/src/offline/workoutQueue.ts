import * as Crypto from "expo-crypto";
import { getDb, isOfflineQueueSupported } from "./db";
import type { DraftExercise } from "../features/workouts/workoutDraftStore";

export { isOfflineQueueSupported } from "./db";

export interface QueuedWorkoutPayload {
  name: string;
  date: string;
  exercises: DraftExercise[];
}

export type QueuedStatus = "pending" | "failed";

export interface QueuedWorkoutLog {
  clientId: string;
  payload: QueuedWorkoutPayload;
  status: QueuedStatus;
  errorMessage: string | null;
  createdAt: string;
}

interface WorkoutLogRow {
  client_id: string;
  payload: string;
  status: string;
  error_message: string | null;
  created_at: string;
}

function toQueuedLog(row: WorkoutLogRow): QueuedWorkoutLog {
  return {
    clientId: row.client_id,
    payload: JSON.parse(row.payload) as QueuedWorkoutPayload,
    status: row.status as QueuedStatus,
    errorMessage: row.error_message,
    createdAt: row.created_at,
  };
}

// Không có server-side idempotency key cho POST /workouts (xem
// BLOCKED.md) — clientId (uuid) chỉ chống trùng ở phía client: mỗi item
// bị xoá khỏi queue ngay sau khi POST thành công, và syncQueuedWorkoutLogs
// xử lý tuần tự (không song song) nên không có 2 lần submit cùng lúc cho
// cùng 1 clientId.
export async function enqueueWorkoutLog(payload: QueuedWorkoutPayload): Promise<string> {
  const clientId = Crypto.randomUUID();
  if (!isOfflineQueueSupported()) return clientId;

  const db = await getDb();
  await db.runAsync(
    "INSERT INTO pending_workout_logs (client_id, payload, status, created_at) VALUES (?, ?, 'pending', ?)",
    clientId,
    JSON.stringify(payload),
    new Date().toISOString(),
  );
  return clientId;
}

export async function listQueuedWorkoutLogs(): Promise<QueuedWorkoutLog[]> {
  if (!isOfflineQueueSupported()) return [];
  const db = await getDb();
  const rows = await db.getAllAsync<WorkoutLogRow>(
    "SELECT * FROM pending_workout_logs ORDER BY created_at ASC",
  );
  return rows.map(toQueuedLog);
}

export async function removeQueuedWorkoutLog(clientId: string): Promise<void> {
  if (!isOfflineQueueSupported()) return;
  const db = await getDb();
  await db.runAsync("DELETE FROM pending_workout_logs WHERE client_id = ?", clientId);
}

export async function markQueuedWorkoutLogFailed(clientId: string, message: string): Promise<void> {
  if (!isOfflineQueueSupported()) return;
  const db = await getDb();
  await db.runAsync(
    "UPDATE pending_workout_logs SET status = 'failed', error_message = ? WHERE client_id = ?",
    message,
    clientId,
  );
}

export async function countQueuedWorkoutLogs(): Promise<number> {
  if (!isOfflineQueueSupported()) return 0;
  const db = await getDb();
  const row = await db.getFirstAsync<{ count: number }>(
    "SELECT COUNT(*) as count FROM pending_workout_logs",
  );
  return row?.count ?? 0;
}
