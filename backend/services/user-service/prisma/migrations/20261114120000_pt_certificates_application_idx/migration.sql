-- PT discovery hydration reads the certificates of a page of applications by application_id; the table had no index on it
-- (the FK does not create one), so every lookup was a sequential scan of all certificates. Additive only; matches
-- `@@index([applicationId])` on PTApplicationCertificate in schema.prisma (default Prisma index name).
CREATE INDEX IF NOT EXISTS "pt_application_certificates_application_id_idx"
  ON "pt_application_certificates"("application_id");
