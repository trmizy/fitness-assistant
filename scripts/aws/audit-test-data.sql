-- READ-ONLY audit: which rows on the server look like test / seed / synthetic data.
-- Only SELECTs. Run each block against the database named in its header (psql, via a bastion or
-- the migrate Lambda's network path). It deletes nothing; review the numbers, take an Aurora snapshot,
-- and decide yourself what to remove.
--
-- Markers used (taken from this repo's seeders):
--   emails ending @example.com / @example.test / @demo.gymini.invalid, local part synthetic-*
--   data_origin = 'SYNTHETIC' (user_profiles, contracts, client journeys)

-- ===== auth database =====
SELECT count(*) AS total_users FROM users;
SELECT role, count(*) AS test_like_users
FROM users
WHERE email ~* '(@example\.(com|test)$|@demo\.gymini\.invalid$|^synthetic-|^test)'
GROUP BY role ORDER BY role;
SELECT id, email, role, created_at
FROM users
WHERE email ~* '(@example\.(com|test)$|@demo\.gymini\.invalid$|^synthetic-|^test)'
ORDER BY created_at DESC LIMIT 100;

-- ===== user database =====
SELECT data_origin, count(*) FROM user_profiles GROUP BY data_origin;
SELECT data_origin, count(*) FROM contracts GROUP BY data_origin;
-- profiles with no matching auth account cannot be checked across databases from SQL; compare this
-- list of user_id values against the auth `users.id` list (these show up as "auth-service 404").
SELECT user_id, is_pt, data_origin, created_at FROM user_profiles
WHERE data_origin = 'SYNTHETIC' OR user_id IN (SELECT user_id FROM user_profiles WHERE is_pt AND data_origin <> 'REAL')
ORDER BY created_at DESC LIMIT 100;
SELECT count(*) AS pt_applications FROM pt_applications;
SELECT count(*) AS sessions FROM sessions;

-- ===== ai database =====
SELECT count(*) AS conversations FROM conversations;
SELECT count(*) AS workout_plans FROM workout_plans;

-- ===== fitness / gym / payment databases =====
-- Per-user tables are keyed by the same user ids: compare against the test-like ids from the auth
-- query above before touching anything.
