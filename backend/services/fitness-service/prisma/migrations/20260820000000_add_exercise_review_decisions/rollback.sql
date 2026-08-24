-- Rollback for 20260820000000_add_exercise_review_decisions.
-- Safe by construction at the time this is written: this table only ever
-- holds human review-decision AUDIT data (not user data, not workout
-- history) — dropping it loses the record of past Gate 7 review
-- decisions, never any user-facing data or the Exercise rows those
-- decisions acted on (those live in "exercises"/"exercise_aliases"/
-- "exercise_sources" independently). If real reviews have happened since,
-- back up "exercise_review_decisions" first if that audit trail matters.
DROP TABLE IF EXISTS "exercise_review_decisions";
