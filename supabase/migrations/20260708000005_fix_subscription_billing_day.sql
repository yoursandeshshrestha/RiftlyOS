-- Align stored billing day with Stripe billing period start
UPDATE subscriptions
SET day_of_month = LEAST(EXTRACT(DAY FROM current_period_start)::int, 28)
WHERE current_period_start IS NOT NULL;
