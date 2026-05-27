-- 0004_indexes.sql
-- StageFlow: Performance indexes, full-text search columns, and GIN indexes
-- ============================================================
-- Note: Some indexes were created inline in 0001_init.sql alongside their tables.
-- This migration adds the remaining performance-critical indexes.

-- ============================================================
-- FULL-TEXT SEARCH COLUMNS
-- ============================================================

-- dancers: searchable by name
alter table public.dancers
  add column if not exists fts tsvector
  generated always as (
    to_tsvector('english',
      coalesce(first_name, '') || ' ' ||
      coalesce(last_name, '') || ' ' ||
      coalesce(parent_guardian_name, '') || ' ' ||
      coalesce(parent_guardian_email::text, '') || ' ' ||
      coalesce(notes, '')
    )
  ) stored;

-- routines: searchable by title, choreographer
alter table public.routines
  add column if not exists fts tsvector
  generated always as (
    to_tsvector('english',
      coalesce(title, '') || ' ' ||
      coalesce(choreographer, '') || ' ' ||
      coalesce(notes, '')
    )
  ) stored;

-- studios: searchable by name, principal, contact info
alter table public.studios
  add column if not exists fts tsvector
  generated always as (
    to_tsvector('english',
      coalesce(name, '') || ' ' ||
      coalesce(principal_name, '') || ' ' ||
      coalesce(contact_email::text, '') || ' ' ||
      coalesce(city, '') || ' ' ||
      coalesce(postcode, '')
    )
  ) stored;

-- events: searchable by name, description, venue
alter table public.events
  add column if not exists fts tsvector
  generated always as (
    to_tsvector('english',
      coalesce(name, '') || ' ' ||
      coalesce(description, '') || ' ' ||
      coalesce(venue_name, '') || ' ' ||
      coalesce(venue_address, '')
    )
  ) stored;

-- ============================================================
-- GIN INDEXES FOR FULL-TEXT SEARCH
-- ============================================================

create index if not exists idx_dancers_fts on public.dancers using gin (fts);
create index if not exists idx_routines_fts on public.routines using gin (fts);
create index if not exists idx_studios_fts on public.studios using gin (fts);
create index if not exists idx_events_fts on public.events using gin (fts);

-- ============================================================
-- IDENTITY & TENANCY
-- ============================================================

create index if not exists idx_profiles_email on public.profiles (email);
create index if not exists idx_profiles_platform_admin on public.profiles (is_platform_admin)
  where is_platform_admin = true;

create index if not exists idx_organizations_slug on public.organizations (slug);
create index if not exists idx_organizations_status on public.organizations (status);
create index if not exists idx_organizations_plan on public.organizations (plan_id);
create index if not exists idx_organizations_stripe on public.organizations (stripe_connect_account_id)
  where stripe_connect_account_id is not null;

create index if not exists idx_org_members_user on public.organization_members (user_id);
create index if not exists idx_org_members_role on public.organization_members (organization_id, role);

create index if not exists idx_studios_org on public.studios (organization_id);
create index if not exists idx_studios_status on public.studios (organization_id, status);

create index if not exists idx_studio_members_user on public.studio_members (user_id);

-- ============================================================
-- BRANDING, DOMAINS, EMBED
-- ============================================================

create index if not exists idx_custom_domains_org on public.custom_domains (organization_id);
create index if not exists idx_custom_domains_verified on public.custom_domains (verified_at)
  where verified_at is not null;

-- ============================================================
-- BILLING
-- ============================================================

create index if not exists idx_subscriptions_org on public.subscriptions (organization_id);
create index if not exists idx_subscriptions_status on public.subscriptions (status);
create index if not exists idx_subscriptions_stripe_customer on public.subscriptions (stripe_customer_id)
  where stripe_customer_id is not null;
create index if not exists idx_subscriptions_stripe_sub on public.subscriptions (stripe_subscription_id)
  where stripe_subscription_id is not null;

-- ============================================================
-- EVENTS & TAXONOMY
-- ============================================================

create index if not exists idx_events_org on public.events (organization_id);
create index if not exists idx_events_status on public.events (organization_id, status);
create index if not exists idx_events_dates on public.events (starts_on, ends_on);

create index if not exists idx_age_groups_org on public.age_groups (organization_id, sort_order);
create index if not exists idx_styles_org on public.styles (organization_id, sort_order);
create index if not exists idx_entry_types_org on public.entry_types (organization_id, sort_order);

create index if not exists idx_event_categories_event on public.event_categories (event_id);
create index if not exists idx_event_categories_age_group on public.event_categories (age_group_id);
create index if not exists idx_event_categories_style on public.event_categories (style_id);
create index if not exists idx_event_categories_entry_type on public.event_categories (entry_type_id);

-- ============================================================
-- DANCERS, ROUTINES, ENTRIES, MUSIC
-- ============================================================

