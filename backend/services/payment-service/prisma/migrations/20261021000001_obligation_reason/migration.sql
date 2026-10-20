-- D77: an unpaid obligation can say WHY it exists (the record-only late-arrival operation writes it). Additive, nullable.
ALTER TABLE "contract_unpaid_obligations" ADD COLUMN "reason" TEXT;
