-- ADV-006 (docs/ai-agent-adversarial-findings.md, hardening pass #2):
-- enforce "at most one ClientJourney per Contract" at the DB level.
-- Verified zero existing duplicate (contract_id) rows before this
-- migration (331 distinct groups, 0 with count > 1). Safe/forward-only:
-- adds one unique index, does not touch existing data. contract_id is
-- nullable, and Postgres treats every NULL as distinct for a unique
-- index, so journeys with no contract are never constrained against
-- each other.
CREATE UNIQUE INDEX "client_journeys_contract_id_key" ON "client_journeys"("contract_id");
