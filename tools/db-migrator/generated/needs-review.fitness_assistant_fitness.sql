-- [fitness_assistant_fitness] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "roadmap_phases" ADD CONSTRAINT "roadmap_phases_roadmap_id_fkey" FOREIGN KEY ("roadmap_id") REFERENCES "fitness_roadmaps"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_fitness] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "training_cycles" ADD CONSTRAINT "training_cycles_roadmap_phase_id_fkey" FOREIGN KEY ("roadmap_phase_id") REFERENCES "roadmap_phases"("id") ON DELETE SET NULL ON UPDATE CASCADE;

