import * as crypto from "crypto";
import type { ImportedExercise } from "./import-canonical.types";

/**
 * Roadmap P2 "Canonical import framework" — deterministic identity for a
 * parsed workout, used by import.service.ts's idempotency check (a
 * workout whose hash already appears in one of the user's past
 * COMMITTED batches is skipped, never re-inserted). Provider-agnostic:
 * every parser (Hevy, Strong, ...) calls this the same way, so
 * idempotency behaves identically regardless of source.
 */
export function computeImportSourceHash(title: string, startTime: string, exercises: ImportedExercise[]): string {
  // Deterministic regardless of object key insertion order — build the
  // hash input explicitly rather than JSON.stringify-ing objects whose
  // key order isn't guaranteed to be stable input-to-input.
  const parts: string[] = [title.trim().toLowerCase(), startTime.trim()];
  for (const ex of exercises) {
    parts.push(ex.exerciseTitle.trim().toLowerCase());
    for (const s of ex.sets) {
      parts.push(`${s.setNumber}|${s.weight}|${s.reps}|${s.durationSeconds}|${s.distanceMeters}`);
    }
  }
  return crypto.createHash("sha256").update(parts.join("::")).digest("hex");
}
