-- Backfill due_date for invoices created before due_date was persisted
UPDATE invoices
SET due_date = (issued_at::date + INTERVAL '14 days')::date
WHERE due_date IS NULL
  AND issued_at IS NOT NULL;
