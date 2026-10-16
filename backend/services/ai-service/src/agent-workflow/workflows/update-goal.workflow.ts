import type { SlotDefinition, WorkflowDefinition } from "../types";
import { createRoadmapSlots } from "./roadmap.workflow";

/**
 * UPDATE_GOAL — a tiny profile-only workflow used when the user changes their goal (and optionally target weight) OUTSIDE any other
 * workflow: "đổi mục tiêu sang giảm mỡ", or "ok đổi theo đề xuất đó" after a standalone recommendation. It reuses the roadmap
 * workflow's own `goal` and `targetWeight` slot definitions (same parsers, same contextual safety validators, same PROFILE_FACT
 * confirmation card), so a goal change is exactly as safe and as confirmable as inside the roadmap flow. The target weight is
 * OPTIONAL here (asking for one is the roadmap flow's job), and completing this workflow only reports the saved change: it never
 * chains into roadmap creation.
 *
 * `gatesIntentKind` is a synthetic kind the regex intent parser can never produce, so this workflow starts ONLY from the global
 * conversation policy (never from an ordinary sentence).
 */
export const UPDATE_GOAL_INTENT_KIND = "UPDATE_GOAL";

const goalSlot = createRoadmapSlots.find((s) => s.key === "goal")!;
const targetSlot = createRoadmapSlots.find((s) => s.key === "targetWeight")!;

export const updateGoalSlots: SlotDefinition<any>[] = [
  goalSlot,
  { ...targetSlot, required: false },
];

export const updateGoalWorkflow: WorkflowDefinition = {
  type: "UPDATE_GOAL",
  gatesIntentKind: UPDATE_GOAL_INTENT_KIND,
  slots: updateGoalSlots,
};
