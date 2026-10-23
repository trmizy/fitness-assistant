-- D25: a trainer must confirm the platform's PT terms (a versioned text) before accepting NEW client contracts.
-- One append-only table; the current acceptance of a PT is "a row exists for (user_id, <current version>)".
-- Additive only: no existing table or column is touched, nothing is backfilled - a PT who confirmed nothing has
-- no row and is asked to confirm; contracts already accepted/active are not read or changed by this feature.
CREATE TABLE "pt_terms_acceptances" (
    "id"           TEXT NOT NULL,
    "user_id"      TEXT NOT NULL,
    "version"      TEXT NOT NULL,
    "source"       TEXT NOT NULL,
    "accepted_at"  TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ip_address"   TEXT,
    "user_agent"   TEXT,

    CONSTRAINT "pt_terms_acceptances_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "pt_terms_acceptances_source_check" CHECK ("source" IN ('APPLICATION', 'RECONFIRM'))
);

-- A user accepts a given version once (idempotent re-accept), and the gate's lookup is exactly this key.
CREATE UNIQUE INDEX "pt_terms_acceptances_user_id_version_key" ON "pt_terms_acceptances"("user_id", "version");
