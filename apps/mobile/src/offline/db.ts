import { Platform } from "react-native";
import * as SQLite from "expo-sqlite";

const DB_NAME = "gymcoach_offline.db";
let dbPromise: Promise<SQLite.SQLiteDatabase> | null = null;

// expo-sqlite has no web implementation — the offline queue is
// native-only. Web (used here only for the expo export bundle check)
// always behaves as if the queue is empty; log submission there is
// online-only. See DECISIONS.md.
export function isOfflineQueueSupported(): boolean {
  return Platform.OS !== "web";
}

export async function getDb(): Promise<SQLite.SQLiteDatabase> {
  if (!dbPromise) {
    dbPromise = SQLite.openDatabaseAsync(DB_NAME).then(async (db) => {
      await db.execAsync(`
        CREATE TABLE IF NOT EXISTS pending_workout_logs (
          client_id TEXT PRIMARY KEY NOT NULL,
          payload TEXT NOT NULL,
          status TEXT NOT NULL DEFAULT 'pending',
          error_message TEXT,
          created_at TEXT NOT NULL
        );
      `);
      return db;
    });
  }
  return dbPromise;
}
