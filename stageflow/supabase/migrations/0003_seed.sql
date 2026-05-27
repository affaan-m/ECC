-- 0003_seed.sql
-- StageFlow: Seed data for plans and default platform admin
-- ============================================================

-- ============================================================
-- PLANS
-- ============================================================

insert into public.plans (id, code, name, monthly_price_pence, yearly_price_pence, one_time_setup_pence, features, is_active)
values
  (
    'a1b2c3d4-0001-4000-8000-000000000001',
    'starter',
    'Starter',
    2999,
    29990,
    0,
    '{
      "max_events_per_year": 5,
      "max_studios": 50,
      "max_entries_per_event": 200,
      "custom_branding": false,
      "api_access": false,
      "webhooks": false,
      "custom_domain": false,
      "ticketing": false,
      "livestreaming": false,
      "media_galleries": false,
      "support_level": "email"
    }'::jsonb,
    true
  ),
  (
    'a1b2c3d4-0002-4000-8000-000000000002',
    'pro',
    'Pro',
    7999,
    79990,
    4999,
    '{
      "max_events_per_year": 25,
      "max_studios": 250,
      "max_entries_per_event": 1000,
      "custom_branding": true,
      "api_access": true,
      "webhooks": true,
      "custom_domain": true,
      "ticketing": true,
      "livestreaming": false,
      "media_galleries": true,
      "discount_codes": true,
      "support_level": "priority_email"
    }'::jsonb,
    true
  ),
  (
    'a1b2c3d4-0003-4000-8000-000000000003',
    'enterprise',
    'Enterprise',
    19999,
    199990,
    9999,
    '{
      "max_events_per_year": -1,
      "max_studios": -1,
      "max_entries_per_event": -1,
      "custom_branding": true,
      "api_access": true,
      "webhooks": true,
      "custom_domain": true,
      "ticketing": true,
      "livestreaming": true,
      "media_galleries": true,
      "discount_codes": true,
      "white_label": true,
      "dedicated_support": true,
      "support_level": "dedicated"
    }'::jsonb,
    true
  );

-- ============================================================
-- DEFAULT PLATFORM ADMIN PROFILE
-- ============================================================
-- Note: The auth.users row must be created via Supabase Auth (sign-up or admin API).
-- This seed inserts the matching profiles row assuming the auth user already exists
-- with the well-known UUID below. In local dev, use `supabase auth admin create-user`.

-- Use a deterministic UUID so scripts can reference it
do $$
declare
  v_admin_id uuid := '00000000-0000-4000-a000-000000000001';
begin
  -- Only insert if the profile does not already exist
  if not exists (select 1 from public.profiles where id = v_admin_id) then
    insert into public.profiles (id, email, full_name, is_platform_admin, locale)
    values (
      v_admin_id,
      'admin@stageflow.app',
      'StageFlow Admin',
      true,
      'en-GB'
    );
  end if;
end;
$$;
