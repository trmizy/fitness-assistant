/**
 * 14B.4 (PG-A3) — the program-editing rules of web `WorkoutLogPage` (edit a day's exercises, superset
 * grouping, custom exercises, manual program), pure so they can be unit-tested. fitness-service still
 * validates every write (exercise ids against the catalog + the user's own custom exercises, order ≥ 1,
 * at least one exercise per day).
 */

export type EditExercise = {
  /** WorkoutProgramExercise id when it already exists on the server; null for a newly added one. */
  programExerciseId: string | null;
  exerciseId: string;
  name: string;
  sets: number;
  reps: number;
  restSeconds: number;
  notes: string | null;
};

export function editExercisesFromDay(day: any): EditExercise[] {
  const list: any[] = Array.isArray(day?.exercises) ? [...day.exercises] : [];
  return list
    .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
    .map((ex) => ({
      programExerciseId: ex.id ? String(ex.id) : null,
      exerciseId: String(ex.exerciseId ?? ex.exercise?.id ?? ""),
      name: String(ex.exercise?.exerciseName ?? ex.exerciseName ?? "Bài tập"),
      sets: Number(ex.sets ?? 3),
      reps: Number(ex.reps ?? 10),
      restSeconds: Number(ex.restSeconds ?? 90),
      notes: ex.notes ?? null,
    }));
}

export type DaySaveOp =
  | { kind: "update"; programExerciseId: string; payload: ExercisePayload }
  | { kind: "add"; payload: ExercisePayload }
  | { kind: "delete"; programExerciseId: string };

export type ExercisePayload = { exerciseId: string; order: number; sets: number; reps: number; restSeconds: number; notes: string | null };

/**
 * Web's handleSaveWorkout for a program day: update rows that still exist, add new ones, delete the
 * ones the user removed. Order is the list position (1-based). Empty day is refused, as on web.
 */
export function daySaveOps(original: any, edited: EditExercise[]): { ok: true; ops: DaySaveOp[] } | { ok: false; error: string } {
  if (edited.length === 0) return { ok: false, error: "Mỗi ngày tập cần ít nhất 1 bài tập." };
  const existing = new Set((Array.isArray(original?.exercises) ? original.exercises : []).map((e: any) => String(e.id)));
  const ops: DaySaveOp[] = [];
  edited.forEach((ex, i) => {
    const payload: ExercisePayload = {
      exerciseId: ex.exerciseId,
      order: i + 1,
      sets: Number(ex.sets) || 3,
      reps: Number(ex.reps) || 10,
      restSeconds: Number(ex.restSeconds) || 90,
      notes: ex.notes || null,
    };
    if (ex.programExerciseId && existing.has(ex.programExerciseId)) ops.push({ kind: "update", programExerciseId: ex.programExerciseId, payload });
    else ops.push({ kind: "add", payload });
  });
  const kept = new Set(edited.map((e) => e.programExerciseId).filter(Boolean));
  for (const id of existing) if (!kept.has(id as string)) ops.push({ kind: "delete", programExerciseId: id as string });
  return { ok: true, ops };
}

export const GROUP_TYPE_LABEL: Record<string, string> = { SUPERSET: "Superset", TRISET: "Triset", CIRCUIT: "Circuit" };

/** Type comes from how many are selected (web): 2 = superset, 3 = triset, 4+ = circuit. */
export function groupTypeFor(count: number): "SUPERSET" | "TRISET" | "CIRCUIT" | null {
  if (count < 2) return null;
  return count === 2 ? "SUPERSET" : count === 3 ? "TRISET" : "CIRCUIT";
}

/** programExerciseId → its group (id, type, 1-based position in the group — web shows "Superset · Bài 2"). */
export function groupIndex(day: any): Map<string, { groupId: string; type: string; position: number }> {
  const out = new Map<string, { groupId: string; type: string; position: number }>();
  const groups: any[] = Array.isArray(day?.exerciseGroups) ? day.exerciseGroups : [];
  groups.forEach((g) => {
    const members: any[] = Array.isArray(g.members) ? [...g.members] : [];
    members
      .sort((a, b) => Number(a.order ?? 0) - Number(b.order ?? 0))
      .forEach((m, i) => out.set(String(m.programExerciseId), { groupId: String(g.id), type: String(g.type), position: i + 1 }));
  });
  return out;
}

const VI: Record<string, string> = {
  UPPER_BODY: "Thân trên",
  LOWER_BODY: "Thân dưới",
  CORE: "Core",
  FULL_BODY: "Toàn thân",
  BODYWEIGHT: "Không dụng cụ",
  BARBELL: "Tạ đòn",
  DUMBBELLS: "Tạ đơn",
  KETTLEBELL: "Tạ ấm",
  MACHINE: "Máy",
  RESISTANCE_BAND: "Dây kháng lực",
  CABLE: "Cáp",
  MEDICINE_BALL: "Bóng tạ",
  FOAM_ROLLER: "Con lăn",
  STRENGTH: "Sức mạnh",
  CARDIO: "Cardio",
  MOBILITY: "Linh hoạt",
  STRENGTH_CARDIO: "Sức mạnh + cardio",
  STRENGTH_MOBILITY: "Sức mạnh + linh hoạt",
  PUSH: "Đẩy",
  PULL: "Kéo",
  HOLD: "Giữ",
  STRETCH: "Giãn",
};
export const enumLabel = (v: string) => VI[v] ?? v.replace(/_/g, " ").toLowerCase();

export const LOGGING_MODES = [
  { value: "REPS_LOAD", label: "Tạ × Reps" },
  { value: "BODYWEIGHT_REPS", label: "Reps (bodyweight)" },
  { value: "TIME", label: "Thời gian" },
  { value: "TIME_LOAD", label: "Tạ + Thời gian" },
  { value: "DISTANCE_TIME", label: "Quãng đường + Thời gian" },
];

/** The server's filter-options (wrapped in `{ success, data }`; web reads the wrapper and falls back). */
export function filterOptions(raw: any): { bodyParts: string[]; equipments: string[]; activityTypes: string[]; types: string[] } {
  const d = raw?.data ?? raw ?? {};
  const pick = (k: string, fallback: string[]) => (Array.isArray(d[k]) && d[k].length ? d[k] : fallback);
  return {
    bodyParts: pick("bodyParts", ["UPPER_BODY", "LOWER_BODY", "CORE", "FULL_BODY"]),
    equipments: pick("equipments", ["BODYWEIGHT"]),
    activityTypes: pick("activityTypes", ["STRENGTH"]),
    types: pick("types", ["PUSH", "PULL", "HOLD", "STRETCH"]),
  };
}

export function customExercisePayload(f: {
  exerciseName: string;
  typeOfActivity: string;
  typeOfEquipment: string;
  bodyPart: string;
  type: string;
  loggingMode: string;
  muscleGroupsText: string;
  instructions: string;
}, confirmCreateAnyway: boolean) {
  return {
    exerciseName: f.exerciseName.trim(),
    typeOfActivity: f.typeOfActivity,
    typeOfEquipment: f.typeOfEquipment,
    bodyPart: f.bodyPart,
    type: f.type,
    muscleGroupsActivated: f.muscleGroupsText.split(",").map((s) => s.trim().toLowerCase()).filter(Boolean),
    instructions: f.instructions.trim() || undefined,
    loggingMode: f.loggingMode,
    confirmCreateAnyway,
  };
}
