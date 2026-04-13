-- Seed sample deals for development
-- These deals are created in the Riftly workspace by the founder user

DO $$
DECLARE
  workspace_uuid UUID;
  founder_uuid UUID;
BEGIN
  -- Get the Riftly workspace ID
  SELECT id INTO workspace_uuid FROM workspaces WHERE slug = 'riftly';

  -- Get the founder user ID
  SELECT id INTO founder_uuid FROM profiles WHERE email = 'founder@riftly.com';

  -- Only seed if workspace and founder exist
  IF workspace_uuid IS NOT NULL AND founder_uuid IS NOT NULL THEN

    -- Insert sample deals across different stages
    INSERT INTO deals (workspace_id, prospect_name, services, deal_value, stage, next_action, position, created_by, created_at) VALUES

    -- Lead stage deals
    (workspace_uuid, 'Acme Corporation', 'Complete website redesign with modern UI/UX, including responsive design for mobile and tablet devices. Integration with existing CRM system, custom admin dashboard, and comprehensive analytics tracking. Project includes brand refresh, content strategy, and SEO optimization.', 45000, 'lead', 'Schedule discovery call', 1, founder_uuid, NOW() - INTERVAL '5 days'),
    (workspace_uuid, 'TechStart Inc', 'Native iOS and Android mobile application development for their delivery service platform. Features include real-time GPS tracking, push notifications, in-app payments via Stripe, user authentication, rating system, and admin panel for order management. Includes app store deployment and 3 months post-launch support.', 75000, 'lead', 'Send company portfolio', 2, founder_uuid, NOW() - INTERVAL '3 days'),
    (workspace_uuid, 'Global Ventures', 'Full-scale e-commerce platform built on modern headless architecture with Next.js and Shopify. Custom payment gateway integration supporting multiple currencies, inventory management system, automated email marketing workflows, customer loyalty program, and advanced product filtering. Migration of 5000+ existing products from legacy system.', 120000, 'lead', 'Prepare initial proposal', 3, founder_uuid, NOW() - INTERVAL '1 day'),

    -- Proposal sent stage deals
    (workspace_uuid, 'Digital Solutions Ltd', 'Enterprise-grade SaaS platform for project management with multi-tenant architecture. Features include team collaboration tools, time tracking, Gantt charts, resource allocation, custom reporting dashboards, API for third-party integrations, and role-based access control. Built with React, Node.js, PostgreSQL, and deployed on AWS with auto-scaling capabilities.', 95000, 'proposal_sent', 'Follow up on proposal', 4, founder_uuid, NOW() - INTERVAL '10 days'),
    (workspace_uuid, 'Innovation Hub', 'Custom CRM system tailored for their sales team with lead scoring, pipeline management, email automation, and integration with their existing tools (Slack, Google Workspace, Zoom). Includes data migration from Salesforce, custom reporting engine, mobile app for field sales, and comprehensive training for 50+ users.', 60000, 'proposal_sent', 'Schedule demo presentation', 5, founder_uuid, NOW() - INTERVAL '7 days'),

    -- Negotiation stage deals
    (workspace_uuid, 'Enterprise Group', 'Executive dashboard with real-time analytics, KPI tracking across multiple departments, predictive analytics using machine learning, custom data visualization, and integration with 10+ data sources including SAP, Oracle, and various APIs. Includes data warehouse setup, ETL pipeline development, and ongoing data science consulting for 6 months.', 150000, 'negotiation', 'Finalize contract terms', 6, founder_uuid, NOW() - INTERVAL '15 days'),
    (workspace_uuid, 'StartupXYZ', 'MVP development for their innovative fintech platform including user onboarding, KYC verification, secure transaction processing, wallet management, and compliance features. Cloud infrastructure setup on AWS with security best practices, CI/CD pipeline, monitoring and logging, database optimization, and scalability planning for 100k users.', 85000, 'negotiation', 'Review revised budget', 7, founder_uuid, NOW() - INTERVAL '12 days'),
    (workspace_uuid, 'MarketLeaders Co', 'Comprehensive marketing automation platform with email campaign builder, A/B testing, customer segmentation, behavioral triggers, social media scheduling, landing page builder, analytics dashboard, and CRM integration. Includes custom template design, workflow automation for 20+ campaigns, and integration with their existing MarTech stack.', 110000, 'negotiation', 'Send updated timeline', 8, founder_uuid, NOW() - INTERVAL '8 days'),

    -- Closed won stage deals
    (workspace_uuid, 'Success Stories Inc', 'Full-stack web application development with React frontend, Node.js backend, PostgreSQL database, Redis caching, and microservices architecture. Complete DevOps setup including Docker containerization, Kubernetes orchestration, CI/CD pipelines with GitHub Actions, automated testing, monitoring with Datadog, and comprehensive documentation.', 130000, 'closed_won', NULL, 9, founder_uuid, NOW() - INTERVAL '30 days'),
    (workspace_uuid, 'WinTech Solutions', 'RESTful API development with comprehensive documentation, authentication and authorization using OAuth 2.0, rate limiting, versioning strategy, webhook support, and SDK development for JavaScript and Python. Includes API gateway setup, load balancing, detailed OpenAPI/Swagger documentation, and interactive developer portal.', 55000, 'closed_won', NULL, 10, founder_uuid, NOW() - INTERVAL '25 days'),

    -- Closed lost stage deals
    (workspace_uuid, 'Budget Constraints LLC', 'Corporate website redesign with modern aesthetic, improved navigation structure, contact forms, blog platform, and basic SEO. Responsive design for all devices, integration with Google Analytics, and content management system for easy updates. Lost due to budget limitations and timeline requirements.', 35000, 'closed_lost', NULL, 11, founder_uuid, NOW() - INTERVAL '20 days'),
    (workspace_uuid, 'Competitor Choice Corp', 'Cross-platform mobile application with React Native, including user profiles, real-time chat functionality, push notifications, offline mode support, and backend API with Node.js and MongoDB. Features social authentication, image upload and processing, and comprehensive admin dashboard. Lost to competing agency with lower pricing.', 90000, 'closed_lost', NULL, 12, founder_uuid, NOW() - INTERVAL '18 days')

    ON CONFLICT DO NOTHING;

    RAISE NOTICE 'Seeded 12 sample deals across all stages';
  ELSE
    RAISE NOTICE 'Workspace or founder not found, skipping deals seed';
  END IF;
END $$;
