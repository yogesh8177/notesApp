-- =============================================================================
-- Supabase Storage bucket + RLS policies for the `notes-files` bucket.
--
-- Layout: each object is keyed `${orgId}/${fileId}/${fileName}` so we can use
-- the first path segment to enforce org membership.
--
-- The files module agent owns upload/download flow. This sets the storage
-- substrate so they can't accidentally make the bucket public.
-- =============================================================================

INSERT INTO storage.buckets (id, name, public)
VALUES ('notes-files', 'notes-files', false)
ON CONFLICT (id) DO UPDATE SET public = false;

-- Helper: extract org id from object name.
CREATE OR REPLACE FUNCTION private.storage_object_org_id(p_name text)
RETURNS uuid
LANGUAGE sql IMMUTABLE
AS $$
  SELECT (string_to_array(p_name, '/'))[1]::uuid;
$$;

-- Read: any org member can read; downstream signed-URL flow further narrows
-- to specific note permissions in app code.
CREATE POLICY "notes-files read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'notes-files'
    AND private.is_org_member(private.storage_object_org_id(name))
  );

-- Write: must be a member; the app layer enforces note-level write.
CREATE POLICY "notes-files insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'notes-files'
    AND private.has_org_role(private.storage_object_org_id(name), 'member')
  );

CREATE POLICY "notes-files delete" ON storage.objects
  FOR DELETE TO authenticated
  USING (
    bucket_id = 'notes-files'
    AND (
      owner = auth.uid()
      OR private.has_org_role(private.storage_object_org_id(name), 'admin')
    )
  );
