-- [fitness_assistant] audit-proven safe statements only
-- [fitness_assistant] SAFE_FK: password_reset_tokens(user_id) -> users(id), orphans=0
ALTER TABLE "password_reset_tokens" ADD CONSTRAINT "password_reset_tokens_user_id_fkey" FOREIGN KEY ("user_id") REFERENCES "users"("id") ON DELETE CASCADE ON UPDATE CASCADE;

