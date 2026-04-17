-- Seed sample projects, services, task columns, and tasks for development
-- These are created in the Riftly workspace by the founder user

DO $$
DECLARE
  workspace_uuid UUID;
  founder_uuid UUID;
  employee_uuid UUID;
  client_uuid UUID;

  -- Project IDs
  project1_uuid UUID;
  project2_uuid UUID;
  project3_uuid UUID;
  project4_uuid UUID;

  -- Task column IDs
  todo_column_uuid UUID;
  in_progress_column_uuid UUID;
  in_review_column_uuid UUID;
  done_column_uuid UUID;
BEGIN
  -- Get the Riftly workspace ID
  SELECT id INTO workspace_uuid FROM workspaces WHERE slug = 'riftly';

  -- Get user IDs
  SELECT id INTO founder_uuid FROM profiles WHERE email = 'founder@riftly.com';
  SELECT id INTO employee_uuid FROM profiles WHERE email = 'employee@riftly.com';
  SELECT id INTO client_uuid FROM profiles WHERE email = 'client@riftly.com';

  -- Only seed if workspace and users exist
  IF workspace_uuid IS NOT NULL AND founder_uuid IS NOT NULL THEN

    -- ============================================
    -- SEED DEFAULT TASK COLUMNS
    -- ============================================

    INSERT INTO task_columns (id, workspace_id, name, position, created_at) VALUES
    (gen_random_uuid(), workspace_uuid, 'To Do', 1, NOW()),
    (gen_random_uuid(), workspace_uuid, 'In Progress', 2, NOW()),
    (gen_random_uuid(), workspace_uuid, 'In Review', 3, NOW()),
    (gen_random_uuid(), workspace_uuid, 'Done', 4, NOW())
    ON CONFLICT DO NOTHING;

    -- Get column IDs for task assignment
    SELECT id INTO todo_column_uuid FROM task_columns WHERE workspace_id = workspace_uuid AND name = 'To Do';
    SELECT id INTO in_progress_column_uuid FROM task_columns WHERE workspace_id = workspace_uuid AND name = 'In Progress';
    SELECT id INTO in_review_column_uuid FROM task_columns WHERE workspace_id = workspace_uuid AND name = 'In Review';
    SELECT id INTO done_column_uuid FROM task_columns WHERE workspace_id = workspace_uuid AND name = 'Done';

    -- ============================================
    -- SEED PROJECTS
    -- ============================================

    -- Project 1: Acme Corporation Website Redesign
    INSERT INTO projects (id, workspace_id, name, status, flags, created_by, created_at)
    VALUES (
      gen_random_uuid(),
      workspace_uuid,
      'Website Redesign & Development',
      'active',
      E'• Client requested additional revisions to homepage\n• Waiting on final content from their marketing team\n• Next milestone: staging site review on April 20',
      founder_uuid,
      NOW() - INTERVAL '45 days'
    )
    RETURNING id INTO project1_uuid;

    -- Services for Project 1
    INSERT INTO services (workspace_id, project_id, name, mrr, start_date, renewal_date, created_at) VALUES
    (workspace_uuid, project1_uuid, 'Website Development', 5000.00, '2026-03-01', '2026-09-01', NOW() - INTERVAL '43 days'),
    (workspace_uuid, project1_uuid, 'Ongoing Maintenance & Support', 1500.00, '2026-03-01', '2026-06-01', NOW() - INTERVAL '43 days'),
    (workspace_uuid, project1_uuid, 'SEO Optimization Package', 2000.00, '2026-03-15', '2026-06-15', NOW() - INTERVAL '29 days')
    ON CONFLICT DO NOTHING;

    -- Project 2: TechStart Mobile App
    INSERT INTO projects (id, workspace_id, name, status, flags, created_by, created_at)
    VALUES (
      gen_random_uuid(),
      workspace_uuid,
      'Delivery Platform Mobile App',
      'active',
      E'• High-priority client - responds within 24 hours\n• Possible upsell opportunity for admin dashboard\n• App store submission scheduled for May 1',
      founder_uuid,
      NOW() - INTERVAL '60 days'
    )
    RETURNING id INTO project2_uuid;

    -- Services for Project 2
    INSERT INTO services (workspace_id, project_id, name, mrr, start_date, renewal_date, created_at) VALUES
    (workspace_uuid, project2_uuid, 'iOS & Android App Development', 8000.00, '2026-02-15', '2026-08-15', NOW() - INTERVAL '57 days'),
    (workspace_uuid, project2_uuid, 'Backend API Development', 4500.00, '2026-02-15', '2026-08-15', NOW() - INTERVAL '57 days'),
    (workspace_uuid, project2_uuid, 'Post-Launch Support (3 months)', 3000.00, '2026-05-01', '2026-08-01', NOW() - INTERVAL '57 days')
    ON CONFLICT DO NOTHING;

    -- Project 3: Global Ventures E-commerce
    INSERT INTO projects (id, workspace_id, name, status, flags, created_by, created_at)
    VALUES (
      gen_random_uuid(),
      workspace_uuid,
      'Headless E-commerce Platform',
      'active',
      E'• Premium tier client - white-glove service expected\n• Product migration in progress (3000/5000 completed)\n• Weekly stakeholder meetings every Friday at 2pm',
      founder_uuid,
      NOW() - INTERVAL '30 days'
    )
    RETURNING id INTO project3_uuid;

    -- Services for Project 3
    INSERT INTO services (workspace_id, project_id, name, mrr, start_date, renewal_date, created_at) VALUES
    (workspace_uuid, project3_uuid, 'E-commerce Platform Development', 12000.00, '2026-03-15', '2026-12-15', NOW() - INTERVAL '29 days'),
    (workspace_uuid, project3_uuid, 'Product Data Migration', 5000.00, '2026-03-15', '2026-07-15', NOW() - INTERVAL '29 days'),
    (workspace_uuid, project3_uuid, 'Email Marketing Integration', 2500.00, '2026-04-01', '2026-10-01', NOW() - INTERVAL '12 days')
    ON CONFLICT DO NOTHING;

    -- Project 4: Digital Solutions SaaS Platform (Paused)
    INSERT INTO projects (id, workspace_id, name, status, flags, created_by, created_at)
    VALUES (
      gen_random_uuid(),
      workspace_uuid,
      'Enterprise Project Management SaaS',
      'paused',
      E'• Project on hold due to client budget constraints\n• Expected to resume in Q3 2026\n• 60% complete - authentication and core features done',
      founder_uuid,
      NOW() - INTERVAL '90 days'
    )
    RETURNING id INTO project4_uuid;

    -- Services for Project 4
    INSERT INTO services (workspace_id, project_id, name, mrr, start_date, renewal_date, created_at) VALUES
    (workspace_uuid, project4_uuid, 'SaaS Platform Development', 10000.00, '2026-01-15', '2026-10-15', NOW() - INTERVAL '88 days'),
    (workspace_uuid, project4_uuid, 'AWS Infrastructure Setup', 3000.00, '2026-01-15', '2026-07-15', NOW() - INTERVAL '88 days')
    ON CONFLICT DO NOTHING;

    -- ============================================
    -- SEED PROJECT MEMBERS
    -- ============================================

    -- Assign employee to projects 1, 2, and 3
    IF employee_uuid IS NOT NULL THEN
      INSERT INTO project_members (project_id, user_id, member_type, created_at) VALUES
      (project1_uuid, employee_uuid, 'employee', NOW()),
      (project2_uuid, employee_uuid, 'employee', NOW()),
      (project3_uuid, employee_uuid, 'employee', NOW())
      ON CONFLICT DO NOTHING;
    END IF;

    -- Assign client to projects 1 and 2
    IF client_uuid IS NOT NULL THEN
      INSERT INTO project_members (project_id, user_id, member_type, created_at) VALUES
      (project1_uuid, client_uuid, 'client', NOW()),
      (project2_uuid, client_uuid, 'client', NOW())
      ON CONFLICT DO NOTHING;
    END IF;

    -- ============================================
    -- SEED TASKS
    -- ============================================

    -- ============================================
    -- SEED TASKS
    -- ============================================

    -- Note: Tasks are created without assignees initially
    -- Assignees will be added via task_assignees table below

    -- Tasks for Project 1 (Acme Corporation)
    INSERT INTO tasks (workspace_id, project_id, title, description, column_id, priority, due_date, position, created_by, created_at) VALUES

    -- To Do
    (workspace_uuid, project1_uuid, 'Implement mobile navigation menu', 'Create responsive hamburger menu with smooth animations. Should support nested menu items and match the approved design system.', todo_column_uuid, 'high', CURRENT_DATE + INTERVAL '3 days', 1, founder_uuid, NOW() - INTERVAL '2 days'),
    (workspace_uuid, project1_uuid, 'Set up Google Analytics 4 tracking', 'Configure GA4 property, implement tracking code, set up custom events for key user interactions (form submissions, product views, etc.)', todo_column_uuid, 'medium', CURRENT_DATE + INTERVAL '5 days', 2, founder_uuid, NOW() - INTERVAL '1 day'),
    (workspace_uuid, project1_uuid, 'Create contact form with validation', 'Build contact form with client-side and server-side validation. Include spam protection and email notification system.', todo_column_uuid, 'medium', CURRENT_DATE + INTERVAL '7 days', 3, founder_uuid, NOW() - INTERVAL '1 day'),

    -- In Progress
    (workspace_uuid, project1_uuid, 'Optimize images for web performance', 'Convert images to WebP format, implement lazy loading, set up responsive image sizes. Target: page load under 2 seconds.', in_progress_column_uuid, 'high', CURRENT_DATE + INTERVAL '2 days', 4, founder_uuid, NOW() - INTERVAL '4 days'),
    (workspace_uuid, project1_uuid, 'Integrate with existing CRM system', 'Connect website forms to client''s Salesforce instance. Map form fields to CRM fields and test data flow.', in_progress_column_uuid, 'high', CURRENT_DATE + INTERVAL '4 days', 5, founder_uuid, NOW() - INTERVAL '6 days'),

    -- In Review
    (workspace_uuid, project1_uuid, 'Homepage redesign - first draft', 'Complete homepage layout with hero section, services overview, client testimonials, and CTA sections. Awaiting client feedback.', in_review_column_uuid, 'high', CURRENT_DATE - INTERVAL '1 day', 6, founder_uuid, NOW() - INTERVAL '8 days'),

    -- Done
    (workspace_uuid, project1_uuid, 'Set up staging environment', 'Configure staging server on AWS, set up SSL certificate, and deploy initial build for client review.', done_column_uuid, 'high', CURRENT_DATE - INTERVAL '10 days', 7, founder_uuid, NOW() - INTERVAL '15 days'),
    (workspace_uuid, project1_uuid, 'Design system documentation', 'Created comprehensive style guide with typography, color palette, component library, and usage guidelines.', done_column_uuid, 'medium', CURRENT_DATE - INTERVAL '12 days', 8, founder_uuid, NOW() - INTERVAL '20 days'),

    -- Tasks for Project 2 (TechStart Mobile App)

    -- To Do
    (workspace_uuid, project2_uuid, 'Implement push notification system', 'Set up Firebase Cloud Messaging for both iOS and Android. Create notification preferences screen and handle notification taps.', todo_column_uuid, 'high', CURRENT_DATE + INTERVAL '6 days', 9, founder_uuid, NOW() - INTERVAL '3 days'),
    (workspace_uuid, project2_uuid, 'Add in-app payment with Stripe', 'Integrate Stripe SDK for iOS and Android. Implement payment flow, handle 3D Secure, and add payment method management.', todo_column_uuid, 'high', CURRENT_DATE + INTERVAL '8 days', 10, founder_uuid, NOW() - INTERVAL '2 days'),
    (workspace_uuid, project2_uuid, 'Create app store assets and screenshots', 'Design app icons, prepare promotional screenshots for both stores, write app descriptions and keywords for ASO.', todo_column_uuid, 'medium', CURRENT_DATE + INTERVAL '15 days', 11, founder_uuid, NOW() - INTERVAL '1 day'),

    -- In Progress
    (workspace_uuid, project2_uuid, 'Build real-time GPS tracking feature', 'Implement live location tracking for delivery drivers. Show real-time updates on customer app with ETA calculations.', in_progress_column_uuid, 'high', CURRENT_DATE + INTERVAL '5 days', 12, founder_uuid, NOW() - INTERVAL '7 days'),
    (workspace_uuid, project2_uuid, 'Develop rating and review system', 'Allow customers to rate deliveries and leave reviews. Include moderation tools in admin panel.', in_progress_column_uuid, 'medium', CURRENT_DATE + INTERVAL '10 days', 13, founder_uuid, NOW() - INTERVAL '5 days'),

    -- In Review
    (workspace_uuid, project2_uuid, 'User authentication flow', 'Completed phone number verification, social login (Google/Apple), and biometric authentication. Pending security review.', in_review_column_uuid, 'high', CURRENT_DATE, 14, founder_uuid, NOW() - INTERVAL '10 days'),

    -- Done
    (workspace_uuid, project2_uuid, 'Backend API architecture setup', 'Set up Node.js backend with Express, PostgreSQL database, Redis caching, and JWT authentication.', done_column_uuid, 'high', CURRENT_DATE - INTERVAL '30 days', 15, founder_uuid, NOW() - INTERVAL '45 days'),
    (workspace_uuid, project2_uuid, 'UI/UX design and prototyping', 'Created high-fidelity mockups in Figma for all app screens. Client approved final designs.', done_column_uuid, 'high', CURRENT_DATE - INTERVAL '35 days', 16, founder_uuid, NOW() - INTERVAL '50 days'),

    -- Tasks for Project 3 (Global Ventures E-commerce)

    -- To Do
    (workspace_uuid, project3_uuid, 'Build customer loyalty program', 'Implement points-based rewards system. Customers earn points on purchases and can redeem for discounts.', todo_column_uuid, 'medium', CURRENT_DATE + INTERVAL '20 days', 17, founder_uuid, NOW() - INTERVAL '4 days'),
    (workspace_uuid, project3_uuid, 'Set up email marketing automation', 'Configure abandoned cart emails, order confirmations, shipping updates, and promotional campaign workflows.', todo_column_uuid, 'medium', CURRENT_DATE + INTERVAL '12 days', 18, founder_uuid, NOW() - INTERVAL '2 days'),

    -- In Progress
    (workspace_uuid, project3_uuid, 'Product data migration (Phase 2)', 'Continue migrating remaining 2000 products from legacy system. Includes images, variants, pricing, and inventory data.', in_progress_column_uuid, 'high', CURRENT_DATE + INTERVAL '10 days', 19, founder_uuid, NOW() - INTERVAL '15 days'),
    (workspace_uuid, project3_uuid, 'Multi-currency payment gateway setup', 'Integrate Stripe for international payments. Support USD, EUR, GBP with automatic currency conversion.', in_progress_column_uuid, 'high', CURRENT_DATE + INTERVAL '8 days', 20, founder_uuid, NOW() - INTERVAL '8 days'),
    (workspace_uuid, project3_uuid, 'Advanced product filtering system', 'Build faceted search with filters for category, price range, brand, ratings, and custom attributes.', in_progress_column_uuid, 'medium', CURRENT_DATE + INTERVAL '14 days', 21, founder_uuid, NOW() - INTERVAL '6 days'),

    -- Done
    (workspace_uuid, project3_uuid, 'Headless CMS setup with Next.js', 'Configured Next.js 14 with App Router, integrated Shopify Storefront API, set up ISR for product pages.', done_column_uuid, 'high', CURRENT_DATE - INTERVAL '15 days', 22, founder_uuid, NOW() - INTERVAL '25 days'),
    (workspace_uuid, project3_uuid, 'Inventory management system', 'Built real-time inventory tracking with low-stock alerts and automated reordering triggers.', done_column_uuid, 'high', CURRENT_DATE - INTERVAL '10 days', 23, founder_uuid, NOW() - INTERVAL '18 days'),

    -- Tasks for Project 4 (Digital Solutions - Paused Project)

    -- To Do (when resumed)
    (workspace_uuid, project4_uuid, 'Implement Gantt chart view', 'Build interactive Gantt chart for project timeline visualization. Allow drag-and-drop to adjust dates.', todo_column_uuid, 'low', NULL, 24, founder_uuid, NOW() - INTERVAL '30 days'),
    (workspace_uuid, project4_uuid, 'Resource allocation dashboard', 'Create overview of team member assignments and workload. Show capacity planning and availability.', todo_column_uuid, 'low', NULL, 25, founder_uuid, NOW() - INTERVAL '30 days'),

    -- Done (before pause)
    (workspace_uuid, project4_uuid, 'Multi-tenant architecture setup', 'Implemented tenant isolation, separate databases per client, and automated tenant provisioning.', done_column_uuid, 'high', CURRENT_DATE - INTERVAL '60 days', 26, founder_uuid, NOW() - INTERVAL '75 days'),
    (workspace_uuid, project4_uuid, 'User authentication and RBAC', 'Built role-based access control system with custom permissions per tenant. Supports SSO integration.', done_column_uuid, 'high', CURRENT_DATE - INTERVAL '55 days', 27, founder_uuid, NOW() - INTERVAL '70 days')

    ON CONFLICT DO NOTHING;

    -- ============================================
    -- SEED TASK ASSIGNEES
    -- ============================================

    -- Get task IDs for assignment
    -- We'll assign tasks to demonstrate single and multi-assignee scenarios

    -- Assign some tasks to founder only
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t.id, founder_uuid
    FROM tasks t
    WHERE t.workspace_id = workspace_uuid
      AND t.title IN (
        'Implement mobile navigation menu',
        'Optimize images for web performance',
        'Homepage redesign - first draft',
        'Implement push notification system',
        'Build real-time GPS tracking feature',
        'User authentication flow',
        'Multi-currency payment gateway setup',
        'Multi-tenant architecture setup',
        'User authentication and RBAC'
      )
    ON CONFLICT DO NOTHING;

    -- Assign some tasks to employee only
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t.id, employee_uuid
    FROM tasks t
    WHERE t.workspace_id = workspace_uuid
      AND employee_uuid IS NOT NULL
      AND t.title IN (
        'Set up Google Analytics 4 tracking',
        'Integrate with existing CRM system',
        'Add in-app payment with Stripe',
        'Develop rating and review system',
        'Inventory management system'
      )
    ON CONFLICT DO NOTHING;

    -- Assign some tasks to both founder and employee (multi-assignee)
    INSERT INTO task_assignees (task_id, user_id)
    SELECT t.id, founder_uuid
    FROM tasks t
    WHERE t.workspace_id = workspace_uuid
      AND t.title IN (
        'Product data migration (Phase 2)',
        'Advanced product filtering system',
        'Set up email marketing automation'
      )
    ON CONFLICT DO NOTHING;

    INSERT INTO task_assignees (task_id, user_id)
    SELECT t.id, employee_uuid
    FROM tasks t
    WHERE t.workspace_id = workspace_uuid
      AND employee_uuid IS NOT NULL
      AND t.title IN (
        'Product data migration (Phase 2)',
        'Advanced product filtering system',
        'Set up email marketing automation'
      )
    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Seeded 4 projects with services, 4 task columns, 27 tasks, and task assignments';
  ELSE
    RAISE NOTICE 'Workspace or users not found, skipping projects and tasks seed';
  END IF;
END $$;
