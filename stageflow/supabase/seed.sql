-- Seed data for local development
-- Run via: pnpm db:seed or pnpm db:reset

-- ============================================================
-- Plans
-- ============================================================
insert into public.plans (id, code, name, monthly_price_pence, yearly_price_pence, one_time_setup_pence, features, is_active) values
  ('00000000-plan-0000-0000-000000000001', 'starter', 'Starter', 4900, 47000, 50000, '{
    "max_events": 3,
    "max_studios": 50,
    "max_entries_per_event": 500,
    "exports": true,
    "custom_domain": false,
    "embed": true,
    "api_access": false,
    "webhooks": false,
    "priority_support": false
  }'::jsonb, true),
  ('00000000-plan-0000-0000-000000000002', 'pro', 'Pro', 9900, 95000, 50000, '{
    "max_events": 10,
    "max_studios": 200,
    "max_entries_per_event": 2000,
    "exports": true,
    "custom_domain": true,
    "embed": true,
    "api_access": true,
    "webhooks": true,
    "priority_support": true
  }'::jsonb, true),
  ('00000000-plan-0000-0000-000000000003', 'enterprise', 'Enterprise', 19900, 190000, 0, '{
    "max_events": -1,
    "max_studios": -1,
    "max_entries_per_event": -1,
    "exports": true,
    "custom_domain": true,
    "embed": true,
    "api_access": true,
    "webhooks": true,
    "priority_support": true,
    "dedicated_support": true,
    "sla": true
  }'::jsonb, true);

-- ============================================================
-- Platform admin (password set via SEED_ADMIN_PASSWORD env var during supabase db reset)
-- The actual auth.users row is created by Supabase Auth during seed
-- ============================================================

-- We Dance Nationals demo organisation
insert into public.organizations (id, slug, name, contact_email, plan_id, status) values
  ('00000000-org0-0000-0000-000000000001', 'wedancenationals', 'We Dance Nationals', 'info@wedancenationals.com', '00000000-plan-0000-0000-000000000002', 'active');

-- Branding for WDN
insert into public.organization_branding (organization_id, primary_color, accent_color, background_color, text_color, font_family, email_from_name) values
  ('00000000-org0-0000-0000-000000000001', '#E11D48', '#F59E0B', '#FFFFFF', '#0A0A0A', 'Inter', 'We Dance Nationals');

-- Demo studio
insert into public.studios (id, organization_id, name, slug, contact_email, principal_name) values
  ('00000000-stud-0000-0000-000000000001', '00000000-org0-0000-0000-000000000001', 'Sparkle Dance Academy', 'sparkle', 'info@sparkledance.co.uk', 'Sarah Williams');

-- Demo event
insert into public.events (id, organization_id, slug, name, venue_name, venue_address, starts_on, ends_on, registration_opens_at, registration_closes_at, music_upload_deadline, status) values
  ('00000000-evnt-0000-0000-000000000001', '00000000-org0-0000-0000-000000000001', 'nationals-2026', 'We Dance Nationals 2026', 'Birmingham NEC', 'North Ave, Marston Green, Birmingham B40 1NT', '2026-09-15', '2026-09-17', '2026-04-01 00:00:00+00', '2026-08-01 23:59:59+00', '2026-09-01 23:59:59+00', 'published');

-- Age groups
insert into public.age_groups (id, organization_id, name, min_age, max_age, sort_order) values
  ('00000000-age0-0000-0000-000000000001', '00000000-org0-0000-0000-000000000001', 'Petite', 4, 6, 1),
  ('00000000-age0-0000-0000-000000000002', '00000000-org0-0000-0000-000000000001', 'Mini', 7, 9, 2),
  ('00000000-age0-0000-0000-000000000003', '00000000-org0-0000-0000-000000000001', 'Junior', 10, 12, 3),
  ('00000000-age0-0000-0000-000000000004', '00000000-org0-0000-0000-000000000001', 'Teen', 13, 15, 4),
  ('00000000-age0-0000-0000-000000000005', '00000000-org0-0000-0000-000000000001', 'Senior', 16, 19, 5),
  ('00000000-age0-0000-0000-000000000006', '00000000-org0-0000-0000-000000000001', 'Adult', 20, 99, 6);

-- Styles
insert into public.styles (id, organization_id, name, sort_order) values
  ('00000000-styl-0000-0000-000000000001', '00000000-org0-0000-0000-000000000001', 'Ballet', 1),
  ('00000000-styl-0000-0000-000000000002', '00000000-org0-0000-0000-000000000001', 'Tap', 2),
  ('00000000-styl-0000-0000-000000000003', '00000000-org0-0000-0000-000000000001', 'Jazz', 3),
  ('00000000-styl-0000-0000-000000000004', '00000000-org0-0000-0000-000000000001', 'Contemporary', 4),
  ('00000000-styl-0000-0000-000000000005', '00000000-org0-0000-0000-000000000001', 'Lyrical', 5),
  ('00000000-styl-0000-0000-000000000006', '00000000-org0-0000-0000-000000000001', 'Street', 6),
  ('00000000-styl-0000-0000-000000000007', '00000000-org0-0000-0000-000000000001', 'Musical Theatre', 7),
  ('00000000-styl-0000-0000-000000000008', '00000000-org0-0000-0000-000000000001', 'Acro', 8),
  ('00000000-styl-0000-0000-000000000009', '00000000-org0-0000-0000-000000000001', 'Song & Dance', 9);

-- Entry types
insert into public.entry_types (id, organization_id, name, min_dancers, max_dancers, sort_order) values
  ('00000000-etyp-0000-0000-000000000001', '00000000-org0-0000-0000-000000000001', 'Solo', 1, 1, 1),
  ('00000000-etyp-0000-0000-000000000002', '00000000-org0-0000-0000-000000000001', 'Duet', 2, 2, 2),
  ('00000000-etyp-0000-0000-000000000003', '00000000-org0-0000-0000-000000000001', 'Trio', 3, 3, 3),
  ('00000000-etyp-0000-0000-000000000004', '00000000-org0-0000-0000-000000000001', 'Small Group', 4, 8, 4),
  ('00000000-etyp-0000-0000-000000000005', '00000000-org0-0000-0000-000000000001', 'Large Group', 9, 20, 5),
  ('00000000-etyp-0000-0000-000000000006', '00000000-org0-0000-0000-000000000001', 'Line', 21, 50, 6),
  ('00000000-etyp-0000-0000-000000000007', '00000000-org0-0000-0000-000000000001', 'Production', 8, 100, 7);

-- Number sequences
insert into public.number_sequences (organization_id, sequence_key, prefix, current_value, padding) values
  ('00000000-org0-0000-0000-000000000001', 'invoice', 'WDN-2026-', 0, 4),
  ('00000000-org0-0000-0000-000000000001', 'entry', 'E-', 0, 5);
