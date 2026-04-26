-- =============================================================================
-- Row-Level Security policies + helper functions.
--
-- Defense in depth: every query made via the Supabase anon/authed client is
-- subject to these policies. Service-role client bypasses RLS — only used in
-- trusted server code (migrations, seeds, audit log writes, AI background work).
--
-- Helper functions live in `private` schema so they can't be called from
-- client code directly.
-- =============================================================================

CREATE SCHEMA IF NOT EXISTS private;

-- -----------------------------------------------------------------------------
-- Helper: is the current auth.uid() a member of this org?
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.is_org_member(p_org_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.memberships
    WHERE org_id = p_org_id
      AND user_id = auth.uid()
  );
$$;

-- -----------------------------------------------------------------------------
-- Helper: does the current user have at least the given role in the org?
-- Role ranking: viewer < member < admin < owner.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.has_org_role(p_org_id uuid, p_min_role text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
DECLARE
  user_rank int;
  required_rank int;
BEGIN
  SELECT
    CASE role::text
      WHEN 'owner' THEN 4
      WHEN 'admin' THEN 3
      WHEN 'member' THEN 2
      WHEN 'viewer' THEN 1
      ELSE 0
    END
  INTO user_rank
  FROM public.memberships
  WHERE org_id = p_org_id AND user_id = auth.uid();

  required_rank := CASE p_min_role
    WHEN 'owner' THEN 4
    WHEN 'admin' THEN 3
    WHEN 'member' THEN 2
    WHEN 'viewer' THEN 1
    ELSE 0
  END;

  RETURN COALESCE(user_rank, 0) >= required_rank;
END;
$$;

-- -----------------------------------------------------------------------------
-- Helper: can current user read a note?
-- Returns true if:
--   - private + author = current user, OR
--   - org + member of note's org, OR
--   - shared + a row in note_shares for current user, OR
--   - admin/owner of note's org (override).
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_read_note(p_note_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = p_note_id
      AND n.deleted_at IS NULL
      AND (
        (n.visibility = 'private' AND n.author_id = auth.uid())
        OR (n.visibility = 'org' AND private.is_org_member(n.org_id))
        OR (n.visibility = 'shared' AND (
              n.author_id = auth.uid()
              OR EXISTS (SELECT 1 FROM public.note_shares s
                         WHERE s.note_id = n.id AND s.shared_with_user_id = auth.uid())
              OR private.has_org_role(n.org_id, 'admin')
        ))
        OR private.has_org_role(n.org_id, 'admin')
      )
  );
$$;

-- -----------------------------------------------------------------------------
-- Helper: can current user write (edit) a note?
--   - author OR
--   - share with edit permission OR
--   - org admin/owner.
-- Viewers (including org viewers) get NO write even on org-visible notes.
-- -----------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION private.can_write_note(p_note_id uuid)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
SET search_path = ''
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.notes n
    WHERE n.id = p_note_id
      AND n.deleted_at IS NULL
      AND (
        n.author_id = auth.uid()
        OR EXISTS (
          SELECT 1 FROM public.note_shares s
          WHERE s.note_id = n.id
            AND s.shared_with_user_id = auth.uid()
            AND s.permission = 'edit'
        )
        OR private.has_org_role(n.org_id, 'admin')
      )
  );
$$;

-- =============================================================================
-- Enable RLS
-- =============================================================================
ALTER TABLE public.users           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.orgs            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.memberships     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.org_invites     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.notes           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_versions   ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_shares     ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tags            ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.note_tags       ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.files           ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.ai_summaries    ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.audit_log       ENABLE ROW LEVEL SECURITY;

-- =============================================================================
-- Policies — each table gets minimal, explicit policies.
-- We use FOR SELECT/INSERT/UPDATE/DELETE separately so denials are obvious.
-- =============================================================================

-- users: a user sees their own profile + profiles of co-org members.
CREATE POLICY users_self_or_coorg ON public.users
  FOR SELECT TO authenticated
  USING (
    id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.memberships m1
      JOIN public.memberships m2 ON m1.org_id = m2.org_id
      WHERE m1.user_id = auth.uid()
        AND m2.user_id = public.users.id
    )
  );

CREATE POLICY users_self_update ON public.users
  FOR UPDATE TO authenticated
  USING (id = auth.uid())
  WITH CHECK (id = auth.uid());

-- orgs: members can SELECT their orgs. INSERT is via server action (service role).
CREATE POLICY orgs_member_read ON public.orgs
  FOR SELECT TO authenticated
  USING (private.is_org_member(id));

CREATE POLICY orgs_admin_update ON public.orgs
  FOR UPDATE TO authenticated
  USING (private.has_org_role(id, 'admin'))
  WITH CHECK (private.has_org_role(id, 'admin'));

-- memberships: members see their org's memberships; admins manage them.
CREATE POLICY memberships_member_read ON public.memberships
  FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));

CREATE POLICY memberships_admin_write ON public.memberships
  FOR ALL TO authenticated
  USING (private.has_org_role(org_id, 'admin'))
  WITH CHECK (private.has_org_role(org_id, 'admin'));

-- org_invites: only admins.
CREATE POLICY invites_admin_all ON public.org_invites
  FOR ALL TO authenticated
  USING (private.has_org_role(org_id, 'admin'))
  WITH CHECK (private.has_org_role(org_id, 'admin'));

