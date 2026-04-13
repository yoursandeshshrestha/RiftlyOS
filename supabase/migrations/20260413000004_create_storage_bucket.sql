-- Create storage bucket for workspace logos
INSERT INTO storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
VALUES (
  'workspace-logos',
  'workspace-logos',
  true,
  5242880, -- 5MB limit
  ARRAY['image/png', 'image/jpeg', 'image/jpg', 'image/webp', 'image/gif']
)
ON CONFLICT (id) DO NOTHING;

-- Note: RLS is already enabled on storage.objects by default

-- Drop existing policies if they exist
DROP POLICY IF EXISTS "Public Access for Workspace Logos" ON storage.objects;
DROP POLICY IF EXISTS "Authenticated users can upload workspace logos" ON storage.objects;
DROP POLICY IF EXISTS "Users can update workspace logos" ON storage.objects;
DROP POLICY IF EXISTS "Workspace owners can delete logos" ON storage.objects;

-- Policy: Anyone can view workspace logos (public read)
CREATE POLICY "Public Access for Workspace Logos"
ON storage.objects FOR SELECT
TO public
USING (bucket_id = 'workspace-logos');

-- Policy: Authenticated users can upload workspace logos
CREATE POLICY "Authenticated users can upload workspace logos"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'workspace-logos'
  AND auth.uid() IS NOT NULL
);

-- Policy: Users can update their own workspace logos
CREATE POLICY "Users can update workspace logos"
ON storage.objects FOR UPDATE
TO authenticated
USING (
  bucket_id = 'workspace-logos'
  AND auth.uid() IS NOT NULL
);

-- Policy: Workspace owners can delete their workspace logos
CREATE POLICY "Workspace owners can delete logos"
ON storage.objects FOR DELETE
TO authenticated
USING (
  bucket_id = 'workspace-logos'
  AND auth.uid() IS NOT NULL
);