create index if not exists idx_dancers_studio on public.dancers (studio_id);
create index if not exists idx_dancers_dob on public.dancers (date_of_birth);
create index if not exists idx_dancers_not_deleted on public.dancers (studio_id)
  where deleted_at is null;

create index if not exists idx_routines_studio on public.routines (studio_id);
create index if not exists idx_routines_event on public.routines (event_id);
create index if not exists idx_routines_category on public.routines (event_category_id);
create index if not exists idx_routines_not_deleted on public.routines (studio_id, event_id)
  where deleted_at is null;

create index if not exists idx_routine_dancers_dancer on public.routine_dancers (dancer_id);

create index if not exists idx_music_files_org on public.music_files (organization_id);
create index if not exists idx_music_files_studio on public.music_files (studio_id);
create index if not exists idx_music_files_routine on public.music_files (routine_id);

create index if not exists idx_entries_event on public.entries (event_id);
create index if not exists idx_entries_studio on public.entries (studio_id);
create index if not exists idx_entries_routine on public.entries (routine_id);
create index if not exists idx_entries_status on public.entries (event_id, status);
create index if not exists idx_entries_invoice on public.entries (invoice_id)
  where invoice_id is not null;

-- ============================================================
-- INVOICING & PAYMENTS
-- ============================================================

create index if not exists idx_invoices_org on public.invoices (organization_id);
create index if not exists idx_invoices_studio on public.invoices (studio_id);
create index if not exists idx_invoices_event on public.invoices (event_id);
create index if not exists idx_invoices_status on public.invoices (organization_id, status);
create index if not exists idx_invoices_due_at on public.invoices (due_at)
  where status in ('issued','partially_paid');

create index if not exists idx_invoice_items_invoice on public.invoice_items (invoice_id);
create index if not exists idx_invoice_items_entry on public.invoice_items (entry_id)
  where entry_id is not null;

create index if not exists idx_payments_invoice on public.payments (invoice_id);
create index if not exists idx_payments_status on public.payments (status);
create index if not exists idx_payments_stripe_pi on public.payments (stripe_payment_intent_id)
  where stripe_payment_intent_id is not null;
create index if not exists idx_payments_stripe_charge on public.payments (stripe_charge_id)
  where stripe_charge_id is not null;

-- ============================================================
-- REFUNDS
-- ============================================================

create index if not exists idx_refund_requests_invoice on public.refund_requests (invoice_id);
create index if not exists idx_refund_requests_entry on public.refund_requests (entry_id);
create index if not exists idx_refund_requests_status on public.refund_requests (organization_id, status);

-- ============================================================
-- DISCOUNT CODES
-- ============================================================

create index if not exists idx_discount_codes_org on public.discount_codes (organization_id);
create index if not exists idx_discount_codes_event on public.discount_codes (event_id);
create index if not exists idx_discount_codes_active on public.discount_codes (organization_id, is_active)
  where is_active = true;

create index if not exists idx_discount_redemptions_invoice on public.discount_redemptions (invoice_id);
create index if not exists idx_discount_redemptions_studio on public.discount_redemptions (studio_id);

-- ============================================================
-- MESSAGING
-- ============================================================

create index if not exists idx_conversations_context on public.conversations (context_type, context_id)
  where context_type is not null;
create index if not exists idx_conversations_last_message on public.conversations (organization_id, last_message_at desc);

create index if not exists idx_conv_participants_user on public.conversation_participants (user_id);

create index if not exists idx_messages_sender on public.messages (sender_id);
create index if not exists idx_messages_not_deleted on public.messages (conversation_id, created_at)
  where deleted_at is null;

create index if not exists idx_message_attachments_message on public.message_attachments (message_id);

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

create index if not exists idx_notifications_org on public.notifications (organization_id);
create index if not exists idx_notifications_type on public.notifications (user_id, type);
create index if not exists idx_notifications_unread on public.notifications (user_id, created_at desc)
  where read_at is null;

-- ============================================================
-- RUNNING ORDERS
-- ============================================================

create index if not exists idx_running_orders_event on public.running_orders (event_id);
create index if not exists idx_stages_event on public.stages (event_id, sort_order);
create index if not exists idx_ro_blocks_running_order on public.running_order_blocks (running_order_id, sort_order);
create index if not exists idx_ro_blocks_stage on public.running_order_blocks (stage_id);
create index if not exists idx_ro_slots_block on public.running_order_slots (block_id, position);
create index if not exists idx_ro_slots_entry on public.running_order_slots (entry_id)
  where entry_id is not null;
create index if not exists idx_clash_rules_event on public.clash_rules (event_id);

-- ============================================================
-- JUDGING & SCORING
-- ============================================================

create index if not exists idx_judges_event on public.judges (event_id);
create index if not exists idx_judges_user on public.judges (user_id)
  where user_id is not null;
