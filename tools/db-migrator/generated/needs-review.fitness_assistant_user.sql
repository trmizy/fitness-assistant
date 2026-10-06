-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "agent_contract_drafts" ADD CONSTRAINT "agent_contract_drafts_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "client_journeys" ADD CONSTRAINT "client_journeys_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "client_journeys" ADD CONSTRAINT "client_journeys_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "user_profiles"("userId") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_contract_id_fkey" FOREIGN KEY ("contract_id") REFERENCES "contracts"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- [fitness_assistant_user] AddForeignKey  *** NEEDS MANUAL REVIEW ***
ALTER TABLE "client_reviews" ADD CONSTRAINT "client_reviews_session_id_fkey" FOREIGN KEY ("session_id") REFERENCES "sessions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

