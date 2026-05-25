-- AlterTable: pt_applications — add ONLINE/OFFLINE pricing fields
ALTER TABLE "pt_applications" ADD COLUMN "online_price_per_session"  DOUBLE PRECISION;
ALTER TABLE "pt_applications" ADD COLUMN "offline_price_per_session" DOUBLE PRECISION;
ALTER TABLE "pt_applications" ADD COLUMN "online_package_price"      DOUBLE PRECISION;
ALTER TABLE "pt_applications" ADD COLUMN "offline_package_price"     DOUBLE PRECISION;

-- AlterTable: contracts — add session_mode field (ONLINE or OFFLINE, never HYBRID for a contract)
ALTER TABLE "contracts" ADD COLUMN "session_mode" "SessionMode";
