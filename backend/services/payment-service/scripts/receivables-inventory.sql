-- READ-ONLY aggregate inventory of historic PartnerReceivable rows (no PII: no partner id, no transaction id, no reason text).
-- Run: psql "$READ_ONLY_REPLICA_URL" -f scripts/receivables-inventory.sql
-- Owner decision: these rows are history only - nothing is ever deducted for them. This lists what still needs a reconciliation decision (FH-8).
SELECT
  r.partner_type::text                                    AS partner_type,
  coalesce(t.purpose::text, 'UNKNOWN_ORIGIN')             AS origin_purpose,           -- what the fronted money was for (PT_CONTRACT, GYM_MEMBERSHIP, ...)
  CASE WHEN r.created_at <  now() - interval '180 days' THEN '>180d'
       WHEN r.created_at <  now() - interval '90 days'  THEN '90-180d'
       WHEN r.created_at <  now() - interval '30 days'  THEN '30-90d'
       ELSE '<30d' END                                    AS age_bucket,
  CASE WHEN r.settled_at IS NOT NULL AND r.waived = 0 THEN 'SETTLED_RECOVERED'
       WHEN r.settled_at IS NOT NULL                    THEN 'SETTLED_WITH_WAIVE'
       WHEN r.suspended_at IS NOT NULL                  THEN 'SUSPENDED'
       WHEN r.waived > 0                                THEN 'PARTLY_WAIVED_OPEN'
       WHEN r.recovered > 0                             THEN 'PARTLY_RECOVERED_OPEN'
       ELSE 'OPEN_UNTOUCHED' END                          AS state,
  count(*)                                                AS rows,
  sum(r.amount)::numeric(16,2)                            AS total_amount,
  sum(r.recovered)::numeric(16,2)                         AS total_recovered,
  sum(r.waived)::numeric(16,2)                            AS total_waived,
  sum(greatest(r.amount - r.recovered - r.waived, 0))::numeric(16,2) AS still_outstanding
FROM partner_receivables r
LEFT JOIN payment_transactions t ON t.id = r.transaction_id
GROUP BY 1, 2, 3, 4
ORDER BY 1, 2, 4, 3;
