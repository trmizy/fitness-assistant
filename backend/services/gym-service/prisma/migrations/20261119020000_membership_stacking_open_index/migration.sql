-- Membership stacking ("Gia han", owner rule 19/11/2026): a client may buy another plan at a gym while
-- an ACTIVE one still runs; the new one starts when the latest existing one ends (start_date in the
-- future, status ACTIVE only once PAID). So the DB guard narrows from "one PENDING_PAYMENT or ACTIVE
-- per (client, gym)" to "one PENDING_PAYMENT per (client, gym)": two unpaid orders at once stay
-- impossible, any number of paid, back-to-back periods are allowed. Overlap-freedom of the paid periods
-- is enforced in activateIfPending (start = latest ACTIVE end of the brand, under an advisory lock).
-- No column / status added; no data touched.
DROP INDEX IF EXISTS "unique_open_membership_per_gym";

CREATE UNIQUE INDEX "unique_open_membership_per_gym"
ON "gym_membership_contracts" ("client_id", "gym_id")
WHERE "status" = 'PENDING_PAYMENT';
