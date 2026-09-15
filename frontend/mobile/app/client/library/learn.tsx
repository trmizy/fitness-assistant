import { PhasePlaceholder } from "../../../src/components/navigation/PhasePlaceholder";

/** SH-16 — kiến thức dinh dưỡng. Static content (`nutritionKnowledge.ts`), no backend call;
 * ported in Phase 6 with the rest of the nutrition screens. */
export default function NutritionKnowledgeScreen() {
  return (
    <PhasePlaceholder
      title="Kiến thức"
      phase="Phase 6"
      description="Bài viết ngắn về calo, macro, BMR, TDEE và hiệu suất tập."
    />
  );
}
