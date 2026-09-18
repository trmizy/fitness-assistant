export const LOADED_CARRY_EXERCISE_NAMES = [
  "Farmer Carry",
  "Suitcase Carry",
  "Front Rack Carry",
] as const;

export function loadedCarryLoggingModeWhere() {
  return {
    exerciseName: { in: [...LOADED_CARRY_EXERCISE_NAMES] },
    movementPattern: "CARRY",
    loggingMode: { not: "TIME_LOAD" },
  };
}