create index if not exists idx_judging_panels_event on public.judging_panels (event_id);
create index if not exists idx_panel_members_panel on public.judging_panel_members (panel_id);
create index if not exists idx_panel_members_judge on public.judging_panel_members (judge_id);

create index if not exists idx_scoring_criteria_event on public.scoring_criteria (event_id, sort_order);
create index if not exists idx_score_sheets_entry on public.score_sheets (entry_id);
create index if not exists idx_score_sheets_judge on public.score_sheets (judge_id);
create index if not exists idx_score_sheets_panel on public.score_sheets (panel_id)
  where panel_id is not null;
create index if not exists idx_scores_sheet on public.scores (score_sheet_id);
create index if not exists idx_scores_criteria on public.scores (criteria_id);

create index if not exists idx_awards_event on public.awards (event_id, sort_order);
create index if not exists idx_award_recipients_award on public.award_recipients (award_id);
create index if not exists idx_award_recipients_entry on public.award_recipients (entry_id)
  where entry_id is not null;

-- ============================================================
-- TICKETS
-- ============================================================

create index if not exists idx_ticket_types_event on public.ticket_types (event_id);
create index if not exists idx_ticket_types_active on public.ticket_types (event_id, is_active)
  where is_active = true;
create index if not exists idx_ticket_purchases_event on public.ticket_purchases (event_id);
create index if not exists idx_ticket_purchases_buyer on public.ticket_purchases (buyer_user_id)
  where buyer_user_id is not null;
create index if not exists idx_ticket_purchases_status on public.ticket_purchases (event_id, status);
create index if not exists idx_ticket_purchases_qr on public.ticket_purchases (qr_code_token)
  where qr_code_token is not null;
create index if not exists idx_ticket_attendees_purchase on public.ticket_attendees (ticket_purchase_id);

-- ============================================================
-- LIVESTREAM
-- ============================================================

create index if not exists idx_livestream_event on public.livestream_sessions (event_id);
create index if not exists idx_livestream_stage on public.livestream_sessions (stage_id)
  where stage_id is not null;
create index if not exists idx_livestream_status on public.livestream_sessions (status)
  where status = 'live';

-- ============================================================
-- MEDIA
-- ============================================================

create index if not exists idx_media_galleries_event on public.media_galleries (event_id);
create index if not exists idx_media_items_gallery on public.media_items (gallery_id, sort_order);
create index if not exists idx_media_items_entry on public.media_items (entry_id)
  where entry_id is not null;
create index if not exists idx_media_purchases_user on public.media_purchases (user_id);
create index if not exists idx_media_purchases_event on public.media_purchases (event_id);
create index if not exists idx_media_purchases_gallery on public.media_purchases (gallery_id)
  where gallery_id is not null;
create index if not exists idx_media_purchase_items_purchase on public.media_purchase_items (media_purchase_id);
create index if not exists idx_media_purchase_items_item on public.media_purchase_items (media_item_id);

-- ============================================================
-- CONSENT & EMAIL
-- ============================================================

create index if not exists idx_consent_records_org on public.consent_records (organization_id);
create index if not exists idx_consent_records_type on public.consent_records (consent_type);

create index if not exists idx_email_log_status on public.email_log (status)
  where status in ('queued','sent');
create index if not exists idx_email_log_template on public.email_log (template)
  where template is not null;

-- ============================================================
-- JSONB GIN INDEXES
-- ============================================================

-- Organization features (plans)
create index if not exists idx_plans_features on public.plans using gin (features);

-- Audit log metadata
create index if not exists idx_audit_logs_metadata on public.audit_logs using gin (metadata);

-- Discount codes category filter
create index if not exists idx_discount_codes_category_filter on public.discount_codes using gin (category_filter)
  where category_filter is not null;

-- Saved views filters
create index if not exists idx_saved_views_filters on public.saved_views using gin (filters);

-- Webhook deliveries payload (for debugging)
create index if not exists idx_webhook_deliveries_payload on public.webhook_deliveries using gin (payload);

-- Background jobs payload
create index if not exists idx_background_jobs_payload on public.background_jobs using gin (payload);

-- Email log metadata
create index if not exists idx_email_log_metadata on public.email_log using gin (metadata);

-- ============================================================
-- TAGS (composite lookups)
-- ============================================================

create index if not exists idx_tags_org on public.tags (organization_id);
create index if not exists idx_entry_tags_entry on public.entry_tags (entry_id);
create index if not exists idx_dancer_tags_dancer on public.dancer_tags (dancer_id);
create index if not exists idx_studio_tags_studio on public.studio_tags (studio_id);

-- ============================================================
-- API KEYS & WEBHOOKS
-- ============================================================

create index if not exists idx_api_keys_active on public.api_keys (organization_id)
  where revoked_at is null and (expires_at is null or expires_at > now());
create index if not exists idx_webhook_endpoints_active on public.webhook_endpoints (organization_id)
  where is_active = true;
