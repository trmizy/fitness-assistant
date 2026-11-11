-- [fitness_assistant_fitness] audit-proven safe statements only
-- [fitness_assistant_fitness] SAFE_FK: roadmap_phases(roadmap_id) -> fitness_roadmaps(id), orphans=0
ALTER TABLE "roadmap_phases" ADD CONSTRAINT "roadmap_phases_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "fitness_roadmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_fitness] SAFE_FK: training_cycles(roadmap_phase_id) -> roadmap_phases(id), orphans=0
ALTER TABLE "training_cycles" ADD CONSTRAINT "training_cycles_roadmap_phase_id_fkey" FOREIGN KEY ("roadmap_phase_id") REFERENCES "roadmap_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

