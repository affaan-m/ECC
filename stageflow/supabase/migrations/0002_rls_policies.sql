-- 0002_rls_policies.sql
-- StageFlow: Row Level Security policies for every table
-- ============================================================

-- ============================================================
-- HELPER FUNCTIONS
-- ============================================================

-- Current authenticated user id
create or replace function public.current_user_id()
returns uuid language sql stable security definer as $$
  select auth.uid();
$$;

-- Is the current user a platform admin?
create or replace function public.is_platform_admin()
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.profiles
    where id = auth.uid()
      and is_platform_admin = true
  );
$$;

-- Is the current user a member of the given organization?
create or replace function public.is_org_member(p_org_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_org_id
      and user_id = auth.uid()
  );
$$;

-- Does the current user hold a specific role (or higher) within an organization?
-- Role hierarchy: owner > admin > staff > judge
create or replace function public.has_org_role(p_org_id uuid, p_roles text[])
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.organization_members
    where organization_id = p_org_id
      and user_id = auth.uid()
      and role = any(p_roles)
  );
$$;

-- Is the current user a member of the given studio?
create or replace function public.is_studio_member(p_studio_id uuid)
returns boolean language sql stable security definer as $$
  select exists (
    select 1 from public.studio_members
    where studio_id = p_studio_id
      and user_id = auth.uid()
  );
$$;

-- Can the current user access the given studio?
-- True if: studio member, org admin/owner of studio's org, or platform admin
create or replace function public.can_access_studio(p_studio_id uuid)
returns boolean language sql stable security definer as $$
  select
    public.is_platform_admin()
    or public.is_studio_member(p_studio_id)
    or exists (
      select 1 from public.studios s
      join public.organization_members om
        on om.organization_id = s.organization_id
        and om.user_id = auth.uid()
        and om.role in ('owner','admin')
      where s.id = p_studio_id
    );
$$;

-- ============================================================
-- PROFILES
-- ============================================================

create policy "platform_admin_all_profiles"
  on public.profiles for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "users_read_own_profile"
  on public.profiles for select
  using (id = auth.uid());

create policy "users_update_own_profile"
  on public.profiles for update
  using (id = auth.uid())
  with check (id = auth.uid());

create policy "users_insert_own_profile"
  on public.profiles for insert
  with check (id = auth.uid());

-- Org members can read profiles of members in the same org
create policy "org_members_read_profiles"
  on public.profiles for select
  using (
    exists (
      select 1 from public.organization_members om1
      join public.organization_members om2
        on om1.organization_id = om2.organization_id
      where om1.user_id = auth.uid()
        and om2.user_id = profiles.id
    )
  );

-- ============================================================
-- PLANS
-- ============================================================

create policy "anyone_can_read_active_plans"
  on public.plans for select
  using (is_active = true);

create policy "platform_admin_all_plans"
  on public.plans for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- ORGANIZATIONS
-- ============================================================

create policy "platform_admin_all_organizations"
  on public.organizations for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_organization"
  on public.organizations for select
  using (public.is_org_member(id));

create policy "org_owner_admin_update_organization"
  on public.organizations for update
  using (public.has_org_role(id, array['owner','admin']))
  with check (public.has_org_role(id, array['owner','admin']));

-- ============================================================
-- ORGANIZATION_MEMBERS
-- ============================================================

create policy "platform_admin_all_org_members"
  on public.organization_members for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_org_members"
  on public.organization_members for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_manage_org_members"
  on public.organization_members for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_org_members"
  on public.organization_members for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_org_members"
  on public.organization_members for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- STUDIOS
-- ============================================================

create policy "platform_admin_all_studios"
  on public.studios for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_studios"
  on public.studios for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_studios"
  on public.studios for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_studios"
  on public.studios for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_studios"
  on public.studios for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- Studio members can read their own studio
create policy "studio_members_read_studio"
  on public.studios for select
  using (public.is_studio_member(id));

-- ============================================================
-- STUDIO_MEMBERS
-- ============================================================

create policy "platform_admin_all_studio_members"
  on public.studio_members for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "studio_members_read_studio_members"
  on public.studio_members for select
  using (public.can_access_studio(studio_id));

