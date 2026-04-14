-- Seed sample revenue data for development
-- This creates revenue targets and manual revenue entries for the Riftly workspace

DO $$
DECLARE
  workspace_uuid UUID;
  founder_uuid UUID;
  employee_uuid UUID;
BEGIN
  -- Get the Riftly workspace ID
  SELECT id INTO workspace_uuid FROM workspaces WHERE slug = 'riftly';

  -- Get the founder user ID
  SELECT id INTO founder_uuid FROM profiles WHERE email = 'founder@riftly.com';

  -- Get an employee user ID
  SELECT id INTO employee_uuid FROM profiles WHERE email = 'employee@riftly.com' LIMIT 1;

  -- Only seed if workspace and users exist
  IF workspace_uuid IS NOT NULL AND founder_uuid IS NOT NULL THEN

    -- Insert revenue targets for past 6 months and current month
    INSERT INTO revenue_targets (workspace_id, month, target_amount, created_at) VALUES
    (workspace_uuid, '2025-10-01', 50000, NOW() - INTERVAL '6 months'),
    (workspace_uuid, '2025-11-01', 55000, NOW() - INTERVAL '5 months'),
    (workspace_uuid, '2025-12-01', 60000, NOW() - INTERVAL '4 months'),
    (workspace_uuid, '2026-01-01', 65000, NOW() - INTERVAL '3 months'),
    (workspace_uuid, '2026-02-01', 70000, NOW() - INTERVAL '2 months'),
    (workspace_uuid, '2026-03-01', 75000, NOW() - INTERVAL '1 month'),
    (workspace_uuid, '2026-04-01', 80000, NOW());

    -- Insert manual revenue entries for the current and past months
    INSERT INTO revenue_entries (workspace_id, amount, description, entry_date, category, created_by, created_at) VALUES

    -- March 2026 entries
    (workspace_uuid, 5000, 'One-time consulting project for LocalBiz - strategic planning and implementation roadmap', '2026-03-05', 'project_income', founder_uuid, NOW() - INTERVAL '40 days'),
    (workspace_uuid, 3500, 'Referral bonus from TechPartners for recommending our services', '2026-03-12', 'other', founder_uuid, NOW() - INTERVAL '33 days'),
    (workspace_uuid, 8000, 'Custom API integration work for existing client FinanceApp', '2026-03-18', 'service_income', employee_uuid, NOW() - INTERVAL '27 days'),
    (workspace_uuid, 2000, 'Training workshop for StartupHub team on modern web development', '2026-03-22', 'other', founder_uuid, NOW() - INTERVAL '23 days'),

    -- April 2026 entries (current month)
    (workspace_uuid, 12000, 'Emergency bug fixes and performance optimization for CloudSystem Inc', '2026-04-03', 'project_income', founder_uuid, NOW() - INTERVAL '11 days'),
    (workspace_uuid, 4500, 'Website maintenance and content updates - Q2 2026 package', '2026-04-08', 'service_income', employee_uuid, NOW() - INTERVAL '6 days'),
    (workspace_uuid, 1500, 'Code review and architecture consultation for DataFlow startup', '2026-04-10', 'other', founder_uuid, NOW() - INTERVAL '4 days'),
    (workspace_uuid, 6000, 'Mobile app feature development sprint for existing client RetailPro', '2026-04-12', 'project_income', employee_uuid, NOW() - INTERVAL '2 days');

    -- Update some existing closed_won deals to have closed_date values
    -- This will show them in the revenue tracking for their respective months
    UPDATE deals
    SET closed_date = '2026-03-15'
    WHERE workspace_id = workspace_uuid
      AND stage = 'closed_won'
      AND prospect_name = 'Success Stories Inc'
      AND closed_date IS NULL;

    UPDATE deals
    SET closed_date = '2026-04-05'
    WHERE workspace_id = workspace_uuid
      AND stage = 'closed_won'
      AND prospect_name = 'WinTech Solutions'
      AND closed_date IS NULL;

    RAISE NOTICE 'Revenue seed data created successfully for workspace: %', workspace_uuid;
  ELSE
    RAISE NOTICE 'Workspace or users not found. Skipping revenue seed data.';
  END IF;
END $$;
