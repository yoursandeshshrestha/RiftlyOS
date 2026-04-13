-- Enable required extensions
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- Create workspace role enum
CREATE TYPE workspace_role AS ENUM ('owner', 'employee', 'client');

-- Create profiles table
CREATE TABLE IF NOT EXISTS profiles (
  id UUID PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  email TEXT UNIQUE NOT NULL,
  full_name TEXT NOT NULL,
  avatar_url TEXT,
  theme TEXT DEFAULT 'system' CHECK (theme IN ('light', 'dark', 'system')),
  onboarding_completed BOOLEAN DEFAULT false,
  last_accessed_workspace_id UUID,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create workspaces table
CREATE TABLE IF NOT EXISTS workspaces (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  slug TEXT UNIQUE NOT NULL,
  logo_url TEXT,
  invite_code TEXT UNIQUE NOT NULL DEFAULT encode(extensions.gen_random_bytes(6), 'hex'),
  created_by UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  updated_at TIMESTAMPTZ DEFAULT NOW() NOT NULL
);

-- Create workspace_members table
CREATE TABLE IF NOT EXISTS workspace_members (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id UUID NOT NULL REFERENCES workspaces(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  role workspace_role NOT NULL DEFAULT 'employee',
  invited_by UUID REFERENCES profiles(id),
  joined_at TIMESTAMPTZ DEFAULT NOW() NOT NULL,
  UNIQUE(workspace_id, user_id)
);

-- Add foreign key for last_accessed_workspace_id
ALTER TABLE profiles
  ADD CONSTRAINT profiles_last_accessed_workspace_fkey
  FOREIGN KEY (last_accessed_workspace_id)
  REFERENCES workspaces(id) ON DELETE SET NULL;

-- Create indexes
CREATE INDEX IF NOT EXISTS profiles_email_idx ON profiles(email);
CREATE INDEX IF NOT EXISTS profiles_last_accessed_workspace_idx ON profiles(last_accessed_workspace_id);
CREATE INDEX IF NOT EXISTS workspaces_created_by_idx ON workspaces(created_by);
CREATE INDEX IF NOT EXISTS workspaces_slug_idx ON workspaces(slug);
CREATE INDEX IF NOT EXISTS workspaces_invite_code_idx ON workspaces(invite_code);
CREATE INDEX IF NOT EXISTS workspace_members_workspace_id_idx ON workspace_members(workspace_id);
CREATE INDEX IF NOT EXISTS workspace_members_user_id_idx ON workspace_members(user_id);

-- Enable Row Level Security
ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspaces ENABLE ROW LEVEL SECURITY;
ALTER TABLE workspace_members ENABLE ROW LEVEL SECURITY;

-- RLS Policies for profiles
CREATE POLICY "Users can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Users can update their own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

-- Create helper functions to avoid RLS infinite recursion
CREATE OR REPLACE FUNCTION is_workspace_member(workspace_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = workspace_uuid AND user_id = user_uuid
  );
END;
$$;

CREATE OR REPLACE FUNCTION is_workspace_admin(workspace_uuid UUID, user_uuid UUID)
RETURNS BOOLEAN
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  RETURN EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = workspace_uuid
    AND user_id = user_uuid
    AND role = 'owner'
  );
END;
$$;

-- RLS Policies for workspaces
CREATE POLICY "Users can view workspaces they are members of"
  ON workspaces FOR SELECT
  TO authenticated
  USING (is_workspace_member(id, auth.uid()));

CREATE POLICY "Users can create workspaces"
  ON workspaces FOR INSERT
  TO authenticated
  WITH CHECK (created_by = auth.uid());

CREATE POLICY "Workspace owners can update their workspaces"
  ON workspaces FOR UPDATE
  TO authenticated
  USING (is_workspace_admin(id, auth.uid()));

-- RLS Policies for workspace_members
CREATE POLICY "Users can view members of their workspaces"
  ON workspace_members FOR SELECT
  TO authenticated
  USING (is_workspace_member(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can add members"
  ON workspace_members FOR INSERT
  TO authenticated
  WITH CHECK (is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can update members"
  ON workspace_members FOR UPDATE
  TO authenticated
  USING (is_workspace_admin(workspace_id, auth.uid()));

CREATE POLICY "Workspace owners can remove members"
  ON workspace_members FOR DELETE
  TO authenticated
  USING (is_workspace_admin(workspace_id, auth.uid()));

-- Create function to handle new user registration
CREATE OR REPLACE FUNCTION public.handle_new_user()
RETURNS TRIGGER
SECURITY DEFINER
SET search_path = public
LANGUAGE plpgsql
AS $$
BEGIN
  INSERT INTO public.profiles (id, email, full_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'full_name', split_part(NEW.email, '@', 1))
  );
  RETURN NEW;
EXCEPTION
  WHEN others THEN
    RAISE LOG 'Error in handle_new_user: %', SQLERRM;
    RETURN NEW;
END;
$$;

-- Create trigger for automatic profile creation
DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_new_user();

-- Create function to automatically update updated_at
CREATE OR REPLACE FUNCTION public.handle_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = NOW();
  RETURN NEW;
END;
$$;

-- Create trigger for profiles updated_at
DROP TRIGGER IF EXISTS set_updated_at ON profiles;
CREATE TRIGGER set_updated_at
  BEFORE UPDATE ON profiles
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Create trigger for workspaces updated_at
DROP TRIGGER IF EXISTS set_workspace_updated_at ON workspaces;
CREATE TRIGGER set_workspace_updated_at
  BEFORE UPDATE ON workspaces
  FOR EACH ROW
  EXECUTE FUNCTION public.handle_updated_at();

-- Function to create workspace and add creator as owner
CREATE OR REPLACE FUNCTION create_workspace(
  workspace_name TEXT,
  workspace_slug TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  new_workspace_id UUID;
BEGIN
  -- Create workspace
  INSERT INTO workspaces (name, slug, created_by)
  VALUES (workspace_name, workspace_slug, auth.uid())
  RETURNING id INTO new_workspace_id;

  -- Add creator as owner
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (new_workspace_id, auth.uid(), 'owner');

  -- Update user's last accessed workspace
  UPDATE profiles
  SET last_accessed_workspace_id = new_workspace_id,
      onboarding_completed = true
  WHERE id = auth.uid();

  RETURN new_workspace_id;
END;
$$;

-- Function to join workspace with invite code
CREATE OR REPLACE FUNCTION join_workspace(
  invite_code_input TEXT
)
RETURNS UUID
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  target_workspace_id UUID;
  user_already_member BOOLEAN;
BEGIN
  -- Find workspace by invite code
  SELECT id INTO target_workspace_id
  FROM workspaces
  WHERE invite_code = invite_code_input;

  IF target_workspace_id IS NULL THEN
    RAISE EXCEPTION 'Invalid invite code';
  END IF;

  -- Check if user is already a member
  SELECT EXISTS (
    SELECT 1 FROM workspace_members
    WHERE workspace_id = target_workspace_id AND user_id = auth.uid()
  ) INTO user_already_member;

  IF user_already_member THEN
    RAISE EXCEPTION 'You are already a member of this workspace';
  END IF;

  -- Add user as member
  INSERT INTO workspace_members (workspace_id, user_id, role)
  VALUES (target_workspace_id, auth.uid(), 'member');

  -- Update user's last accessed workspace and mark onboarding complete
  UPDATE profiles
  SET last_accessed_workspace_id = target_workspace_id,
      onboarding_completed = true
  WHERE id = auth.uid();

  RETURN target_workspace_id;
END;
$$;