-- notes: read via can_read_note; write via can_write_note; insert requires
-- membership in target org and author = self.
CREATE POLICY notes_select ON public.notes
  FOR SELECT TO authenticated
  USING (deleted_at IS NULL AND private.can_read_note(id));

CREATE POLICY notes_insert ON public.notes
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_org_role(org_id, 'member')
    AND author_id = auth.uid()
  );

CREATE POLICY notes_update ON public.notes
  FOR UPDATE TO authenticated
  USING (private.can_write_note(id))
  WITH CHECK (private.can_write_note(id));

CREATE POLICY notes_delete ON public.notes
  FOR DELETE TO authenticated
  USING (
    author_id = auth.uid() OR private.has_org_role(org_id, 'admin')
  );

-- note_versions: read iff you can read the parent note. Writes happen via
-- service role (notes-core writes versions on every mutation; trusted code).
CREATE POLICY note_versions_select ON public.note_versions
  FOR SELECT TO authenticated
  USING (private.can_read_note(note_id));

-- note_shares: read iff member of note's org or shared-with user; write iff
-- can_write_note (so author/admin/edit-shared can re-share within bounds).
CREATE POLICY note_shares_select ON public.note_shares
  FOR SELECT TO authenticated
  USING (
    shared_with_user_id = auth.uid()
    OR EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_shares.note_id
        AND (n.author_id = auth.uid() OR private.has_org_role(n.org_id, 'admin'))
    )
  );

CREATE POLICY note_shares_write ON public.note_shares
  FOR ALL TO authenticated
  USING (
    EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_shares.note_id
        AND (n.author_id = auth.uid() OR private.has_org_role(n.org_id, 'admin'))
    )
  )
  WITH CHECK (
    EXISTS (
      SELECT 1 FROM public.notes n
      WHERE n.id = note_shares.note_id
        AND (n.author_id = auth.uid() OR private.has_org_role(n.org_id, 'admin'))
    )
  );

-- tags: read by org members; write by members (auto-create on note save).
CREATE POLICY tags_member_select ON public.tags
  FOR SELECT TO authenticated
  USING (private.is_org_member(org_id));

CREATE POLICY tags_member_write ON public.tags
  FOR ALL TO authenticated
  USING (private.has_org_role(org_id, 'member'))
  WITH CHECK (private.has_org_role(org_id, 'member'));

-- note_tags: link table; mirror parent note's permissions.
CREATE POLICY note_tags_select ON public.note_tags
  FOR SELECT TO authenticated
  USING (private.can_read_note(note_id));

CREATE POLICY note_tags_write ON public.note_tags
  FOR ALL TO authenticated
  USING (private.can_write_note(note_id))
  WITH CHECK (private.can_write_note(note_id));

-- files: org members can list files in the org; reading bytes goes through
-- Supabase Storage (bucket policies set separately). Note-attached files
-- additionally require can_read_note for the parent.
CREATE POLICY files_select ON public.files
  FOR SELECT TO authenticated
  USING (
    deleted_at IS NULL
    AND private.is_org_member(org_id)
    AND (note_id IS NULL OR private.can_read_note(note_id))
  );

CREATE POLICY files_insert ON public.files
  FOR INSERT TO authenticated
  WITH CHECK (
    private.has_org_role(org_id, 'member')
    AND uploaded_by = auth.uid()
    AND (note_id IS NULL OR private.can_write_note(note_id))
  );

CREATE POLICY files_delete ON public.files
  FOR DELETE TO authenticated
  USING (
    uploaded_by = auth.uid() OR private.has_org_role(org_id, 'admin')
  );

-- ai_summaries: read iff you can read the underlying note. Writes via service
-- role from the AI worker.
CREATE POLICY ai_summaries_select ON public.ai_summaries
  FOR SELECT TO authenticated
  USING (private.can_read_note(note_id));

CREATE POLICY ai_summaries_accept ON public.ai_summaries
  FOR UPDATE TO authenticated
  USING (private.can_write_note(note_id))
  WITH CHECK (private.can_write_note(note_id));

-- audit_log: members can read their org's audit; nobody writes from a client.
CREATE POLICY audit_member_read ON public.audit_log
  FOR SELECT TO authenticated
  USING (
    org_id IS NOT NULL AND private.has_org_role(org_id, 'admin')
  );

-- =============================================================================
-- Trigger: when a new auth.users row appears, create a public.users row.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.handle_new_auth_user()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
BEGIN
  INSERT INTO public.users (id, email, display_name)
  VALUES (
    NEW.id,
    NEW.email,
    COALESCE(NEW.raw_user_meta_data->>'display_name', split_part(NEW.email, '@', 1))
  )
  ON CONFLICT (id) DO NOTHING;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS on_auth_user_created ON auth.users;
CREATE TRIGGER on_auth_user_created
  AFTER INSERT ON auth.users
  FOR EACH ROW EXECUTE FUNCTION public.handle_new_auth_user();

-- =============================================================================
-- Trigger: keep `updated_at` fresh on notes, orgs, users, ai_summaries.
-- =============================================================================
CREATE OR REPLACE FUNCTION public.touch_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER touch_notes BEFORE UPDATE ON public.notes
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_orgs BEFORE UPDATE ON public.orgs
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_users BEFORE UPDATE ON public.users
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
CREATE TRIGGER touch_ai_summaries BEFORE UPDATE ON public.ai_summaries
  FOR EACH ROW EXECUTE FUNCTION public.touch_updated_at();