create policy "org_admin_manage_studio_members"
  on public.studio_members for insert
  with check (
    exists (
      select 1 from public.studios s
      where s.id = studio_members.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
    or (
      public.is_studio_member(studio_id)
      and exists (
        select 1 from public.studio_members sm
        where sm.studio_id = studio_members.studio_id
          and sm.user_id = auth.uid()
          and sm.role = 'owner'
      )
    )
  );

create policy "org_admin_or_studio_owner_update_studio_members"
  on public.studio_members for update
  using (
    exists (
      select 1 from public.studios s
      where s.id = studio_members.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

create policy "org_admin_or_studio_owner_delete_studio_members"
  on public.studio_members for delete
  using (
    exists (
      select 1 from public.studios s
      where s.id = studio_members.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- ORGANIZATION_BRANDING
-- ============================================================

create policy "platform_admin_all_branding"
  on public.organization_branding for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_branding"
  on public.organization_branding for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_branding"
  on public.organization_branding for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_branding"
  on public.organization_branding for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_branding"
  on public.organization_branding for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- CUSTOM_DOMAINS
-- ============================================================

create policy "platform_admin_all_custom_domains"
  on public.custom_domains for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_custom_domains"
  on public.custom_domains for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_custom_domains"
  on public.custom_domains for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_custom_domains"
  on public.custom_domains for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_custom_domains"
  on public.custom_domains for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- EMBED_ALLOWED_ORIGINS
-- ============================================================

create policy "platform_admin_all_embed_origins"
  on public.embed_allowed_origins for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_embed_origins"
  on public.embed_allowed_origins for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_embed_origins"
  on public.embed_allowed_origins for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_embed_origins"
  on public.embed_allowed_origins for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_embed_origins"
  on public.embed_allowed_origins for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- SUBSCRIPTIONS
-- ============================================================

create policy "platform_admin_all_subscriptions"
  on public.subscriptions for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_subscriptions"
  on public.subscriptions for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_subscriptions"
  on public.subscriptions for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_subscriptions"
  on public.subscriptions for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- EVENTS
-- ============================================================

create policy "platform_admin_all_events"
  on public.events for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_events"
  on public.events for select
  using (public.is_org_member(organization_id));

-- Published events readable by studio members in the same org
create policy "studio_members_read_published_events"
  on public.events for select
  using (
    status in ('published','registration_open','registration_closed','in_progress','complete')
    and exists (
      select 1 from public.studios s
      join public.studio_members sm on sm.studio_id = s.id
      where s.organization_id = events.organization_id
        and sm.user_id = auth.uid()
    )
  );

create policy "org_owner_admin_write_events"
  on public.events for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_staff_update_events"
  on public.events for update
  using (public.has_org_role(organization_id, array['owner','admin','staff']))
  with check (public.has_org_role(organization_id, array['owner','admin','staff']));

create policy "org_owner_admin_delete_events"
  on public.events for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- AGE_GROUPS
-- ============================================================

create policy "platform_admin_all_age_groups"
  on public.age_groups for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_age_groups"
  on public.age_groups for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_age_groups"
  on public.age_groups for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_age_groups"
  on public.age_groups for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_age_groups"
  on public.age_groups for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- STYLES
-- ============================================================

create policy "platform_admin_all_styles"
  on public.styles for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_styles"
  on public.styles for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_styles"
  on public.styles for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_styles"
  on public.styles for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_styles"
  on public.styles for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- ENTRY_TYPES
-- ============================================================

create policy "platform_admin_all_entry_types"
  on public.entry_types for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_entry_types"
  on public.entry_types for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_entry_types"
  on public.entry_types for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_entry_types"
  on public.entry_types for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_entry_types"
  on public.entry_types for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- EVENT_CATEGORIES
-- ============================================================

create policy "platform_admin_all_event_categories"
  on public.event_categories for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_event_categories"
  on public.event_categories for select
  using (
    exists (
      select 1 from public.events e
      where e.id = event_categories.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_event_categories"
  on public.event_categories for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = event_categories.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_event_categories"
  on public.event_categories for update
  using (
    exists (
      select 1 from public.events e
      where e.id = event_categories.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_event_categories"
  on public.event_categories for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = event_categories.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- DANCERS
-- ============================================================

create policy "platform_admin_all_dancers"
  on public.dancers for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "studio_access_read_dancers"
  on public.dancers for select
  using (public.can_access_studio(studio_id));

create policy "studio_member_write_dancers"
  on public.dancers for insert
  with check (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = dancers.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

create policy "studio_member_update_dancers"
  on public.dancers for update
  using (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = dancers.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

create policy "studio_member_delete_dancers"
  on public.dancers for delete
  using (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = dancers.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- ROUTINES
-- ============================================================

create policy "platform_admin_all_routines"
  on public.routines for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "studio_access_read_routines"
  on public.routines for select
  using (public.can_access_studio(studio_id));

create policy "studio_member_write_routines"
  on public.routines for insert
  with check (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = routines.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

create policy "studio_member_update_routines"
  on public.routines for update
  using (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = routines.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

create policy "studio_member_delete_routines"
  on public.routines for delete
  using (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = routines.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- ROUTINE_DANCERS
-- ============================================================

create policy "platform_admin_all_routine_dancers"
  on public.routine_dancers for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "studio_access_read_routine_dancers"
  on public.routine_dancers for select
  using (
    exists (
      select 1 from public.routines r
      where r.id = routine_dancers.routine_id
        and public.can_access_studio(r.studio_id)
    )
  );

create policy "studio_member_write_routine_dancers"
  on public.routine_dancers for insert
  with check (
    exists (
      select 1 from public.routines r
      where r.id = routine_dancers.routine_id
        and public.is_studio_member(r.studio_id)
    )
  );

create policy "studio_member_delete_routine_dancers"
  on public.routine_dancers for delete
  using (
    exists (
      select 1 from public.routines r
      where r.id = routine_dancers.routine_id
        and public.is_studio_member(r.studio_id)
    )
  );

-- ============================================================
-- MUSIC_FILES
-- ============================================================

create policy "platform_admin_all_music_files"
  on public.music_files for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_music_files"
  on public.music_files for select
  using (public.is_org_member(organization_id));

create policy "studio_member_write_music_files"
  on public.music_files for insert
  with check (
    public.is_studio_member(studio_id)
    or public.has_org_role(organization_id, array['owner','admin'])
  );

create policy "studio_member_delete_music_files"
  on public.music_files for delete
  using (
    public.is_studio_member(studio_id)
    or public.has_org_role(organization_id, array['owner','admin'])
  );

-- ============================================================
-- ENTRIES
-- ============================================================

create policy "platform_admin_all_entries"
  on public.entries for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "studio_access_read_entries"
  on public.entries for select
  using (public.can_access_studio(studio_id));

create policy "org_members_read_entries"
  on public.entries for select
  using (
    exists (
      select 1 from public.events e
      where e.id = entries.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "studio_member_write_entries"
  on public.entries for insert
  with check (public.is_studio_member(studio_id));

create policy "studio_member_update_entries"
  on public.entries for update
  using (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.events e
      where e.id = entries.event_id
        and public.has_org_role(e.organization_id, array['owner','admin','staff'])
    )
  );

create policy "org_admin_delete_entries"
  on public.entries for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = entries.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- INVOICES
-- ============================================================

create policy "platform_admin_all_invoices"
  on public.invoices for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_invoices"
  on public.invoices for select
  using (public.is_org_member(organization_id));

create policy "studio_members_read_invoices"
  on public.invoices for select
  using (public.can_access_studio(studio_id));

create policy "org_owner_admin_write_invoices"
  on public.invoices for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_invoices"
  on public.invoices for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_invoices"
  on public.invoices for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- INVOICE_ITEMS
-- ============================================================

create policy "platform_admin_all_invoice_items"
  on public.invoice_items for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "invoice_access_read_invoice_items"
  on public.invoice_items for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and (public.is_org_member(i.organization_id) or public.can_access_studio(i.studio_id))
    )
  );

create policy "org_owner_admin_write_invoice_items"
  on public.invoice_items for insert
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.has_org_role(i.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_invoice_items"
  on public.invoice_items for update
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.has_org_role(i.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_invoice_items"
  on public.invoice_items for delete
  using (
    exists (
      select 1 from public.invoices i
      where i.id = invoice_items.invoice_id
        and public.has_org_role(i.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- PAYMENTS
-- ============================================================

create policy "platform_admin_all_payments"
  on public.payments for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "invoice_access_read_payments"
  on public.payments for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id
        and (public.is_org_member(i.organization_id) or public.can_access_studio(i.studio_id))
    )
  );

create policy "org_owner_admin_write_payments"
  on public.payments for insert
  with check (
    exists (
      select 1 from public.invoices i
      where i.id = payments.invoice_id
        and public.has_org_role(i.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- AUDIT_LOGS (append-only: INSERT only, no UPDATE/DELETE)
-- ============================================================

create policy "platform_admin_read_all_audit_logs"
  on public.audit_logs for select
  using (public.is_platform_admin());

create policy "org_owner_admin_read_audit_logs"
  on public.audit_logs for select
  using (
    organization_id is not null
    and public.has_org_role(organization_id, array['owner','admin'])
  );

create policy "authenticated_insert_audit_logs"
  on public.audit_logs for insert
  with check (auth.uid() is not null);

-- ============================================================
-- IMPERSONATION_SESSIONS
-- ============================================================

create policy "platform_admin_all_impersonation"
  on public.impersonation_sessions for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

-- ============================================================
-- CONVERSATIONS
-- ============================================================

create policy "platform_admin_all_conversations"
  on public.conversations for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "participant_read_conversations"
  on public.conversations for select
  using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversations.id
        and cp.user_id = auth.uid()
    )
  );

create policy "org_members_read_conversations"
  on public.conversations for select
  using (public.is_org_member(organization_id));

create policy "org_member_or_studio_member_insert_conversations"
  on public.conversations for insert
  with check (
    public.is_org_member(organization_id)
    or (studio_id is not null and public.is_studio_member(studio_id))
  );

create policy "org_admin_update_conversations"
  on public.conversations for update
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- CONVERSATION_PARTICIPANTS
-- ============================================================

create policy "platform_admin_all_conv_participants"
  on public.conversation_participants for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "participant_read_conv_participants"
  on public.conversation_participants for select
  using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = conversation_participants.conversation_id
        and cp.user_id = auth.uid()
    )
  );

create policy "org_admin_manage_conv_participants"
  on public.conversation_participants for insert
  with check (
    exists (
      select 1 from public.conversations c
      where c.id = conversation_participants.conversation_id
        and public.has_org_role(c.organization_id, array['owner','admin'])
    )
  );

create policy "self_update_conv_participants"
  on public.conversation_participants for update
  using (user_id = auth.uid());

-- ============================================================
-- MESSAGES
-- ============================================================

create policy "platform_admin_all_messages"
  on public.messages for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "participant_read_messages"
  on public.messages for select
  using (
    exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.user_id = auth.uid()
    )
  );

create policy "participant_insert_messages"
  on public.messages for insert
  with check (
    sender_id = auth.uid()
    and exists (
      select 1 from public.conversation_participants cp
      where cp.conversation_id = messages.conversation_id
        and cp.user_id = auth.uid()
    )
  );

create policy "sender_update_messages"
  on public.messages for update
  using (sender_id = auth.uid());

-- ============================================================
-- MESSAGE_ATTACHMENTS
-- ============================================================

create policy "platform_admin_all_message_attachments"
  on public.message_attachments for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "participant_read_message_attachments"
  on public.message_attachments for select
  using (
    exists (
      select 1 from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id
      where m.id = message_attachments.message_id
        and cp.user_id = auth.uid()
    )
  );

create policy "sender_insert_message_attachments"
  on public.message_attachments for insert
  with check (
    exists (
      select 1 from public.messages m
      where m.id = message_attachments.message_id
        and m.sender_id = auth.uid()
    )
  );

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

create policy "platform_admin_all_notifications"
  on public.notifications for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "users_read_own_notifications"
  on public.notifications for select
  using (user_id = auth.uid());

create policy "users_update_own_notifications"
  on public.notifications for update
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "system_insert_notifications"
  on public.notifications for insert
  with check (auth.uid() is not null);

-- ============================================================
-- NOTIFICATION_PREFERENCES
-- ============================================================

create policy "platform_admin_all_notification_prefs"
  on public.notification_preferences for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "users_manage_own_notification_prefs"
  on public.notification_preferences for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

-- ============================================================
-- PENDING_INVITATIONS
-- ============================================================

create policy "platform_admin_all_invitations"
  on public.pending_invitations for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_invitations"
  on public.pending_invitations for select
  using (public.is_org_member(organization_id));

create policy "invitee_read_own_invitation"
  on public.pending_invitations for select
  using (
    email = (select p.email from public.profiles p where p.id = auth.uid())
  );

create policy "org_owner_admin_write_invitations"
  on public.pending_invitations for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_invitations"
  on public.pending_invitations for update
  using (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_invitations"
  on public.pending_invitations for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- DANCER_DOCUMENTS
-- ============================================================

create policy "platform_admin_all_dancer_documents"
  on public.dancer_documents for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "studio_access_read_dancer_documents"
  on public.dancer_documents for select
  using (public.can_access_studio(studio_id));

create policy "studio_member_write_dancer_documents"
  on public.dancer_documents for insert
  with check (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = dancer_documents.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

create policy "studio_member_update_dancer_documents"
  on public.dancer_documents for update
  using (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = dancer_documents.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

create policy "studio_member_delete_dancer_documents"
  on public.dancer_documents for delete
  using (
    public.is_studio_member(studio_id)
    or exists (
      select 1 from public.studios s
      where s.id = dancer_documents.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- REFUND_REQUESTS
-- ============================================================

create policy "platform_admin_all_refund_requests"
  on public.refund_requests for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_refund_requests"
  on public.refund_requests for select
  using (public.is_org_member(organization_id));

-- Studio members can read refunds for their invoices
create policy "studio_members_read_refund_requests"
  on public.refund_requests for select
  using (
    exists (
      select 1 from public.invoices i
      where i.id = refund_requests.invoice_id
        and public.can_access_studio(i.studio_id)
    )
  );

create policy "studio_member_insert_refund_requests"
  on public.refund_requests for insert
  with check (
    requested_by = auth.uid()
    and (
      public.is_org_member(organization_id)
      or exists (
        select 1 from public.invoices i
        where i.id = refund_requests.invoice_id
          and public.is_studio_member(i.studio_id)
      )
    )
  );

create policy "org_owner_admin_update_refund_requests"
  on public.refund_requests for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- DISCOUNT_CODES
-- ============================================================

create policy "platform_admin_all_discount_codes"
  on public.discount_codes for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_discount_codes"
  on public.discount_codes for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_discount_codes"
  on public.discount_codes for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_discount_codes"
  on public.discount_codes for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_discount_codes"
  on public.discount_codes for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- DISCOUNT_REDEMPTIONS
-- ============================================================

create policy "platform_admin_all_discount_redemptions"
  on public.discount_redemptions for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_read_discount_redemptions"
  on public.discount_redemptions for select
  using (
    exists (
      select 1 from public.discount_codes dc
      where dc.id = discount_redemptions.discount_code_id
        and public.is_org_member(dc.organization_id)
    )
  );

create policy "authenticated_insert_discount_redemptions"
  on public.discount_redemptions for insert
  with check (auth.uid() is not null);

-- ============================================================
-- NUMBER_SEQUENCES
-- ============================================================

create policy "platform_admin_all_number_sequences"
  on public.number_sequences for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_owner_admin_manage_number_sequences"
  on public.number_sequences for all
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- EMAIL_LOG
-- ============================================================

create policy "platform_admin_all_email_log"
  on public.email_log for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_owner_admin_read_email_log"
  on public.email_log for select
  using (
    organization_id is not null
    and public.has_org_role(organization_id, array['owner','admin'])
  );

create policy "users_read_own_email_log"
  on public.email_log for select
  using (user_id = auth.uid());

create policy "system_insert_email_log"
  on public.email_log for insert
  with check (auth.uid() is not null);

-- ============================================================
-- CONSENT_RECORDS (append-only: INSERT only, no UPDATE/DELETE)
-- ============================================================

create policy "platform_admin_read_all_consent_records"
  on public.consent_records for select
  using (public.is_platform_admin());

create policy "org_owner_admin_read_consent_records"
  on public.consent_records for select
  using (
    organization_id is not null
    and public.has_org_role(organization_id, array['owner','admin'])
  );

create policy "users_read_own_consent_records"
  on public.consent_records for select
  using (user_id = auth.uid());

create policy "authenticated_insert_consent_records"
  on public.consent_records for insert
  with check (auth.uid() is not null);

-- ============================================================
-- BACKGROUND_JOBS
-- ============================================================

create policy "platform_admin_all_background_jobs"
  on public.background_jobs for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_owner_admin_read_background_jobs"
  on public.background_jobs for select
  using (
    organization_id is not null
    and public.has_org_role(organization_id, array['owner','admin'])
  );

create policy "org_owner_admin_insert_background_jobs"
  on public.background_jobs for insert
  with check (
    organization_id is not null
    and public.has_org_role(organization_id, array['owner','admin'])
  );

-- ============================================================
-- API_KEYS
-- ============================================================

create policy "platform_admin_all_api_keys"
  on public.api_keys for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_owner_admin_read_api_keys"
  on public.api_keys for select
  using (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_write_api_keys"
  on public.api_keys for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_api_keys"
  on public.api_keys for update
  using (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_api_keys"
  on public.api_keys for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- WEBHOOK_ENDPOINTS
-- ============================================================

create policy "platform_admin_all_webhook_endpoints"
  on public.webhook_endpoints for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_owner_admin_read_webhook_endpoints"
  on public.webhook_endpoints for select
  using (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_write_webhook_endpoints"
  on public.webhook_endpoints for insert
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_update_webhook_endpoints"
  on public.webhook_endpoints for update
  using (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_webhook_endpoints"
  on public.webhook_endpoints for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- WEBHOOK_DELIVERIES
-- ============================================================

create policy "platform_admin_all_webhook_deliveries"
  on public.webhook_deliveries for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_owner_admin_read_webhook_deliveries"
  on public.webhook_deliveries for select
  using (
    exists (
      select 1 from public.webhook_endpoints we
      where we.id = webhook_deliveries.endpoint_id
        and public.has_org_role(we.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- TAGS
-- ============================================================

create policy "platform_admin_all_tags"
  on public.tags for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_tags"
  on public.tags for select
  using (public.is_org_member(organization_id));

create policy "org_owner_admin_write_tags"
  on public.tags for insert
  with check (public.has_org_role(organization_id, array['owner','admin','staff']));

create policy "org_owner_admin_update_tags"
  on public.tags for update
  using (public.has_org_role(organization_id, array['owner','admin']))
  with check (public.has_org_role(organization_id, array['owner','admin']));

create policy "org_owner_admin_delete_tags"
  on public.tags for delete
  using (public.has_org_role(organization_id, array['owner','admin']));

-- ============================================================
-- ENTRY_TAGS
-- ============================================================

create policy "platform_admin_all_entry_tags"
  on public.entry_tags for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "entry_access_read_entry_tags"
  on public.entry_tags for select
  using (
    exists (
      select 1 from public.entries e
      join public.events ev on ev.id = e.event_id
      where e.id = entry_tags.entry_id
        and (public.is_org_member(ev.organization_id) or public.can_access_studio(e.studio_id))
    )
  );

create policy "org_staff_write_entry_tags"
  on public.entry_tags for insert
  with check (
    exists (
      select 1 from public.entries e
      join public.events ev on ev.id = e.event_id
      where e.id = entry_tags.entry_id
        and public.has_org_role(ev.organization_id, array['owner','admin','staff'])
    )
  );

create policy "org_staff_delete_entry_tags"
  on public.entry_tags for delete
  using (
    exists (
      select 1 from public.entries e
      join public.events ev on ev.id = e.event_id
      where e.id = entry_tags.entry_id
        and public.has_org_role(ev.organization_id, array['owner','admin','staff'])
    )
  );

-- ============================================================
-- DANCER_TAGS
-- ============================================================

create policy "platform_admin_all_dancer_tags"
  on public.dancer_tags for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "studio_access_read_dancer_tags"
  on public.dancer_tags for select
  using (
    exists (
      select 1 from public.dancers d
      where d.id = dancer_tags.dancer_id
        and public.can_access_studio(d.studio_id)
    )
  );

create policy "studio_member_write_dancer_tags"
  on public.dancer_tags for insert
  with check (
    exists (
      select 1 from public.dancers d
      where d.id = dancer_tags.dancer_id
        and (public.is_studio_member(d.studio_id)
          or exists (
            select 1 from public.studios s
            where s.id = d.studio_id
              and public.has_org_role(s.organization_id, array['owner','admin'])
          ))
    )
  );

create policy "studio_member_delete_dancer_tags"
  on public.dancer_tags for delete
  using (
    exists (
      select 1 from public.dancers d
      where d.id = dancer_tags.dancer_id
        and (public.is_studio_member(d.studio_id)
          or exists (
            select 1 from public.studios s
            where s.id = d.studio_id
              and public.has_org_role(s.organization_id, array['owner','admin'])
          ))
    )
  );

-- ============================================================
-- STUDIO_TAGS
-- ============================================================

create policy "platform_admin_all_studio_tags"
  on public.studio_tags for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_studio_tags"
  on public.studio_tags for select
  using (
    exists (
      select 1 from public.studios s
      where s.id = studio_tags.studio_id
        and public.is_org_member(s.organization_id)
    )
  );

create policy "org_admin_write_studio_tags"
  on public.studio_tags for insert
  with check (
    exists (
      select 1 from public.studios s
      where s.id = studio_tags.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

create policy "org_admin_delete_studio_tags"
  on public.studio_tags for delete
  using (
    exists (
      select 1 from public.studios s
      where s.id = studio_tags.studio_id
        and public.has_org_role(s.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- SAVED_VIEWS
-- ============================================================

create policy "platform_admin_all_saved_views"
  on public.saved_views for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "users_manage_own_saved_views"
  on public.saved_views for all
  using (user_id = auth.uid())
  with check (user_id = auth.uid());

create policy "org_members_read_shared_saved_views"
  on public.saved_views for select
  using (
    is_shared = true
    and public.is_org_member(organization_id)
  );

-- ============================================================
-- MESSAGE_MENTIONS
-- ============================================================

create policy "platform_admin_all_message_mentions"
  on public.message_mentions for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "mentioned_user_read_mentions"
  on public.message_mentions for select
  using (mentioned_user_id = auth.uid());

create policy "participant_read_mentions"
  on public.message_mentions for select
  using (
    exists (
      select 1 from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id
      where m.id = message_mentions.message_id
        and cp.user_id = auth.uid()
    )
  );

create policy "participant_insert_mentions"
  on public.message_mentions for insert
  with check (
    exists (
      select 1 from public.messages m
      join public.conversation_participants cp on cp.conversation_id = m.conversation_id
      where m.id = message_mentions.message_id
        and cp.user_id = auth.uid()
    )
  );

create policy "mentioned_user_update_mentions"
  on public.message_mentions for update
  using (mentioned_user_id = auth.uid());

-- ============================================================
-- RUNNING_ORDERS
-- ============================================================

create policy "platform_admin_all_running_orders"
  on public.running_orders for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_running_orders"
  on public.running_orders for select
  using (
    exists (
      select 1 from public.events e
      where e.id = running_orders.event_id
        and public.is_org_member(e.organization_id)
    )
  );

-- Published running orders readable by studio members
create policy "studio_members_read_published_running_orders"
  on public.running_orders for select
  using (
    status in ('published','locked')
    and exists (
      select 1 from public.events e
      join public.studios s on s.organization_id = e.organization_id
      join public.studio_members sm on sm.studio_id = s.id
      where e.id = running_orders.event_id
        and sm.user_id = auth.uid()
    )
  );

create policy "org_owner_admin_write_running_orders"
  on public.running_orders for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = running_orders.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_running_orders"
  on public.running_orders for update
  using (
    exists (
      select 1 from public.events e
      where e.id = running_orders.event_id
        and public.has_org_role(e.organization_id, array['owner','admin','staff'])
    )
  );

create policy "org_owner_admin_delete_running_orders"
  on public.running_orders for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = running_orders.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- STAGES
-- ============================================================

create policy "platform_admin_all_stages"
  on public.stages for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_stages"
  on public.stages for select
  using (
    exists (
      select 1 from public.events e
      where e.id = stages.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_stages"
  on public.stages for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = stages.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_stages"
  on public.stages for update
  using (
    exists (
      select 1 from public.events e
      where e.id = stages.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_stages"
  on public.stages for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = stages.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- RUNNING_ORDER_BLOCKS
-- ============================================================

create policy "platform_admin_all_ro_blocks"
  on public.running_order_blocks for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_ro_blocks"
  on public.running_order_blocks for select
  using (
    exists (
      select 1 from public.running_orders ro
      join public.events e on e.id = ro.event_id
      where ro.id = running_order_blocks.running_order_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_ro_blocks"
  on public.running_order_blocks for insert
  with check (
    exists (
      select 1 from public.running_orders ro
      join public.events e on e.id = ro.event_id
      where ro.id = running_order_blocks.running_order_id
        and public.has_org_role(e.organization_id, array['owner','admin','staff'])
    )
  );

create policy "org_owner_admin_update_ro_blocks"
  on public.running_order_blocks for update
  using (
    exists (
      select 1 from public.running_orders ro
      join public.events e on e.id = ro.event_id
      where ro.id = running_order_blocks.running_order_id
        and public.has_org_role(e.organization_id, array['owner','admin','staff'])
    )
  );

create policy "org_owner_admin_delete_ro_blocks"
  on public.running_order_blocks for delete
  using (
    exists (
      select 1 from public.running_orders ro
      join public.events e on e.id = ro.event_id
      where ro.id = running_order_blocks.running_order_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- RUNNING_ORDER_SLOTS
-- ============================================================

create policy "platform_admin_all_ro_slots"
  on public.running_order_slots for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_ro_slots"
  on public.running_order_slots for select
  using (
    exists (
      select 1 from public.running_order_blocks rob
      join public.running_orders ro on ro.id = rob.running_order_id
      join public.events e on e.id = ro.event_id
      where rob.id = running_order_slots.block_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_staff_write_ro_slots"
  on public.running_order_slots for insert
  with check (
    exists (
      select 1 from public.running_order_blocks rob
      join public.running_orders ro on ro.id = rob.running_order_id
      join public.events e on e.id = ro.event_id
      where rob.id = running_order_slots.block_id
        and public.has_org_role(e.organization_id, array['owner','admin','staff'])
    )
  );

create policy "org_staff_update_ro_slots"
  on public.running_order_slots for update
  using (
    exists (
      select 1 from public.running_order_blocks rob
      join public.running_orders ro on ro.id = rob.running_order_id
      join public.events e on e.id = ro.event_id
      where rob.id = running_order_slots.block_id
        and public.has_org_role(e.organization_id, array['owner','admin','staff'])
    )
  );

create policy "org_admin_delete_ro_slots"
  on public.running_order_slots for delete
  using (
    exists (
      select 1 from public.running_order_blocks rob
      join public.running_orders ro on ro.id = rob.running_order_id
      join public.events e on e.id = ro.event_id
      where rob.id = running_order_slots.block_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- CLASH_RULES
-- ============================================================

create policy "platform_admin_all_clash_rules"
  on public.clash_rules for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_clash_rules"
  on public.clash_rules for select
  using (
    exists (
      select 1 from public.events e
      where e.id = clash_rules.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_clash_rules"
  on public.clash_rules for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = clash_rules.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_clash_rules"
  on public.clash_rules for update
  using (
    exists (
      select 1 from public.events e
      where e.id = clash_rules.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_clash_rules"
  on public.clash_rules for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = clash_rules.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- JUDGES
-- ============================================================

create policy "platform_admin_all_judges"
  on public.judges for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_judges"
  on public.judges for select
  using (
    exists (
      select 1 from public.events e
      where e.id = judges.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_judges"
  on public.judges for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = judges.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_judges"
  on public.judges for update
  using (
    exists (
      select 1 from public.events e
      where e.id = judges.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_judges"
  on public.judges for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = judges.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- JUDGING_PANELS
-- ============================================================

create policy "platform_admin_all_judging_panels"
  on public.judging_panels for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_judging_panels"
  on public.judging_panels for select
  using (
    exists (
      select 1 from public.events e
      where e.id = judging_panels.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_judging_panels"
  on public.judging_panels for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = judging_panels.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_judging_panels"
  on public.judging_panels for update
  using (
    exists (
      select 1 from public.events e
      where e.id = judging_panels.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_judging_panels"
  on public.judging_panels for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = judging_panels.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- JUDGING_PANEL_MEMBERS
-- ============================================================

create policy "platform_admin_all_panel_members"
  on public.judging_panel_members for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_panel_members"
  on public.judging_panel_members for select
  using (
    exists (
      select 1 from public.judging_panels jp
      join public.events e on e.id = jp.event_id
      where jp.id = judging_panel_members.panel_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_panel_members"
  on public.judging_panel_members for insert
  with check (
    exists (
      select 1 from public.judging_panels jp
      join public.events e on e.id = jp.event_id
      where jp.id = judging_panel_members.panel_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_panel_members"
  on public.judging_panel_members for delete
  using (
    exists (
      select 1 from public.judging_panels jp
      join public.events e on e.id = jp.event_id
      where jp.id = judging_panel_members.panel_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- SCORING_CRITERIA
-- ============================================================

create policy "platform_admin_all_scoring_criteria"
  on public.scoring_criteria for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_scoring_criteria"
  on public.scoring_criteria for select
  using (
    exists (
      select 1 from public.events e
      where e.id = scoring_criteria.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_scoring_criteria"
  on public.scoring_criteria for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = scoring_criteria.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_scoring_criteria"
  on public.scoring_criteria for update
  using (
    exists (
      select 1 from public.events e
      where e.id = scoring_criteria.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_scoring_criteria"
  on public.scoring_criteria for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = scoring_criteria.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- SCORE_SHEETS
-- ============================================================

create policy "platform_admin_all_score_sheets"
  on public.score_sheets for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_score_sheets"
  on public.score_sheets for select
  using (
    exists (
      select 1 from public.entries en
      join public.events e on e.id = en.event_id
      where en.id = score_sheets.entry_id
        and public.is_org_member(e.organization_id)
    )
  );

-- Judge can manage their own score sheets
create policy "judge_manage_own_score_sheets"
  on public.score_sheets for all
  using (
    exists (
      select 1 from public.judges j
      where j.id = score_sheets.judge_id
        and j.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.judges j
      where j.id = score_sheets.judge_id
        and j.user_id = auth.uid()
    )
  );

-- ============================================================
-- SCORES
-- ============================================================

create policy "platform_admin_all_scores"
  on public.scores for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_scores"
  on public.scores for select
  using (
    exists (
      select 1 from public.score_sheets ss
      join public.entries en on en.id = ss.entry_id
      join public.events e on e.id = en.event_id
      where ss.id = scores.score_sheet_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "judge_manage_own_scores"
  on public.scores for all
  using (
    exists (
      select 1 from public.score_sheets ss
      join public.judges j on j.id = ss.judge_id
      where ss.id = scores.score_sheet_id
        and j.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.score_sheets ss
      join public.judges j on j.id = ss.judge_id
      where ss.id = scores.score_sheet_id
        and j.user_id = auth.uid()
    )
  );

-- ============================================================
-- AWARDS
-- ============================================================

create policy "platform_admin_all_awards"
  on public.awards for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_awards"
  on public.awards for select
  using (
    exists (
      select 1 from public.events e
      where e.id = awards.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_awards"
  on public.awards for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = awards.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_awards"
  on public.awards for update
  using (
    exists (
      select 1 from public.events e
      where e.id = awards.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_awards"
  on public.awards for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = awards.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- AWARD_RECIPIENTS
-- ============================================================

create policy "platform_admin_all_award_recipients"
  on public.award_recipients for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_award_recipients"
  on public.award_recipients for select
  using (
    exists (
      select 1 from public.awards a
      join public.events e on e.id = a.event_id
      where a.id = award_recipients.award_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_award_recipients"
  on public.award_recipients for insert
  with check (
    exists (
      select 1 from public.awards a
      join public.events e on e.id = a.event_id
      where a.id = award_recipients.award_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_award_recipients"
  on public.award_recipients for update
  using (
    exists (
      select 1 from public.awards a
      join public.events e on e.id = a.event_id
      where a.id = award_recipients.award_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_award_recipients"
  on public.award_recipients for delete
  using (
    exists (
      select 1 from public.awards a
      join public.events e on e.id = a.event_id
      where a.id = award_recipients.award_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- TICKET_TYPES
-- ============================================================

create policy "platform_admin_all_ticket_types"
  on public.ticket_types for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "anyone_read_active_ticket_types"
  on public.ticket_types for select
  using (is_active = true);

create policy "org_members_read_all_ticket_types"
  on public.ticket_types for select
  using (
    exists (
      select 1 from public.events e
      where e.id = ticket_types.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "org_owner_admin_write_ticket_types"
  on public.ticket_types for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = ticket_types.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_ticket_types"
  on public.ticket_types for update
  using (
    exists (
      select 1 from public.events e
      where e.id = ticket_types.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_ticket_types"
  on public.ticket_types for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = ticket_types.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- TICKET_PURCHASES
-- ============================================================

create policy "platform_admin_all_ticket_purchases"
  on public.ticket_purchases for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "buyer_read_own_ticket_purchases"
  on public.ticket_purchases for select
  using (buyer_user_id = auth.uid());

create policy "org_members_read_ticket_purchases"
  on public.ticket_purchases for select
  using (
    exists (
      select 1 from public.events e
      where e.id = ticket_purchases.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "authenticated_insert_ticket_purchases"
  on public.ticket_purchases for insert
  with check (auth.uid() is not null);

create policy "org_admin_update_ticket_purchases"
  on public.ticket_purchases for update
  using (
    exists (
      select 1 from public.events e
      where e.id = ticket_purchases.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- TICKET_ATTENDEES
-- ============================================================

create policy "platform_admin_all_ticket_attendees"
  on public.ticket_attendees for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "buyer_read_own_attendees"
  on public.ticket_attendees for select
  using (
    exists (
      select 1 from public.ticket_purchases tp
      where tp.id = ticket_attendees.ticket_purchase_id
        and tp.buyer_user_id = auth.uid()
    )
  );

create policy "org_members_read_ticket_attendees"
  on public.ticket_attendees for select
  using (
    exists (
      select 1 from public.ticket_purchases tp
      join public.events e on e.id = tp.event_id
      where tp.id = ticket_attendees.ticket_purchase_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "buyer_insert_attendees"
  on public.ticket_attendees for insert
  with check (
    exists (
      select 1 from public.ticket_purchases tp
      where tp.id = ticket_attendees.ticket_purchase_id
        and tp.buyer_user_id = auth.uid()
    )
  );

create policy "org_staff_update_ticket_attendees"
  on public.ticket_attendees for update
  using (
    exists (
      select 1 from public.ticket_purchases tp
      join public.events e on e.id = tp.event_id
      where tp.id = ticket_attendees.ticket_purchase_id
        and public.has_org_role(e.organization_id, array['owner','admin','staff'])
    )
  );

-- ============================================================
-- LIVESTREAM_SESSIONS
-- ============================================================

create policy "platform_admin_all_livestream_sessions"
  on public.livestream_sessions for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_livestream_sessions"
  on public.livestream_sessions for select
  using (
    exists (
      select 1 from public.events e
      where e.id = livestream_sessions.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "public_read_live_sessions"
  on public.livestream_sessions for select
  using (is_public = true and status = 'live');

create policy "org_owner_admin_write_livestream_sessions"
  on public.livestream_sessions for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = livestream_sessions.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_livestream_sessions"
  on public.livestream_sessions for update
  using (
    exists (
      select 1 from public.events e
      where e.id = livestream_sessions.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_livestream_sessions"
  on public.livestream_sessions for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = livestream_sessions.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- MEDIA_GALLERIES
-- ============================================================

create policy "platform_admin_all_media_galleries"
  on public.media_galleries for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "org_members_read_media_galleries"
  on public.media_galleries for select
  using (
    exists (
      select 1 from public.events e
      where e.id = media_galleries.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "public_read_public_galleries"
  on public.media_galleries for select
  using (is_public = true);

create policy "org_owner_admin_write_media_galleries"
  on public.media_galleries for insert
  with check (
    exists (
      select 1 from public.events e
      where e.id = media_galleries.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_media_galleries"
  on public.media_galleries for update
  using (
    exists (
      select 1 from public.events e
      where e.id = media_galleries.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_media_galleries"
  on public.media_galleries for delete
  using (
    exists (
      select 1 from public.events e
      where e.id = media_galleries.event_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- MEDIA_ITEMS
-- ============================================================

create policy "platform_admin_all_media_items"
  on public.media_items for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "gallery_access_read_media_items"
  on public.media_items for select
  using (
    exists (
      select 1 from public.media_galleries mg
      where mg.id = media_items.gallery_id
        and (mg.is_public = true
          or exists (
            select 1 from public.events e
            where e.id = mg.event_id
              and public.is_org_member(e.organization_id)
          ))
    )
  );

create policy "org_owner_admin_write_media_items"
  on public.media_items for insert
  with check (
    exists (
      select 1 from public.media_galleries mg
      join public.events e on e.id = mg.event_id
      where mg.id = media_items.gallery_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_update_media_items"
  on public.media_items for update
  using (
    exists (
      select 1 from public.media_galleries mg
      join public.events e on e.id = mg.event_id
      where mg.id = media_items.gallery_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

create policy "org_owner_admin_delete_media_items"
  on public.media_items for delete
  using (
    exists (
      select 1 from public.media_galleries mg
      join public.events e on e.id = mg.event_id
      where mg.id = media_items.gallery_id
        and public.has_org_role(e.organization_id, array['owner','admin'])
    )
  );

-- ============================================================
-- MEDIA_PURCHASES
-- ============================================================

create policy "platform_admin_all_media_purchases"
  on public.media_purchases for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "user_read_own_media_purchases"
  on public.media_purchases for select
  using (user_id = auth.uid());

create policy "org_members_read_media_purchases"
  on public.media_purchases for select
  using (
    exists (
      select 1 from public.events e
      where e.id = media_purchases.event_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "authenticated_insert_media_purchases"
  on public.media_purchases for insert
  with check (user_id = auth.uid());

-- ============================================================
-- MEDIA_PURCHASE_ITEMS
-- ============================================================

create policy "platform_admin_all_media_purchase_items"
  on public.media_purchase_items for all
  using (public.is_platform_admin())
  with check (public.is_platform_admin());

create policy "purchaser_read_own_media_purchase_items"
  on public.media_purchase_items for select
  using (
    exists (
      select 1 from public.media_purchases mp
      where mp.id = media_purchase_items.media_purchase_id
        and mp.user_id = auth.uid()
    )
  );

create policy "org_members_read_media_purchase_items"
  on public.media_purchase_items for select
  using (
    exists (
      select 1 from public.media_purchases mp
      join public.events e on e.id = mp.event_id
      where mp.id = media_purchase_items.media_purchase_id
        and public.is_org_member(e.organization_id)
    )
  );

create policy "authenticated_insert_media_purchase_items"
  on public.media_purchase_items for insert
  with check (
    exists (
      select 1 from public.media_purchases mp
      where mp.id = media_purchase_items.media_purchase_id
        and mp.user_id = auth.uid()
    )
  );
