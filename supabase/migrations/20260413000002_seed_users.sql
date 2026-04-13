-- Seed data for development
-- Create test users with profiles and default workspace

-- Ensure pgcrypto extension is available
CREATE EXTENSION IF NOT EXISTS pgcrypto WITH SCHEMA extensions;

-- Create a function to safely create test users
CREATE OR REPLACE FUNCTION create_test_user(
  user_email TEXT,
  user_password TEXT,
  user_full_name TEXT
) RETURNS UUID AS $$
DECLARE
  new_user_id UUID;
  user_exists BOOLEAN;
BEGIN
  -- Check if user already exists
  SELECT EXISTS (
    SELECT 1 FROM auth.users WHERE email = user_email
  ) INTO user_exists;

  IF user_exists THEN
    RAISE NOTICE 'User % already exists, skipping', user_email;
    SELECT id INTO new_user_id FROM auth.users WHERE email = user_email;
    RETURN new_user_id;
  END IF;

  -- Generate new user ID
  new_user_id := gen_random_uuid();

  -- Create user in auth.users
  INSERT INTO auth.users (
    instance_id,
    id,
    aud,
    role,
    email,
    encrypted_password,
    email_confirmed_at,
    raw_app_meta_data,
    raw_user_meta_data,
    created_at,
    updated_at,
    confirmation_token,
    email_change,
    email_change_token_new,
    recovery_token
  ) VALUES (
    '00000000-0000-0000-0000-000000000000',
    new_user_id,
    'authenticated',
    'authenticated',
    user_email,
    extensions.crypt(user_password, extensions.gen_salt('bf')),
    NOW(),
    '{"provider":"email","providers":["email"]}'::jsonb,
    jsonb_build_object('full_name', user_full_name),
    NOW(),
    NOW(),
    '',
    '',
    '',
    ''
  );

  -- Create identity for email auth
  INSERT INTO auth.identities (
    provider_id,
    user_id,
    identity_data,
    provider,
    last_sign_in_at,
    created_at,
    updated_at
  ) VALUES (
    new_user_id::text,
    new_user_id,
    jsonb_build_object('sub', new_user_id::text, 'email', user_email),
    'email',
    NOW(),
    NOW(),
    NOW()
  );

  RETURN new_user_id;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, extensions;

-- Seed the three users
DO $$
DECLARE
  founder_id UUID;
  client_id UUID;
  employee_id UUID;
  new_workspace_id UUID;
BEGIN
  -- Create users
  SELECT create_test_user('founder@riftly.com', 'founder123', 'Founder User') INTO founder_id;
  SELECT create_test_user('client@riftly.com', 'client123', 'Client User') INTO client_id;
  SELECT create_test_user('employee@riftly.com', 'employee123', 'Employee User') INTO employee_id;

  -- Create Riftly workspace
  INSERT INTO workspaces (name, slug, created_by, invite_code)
  VALUES ('Riftly', 'riftly', founder_id, 'riftly2024')
  ON CONFLICT (slug) DO NOTHING
  RETURNING id INTO new_workspace_id;

  -- If workspace already exists, get its ID
  IF new_workspace_id IS NULL THEN
    SELECT id INTO new_workspace_id FROM workspaces WHERE slug = 'riftly';
  END IF;

  -- Add founder as owner
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, founder_id, 'owner')
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- Add other users
  INSERT INTO workspace_members (workspace_id, user_id, role, invited_by)
  VALUES
    (new_workspace_id, client_id, 'client', founder_id),
    (new_workspace_id, employee_id, 'employee', founder_id)
  ON CONFLICT (workspace_id, user_id) DO NOTHING;

  -- Mark all users as onboarding complete
  UPDATE profiles
  SET
    onboarding_completed = true,
    last_accessed_workspace_id = new_workspace_id
  WHERE id IN (founder_id, client_id, employee_id);

  RAISE NOTICE 'Seeded 3 users and created Riftly workspace';
END $$;

-- Drop the function after use
DROP FUNCTION IF EXISTS create_test_user;
