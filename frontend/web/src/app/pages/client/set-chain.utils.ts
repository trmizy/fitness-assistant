export type SetChainTechnique = "STRAIGHT" | "DROP_SET" | "REST_PAUSE";

export type SetChainSegmentDraft = {
  reps: string;
  weightKg: string;
  restBeforeSeconds: string;
};

export type SetChainDraft = {
  setTechnique: SetChainTechnique;
  segments: SetChainSegmentDraft[];
  weightKg: string;
  reps: string;
};

export function newSetChainSegment(
  technique: SetChainTechnique,
  activeLog: Pick<SetChainDraft, "weightKg" | "reps">,
): SetChainSegmentDraft {
  const currentWeight = Number(activeLog.weightKg);
  return {
    reps: technique === "REST_PAUSE" ? "3" : activeLog.reps || "8",
    weightKg:
      technique === "DROP_SET" && Number.isFinite(currentWeight)
        ? String(Math.max(0, Math.round(currentWeight * 0.8 * 2) / 2))
        : activeLog.weightKg,
    restBeforeSeconds: technique === "REST_PAUSE" ? "20" : "0",
  };
}

export function buildSetChainSegments(activeLog: SetChainDraft) {
  if (activeLog.setTechnique === "STRAIGHT") return [];
  return activeLog.segments.map((segment, index) => {
    const weight = Number(segment.weightKg);
    const restBeforeSeconds = Number(segment.restBeforeSeconds);
    return {
      segmentNumber: index + 1,
      technique: activeLog.setTechnique,
      reps: Number(segment.reps),
      weight: segment.weightKg.trim() !== "" && Number.isFinite(weight) && weight >= 0
        ? weight
        : null,
      restBeforeSeconds:
        Number.isFinite(restBeforeSeconds) && restBeforeSeconds >= 0
          ? Math.round(restBeforeSeconds)
          : null,
    };
  });
}

export function isSetChainValid(activeLog: SetChainDraft): boolean {
  if (activeLog.setTechnique === "STRAIGHT") return true;
  if (activeLog.segments.length === 0 || activeLog.segments.length > 10) return false;
  return activeLog.segments.every((segment) => {
    const reps = Number(segment.reps);
    const weight = Number(segment.weightKg);
    const rest = Number(segment.restBeforeSeconds);
    return (
      Number.isInteger(reps) &&
      reps > 0 &&
      (segment.weightKg.trim() === "" || (Number.isFinite(weight) && weight >= 0)) &&
      Number.isFinite(rest) &&
      rest >= 0 &&
      rest <= 600
    );
  });
}
