-- Add closed_date column to deals table for better revenue tracking
ALTER TABLE deals ADD COLUMN IF NOT EXISTS closed_date DATE;

-- Create index on closed_date for efficient querying
CREATE INDEX IF NOT EXISTS deals_closed_date_idx ON deals(closed_date);

-- Create a trigger to automatically set closed_date when deal moves to closed_won
CREATE OR REPLACE FUNCTION set_deal_closed_date()
RETURNS TRIGGER AS $$
BEGIN
  -- Set closed_date when stage changes to 'closed_won' and closed_date is not already set
  IF NEW.stage = 'closed_won' AND OLD.stage != 'closed_won' AND NEW.closed_date IS NULL THEN
    NEW.closed_date = CURRENT_DATE;
  END IF;

  -- Clear closed_date if deal moves away from closed_won
  IF NEW.stage != 'closed_won' AND OLD.stage = 'closed_won' THEN
    NEW.closed_date = NULL;
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS set_deals_closed_date ON deals;
CREATE TRIGGER set_deals_closed_date
  BEFORE UPDATE ON deals
  FOR EACH ROW
  EXECUTE FUNCTION set_deal_closed_date();
