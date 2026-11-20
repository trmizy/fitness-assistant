import { prisma } from "../repositories/prisma";

/**
 * Exercise names + guidance for people reading Vietnamese. Source of truth = the catalog (Exercise + ExerciseAlias + ExerciseGuidance), never a model.
 * Display name: guidance.nameVi -> Vietnamese alias -> the English exerciseName (flagged MISSING so the UI can show it as the original name).
 * Only guidance whose verification is CURATED or REVIEWED is returned; MACHINE_TRANSLATED rows are never shown as verified.
 */
export const VERIFIED_GUIDANCE = ["CURATED", "REVIEWED"] as const;

export interface ExerciseLocalization {
  id: string;
  nameEn: string;
  nameVi: string | null;
  nameViSource: "GUIDANCE" | "ALIAS" | "MISSING";
  /** What to show: the Vietnamese name when verified, otherwise the original English name. */
  displayName: string;
  instructionsVi: string | null;
  instructionsEn: string | null;
  commonMistakesVi: string[];
  safetyNotesVi: string[];
  muscleGroups: string[];
  equipment: string | null;
  guidanceStatus: "VERIFIED" | "MISSING" | "HIDDEN_UNVERIFIED";
}

type Row = {
  id: string; exerciseName: string; instructions: string | null; muscleGroupsActivated: string[]; typeOfEquipment: string | null;
  aliases: Array<{ alias: string; aliasType: string; language: string }>;
  guidance: Array<{ nameVi: string | null; instructionsVi: string | null; commonMistakesVi: string[]; safetyNotesVi: string[]; verification: string }>;
};

export function toLocalization(r: Row): ExerciseLocalization {
  const g = r.guidance[0];
  const verified = g && (VERIFIED_GUIDANCE as readonly string[]).includes(g.verification) ? g : null;
  const alias = r.aliases.find((a) => a.language === "vi" && a.aliasType === "localized_name") ?? r.aliases.find((a) => a.language === "vi");
  const nameVi = verified?.nameVi?.trim() || alias?.alias?.trim() || null;
  return {
    id: r.id, nameEn: r.exerciseName, nameVi,
    nameViSource: verified?.nameVi?.trim() ? "GUIDANCE" : alias ? "ALIAS" : "MISSING",
    displayName: nameVi ?? r.exerciseName,
    instructionsVi: verified?.instructionsVi?.trim() || null, instructionsEn: r.instructions?.trim() || null,
    commonMistakesVi: verified?.commonMistakesVi ?? [], safetyNotesVi: verified?.safetyNotesVi ?? [],
    muscleGroups: r.muscleGroupsActivated ?? [], equipment: r.typeOfEquipment ?? null,
    guidanceStatus: verified ? "VERIFIED" : g ? "HIDDEN_UNVERIFIED" : "MISSING",
  };
}

const SELECT = {
  id: true, exerciseName: true, instructions: true, muscleGroupsActivated: true, typeOfEquipment: true,
  aliases: { select: { alias: true, aliasType: true, language: true } },
  guidance: { where: { language: "vi" }, select: { nameVi: true, instructionsVi: true, commonMistakesVi: true, safetyNotesVi: true, verification: true } },
} as const;

export const exerciseLocalizationService = {
  /** Ids the caller may see are decided by the CALLER's visibility filter (same rule as muscle-profiles); unknown ids are simply absent. */
  async getLocalizations(ids: string[], visibility: Record<string, unknown> = {}): Promise<ExerciseLocalization[]> {
    const unique = [...new Set(ids)].slice(0, 200);
    const rows = (await prisma.exercise.findMany({ where: { id: { in: unique }, ...visibility } as any, select: SELECT as any })) as unknown as Row[];
    return rows.map(toLocalization);
  },

  /** Coverage of the PUBLISHED catalog (what a user can actually see). */
  async getCoverage() {
    const rows = (await prisma.exercise.findMany({ where: { status: "PUBLISHED", archivedAt: null }, select: SELECT as any })) as unknown as Row[];
    const loc = rows.map(toLocalization);
    const count = (f: (l: ExerciseLocalization) => boolean) => loc.filter(f).length;
    return {
      published: loc.length,
      nameVi: count((l) => l.nameVi !== null),
      instructionsVi: count((l) => l.instructionsVi !== null),
      commonMistakesVi: count((l) => l.commonMistakesVi.length > 0),
      safetyNotesVi: count((l) => l.safetyNotesVi.length > 0),
      englishOnly: count((l) => l.nameVi === null),
      missingInstructionsVi: count((l) => l.instructionsVi === null),
      missingCommonMistakes: count((l) => l.commonMistakesVi.length === 0),
      missingSafetyNotes: count((l) => l.safetyNotesVi.length === 0),
      hiddenUnverified: count((l) => l.guidanceStatus === "HIDDEN_UNVERIFIED"),
    };
  },
};
