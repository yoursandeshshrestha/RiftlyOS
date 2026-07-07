-- Backfill billing day for retainers created before day_of_month was always stored
UPDATE subscriptions
SET day_of_month = LEAST(EXTRACT(DAY FROM created_at AT TIME ZONE 'UTC')::int, 28)
WHERE day_of_month IS NULL;
