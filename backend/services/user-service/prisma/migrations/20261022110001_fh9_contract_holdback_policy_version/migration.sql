-- FH-9: the version of the PT-holdback policy a contract was created under. Additive; every existing contract gets 0 = "no FH-9 holdback",
-- so nothing already signed can ever start holding money (the feature is not retroactive).
ALTER TABLE "contracts" ADD COLUMN "pt_holdback_policy_version" INTEGER NOT NULL DEFAULT 0;
