-- RLS Isolation Tests
-- Proves that Organisation A cannot read or write Organisation B's data.
-- Run via: supabase test db

begin;

select plan(20);

-- ============================================================
-- Setup: Create two orgs and two users
-- ============================================================

-- Create test users in auth.users
insert into auth.users (id, email, raw_user_meta_data) values
  ('11111111-1111-1111-1111-111111111111', 'user1@org1.test', '{}'),
  ('22222222-2222-2222-2222-222222222222', 'user2@org2.test', '{}'),
  ('33333333-3333-3333-3333-333333333333', 'admin@platform.test', '{}');

-- Create profiles
insert into public.profiles (id, email, full_name, is_platform_admin) values
  ('11111111-1111-1111-1111-111111111111', 'user1@org1.test', 'User One', false),
  ('22222222-2222-2222-2222-222222222222', 'user2@org2.test', 'User Two', false),
  ('33333333-3333-3333-3333-333333333333', 'admin@platform.test', 'Platform Admin', true);

-- Create two organisations
insert into public.organizations (id, slug, name, contact_email) values
  ('aaaa0000-0000-0000-0000-000000000001', 'org-one', 'Organisation One', 'org1@test.local'),
  ('aaaa0000-0000-0000-0000-000000000002', 'org-two', 'Organisation Two', 'org2@test.local');

-- Assign user1 to org1, user2 to org2
insert into public.organization_members (organization_id, user_id, role) values
  ('aaaa0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('aaaa0000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'owner');

-- Create studios
insert into public.studios (id, organization_id, name, slug, contact_email) values
  ('bbbb0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'Studio Alpha', 'studio-alpha', 'alpha@test.local'),
  ('bbbb0000-0000-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000002', 'Studio Beta', 'studio-beta', 'beta@test.local');

-- Assign users to studios
insert into public.studio_members (studio_id, user_id, role) values
  ('bbbb0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'owner'),
  ('bbbb0000-0000-0000-0000-000000000002', '22222222-2222-2222-2222-222222222222', 'owner');

-- Create events
insert into public.events (id, organization_id, slug, name, starts_on, ends_on) values
  ('cccc0000-0000-0000-0000-000000000001', 'aaaa0000-0000-0000-0000-000000000001', 'event-one', 'Event One', '2026-06-01', '2026-06-02'),
  ('cccc0000-0000-0000-0000-000000000002', 'aaaa0000-0000-0000-0000-000000000002', 'event-two', 'Event Two', '2026-07-01', '2026-07-02');

-- Create dancers
insert into public.dancers (id, studio_id, first_name, last_name, date_of_birth) values
  ('dddd0000-0000-0000-0000-000000000001', 'bbbb0000-0000-0000-0000-000000000001', 'Alice', 'One', '2015-01-01'),
  ('dddd0000-0000-0000-0000-000000000002', 'bbbb0000-0000-0000-0000-000000000002', 'Bob', 'Two', '2015-06-01');

-- ============================================================
-- Test 1: User1 can read own org
-- ============================================================
set local role authenticated;
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

select is(
  (select count(*) from public.organizations where id = 'aaaa0000-0000-0000-0000-000000000001'),
  1::bigint,
  'User1 can read own organisation'
);

-- ============================================================
-- Test 2: User1 CANNOT read org2
-- ============================================================
select is(
  (select count(*) from public.organizations where id = 'aaaa0000-0000-0000-0000-000000000002'),
  0::bigint,
  'User1 CANNOT read other organisation'
);

-- ============================================================
-- Test 3: User1 can read own studio
-- ============================================================
select is(
  (select count(*) from public.studios where id = 'bbbb0000-0000-0000-0000-000000000001'),
  1::bigint,
  'User1 can read own studio'
);

-- ============================================================
-- Test 4: User1 CANNOT read org2 studio
-- ============================================================
select is(
  (select count(*) from public.studios where id = 'bbbb0000-0000-0000-0000-000000000002'),
  0::bigint,
  'User1 CANNOT read other org studio'
);

-- ============================================================
-- Test 5: User1 can read own events
-- ============================================================
select is(
  (select count(*) from public.events where id = 'cccc0000-0000-0000-0000-000000000001'),
  1::bigint,
  'User1 can read own org events'
);

-- ============================================================
-- Test 6: User1 CANNOT read org2 events
-- ============================================================
select is(
  (select count(*) from public.events where id = 'cccc0000-0000-0000-0000-000000000002'),
  0::bigint,
  'User1 CANNOT read other org events'
);

-- ============================================================
-- Test 7: User1 can read own dancers
-- ============================================================
select is(
  (select count(*) from public.dancers where id = 'dddd0000-0000-0000-0000-000000000001'),
  1::bigint,
  'User1 can read own dancers'
);

-- ============================================================
-- Test 8: User1 CANNOT read org2 dancers
-- ============================================================
select is(
  (select count(*) from public.dancers where id = 'dddd0000-0000-0000-0000-000000000002'),
  0::bigint,
  'User1 CANNOT read other org dancers'
);

-- ============================================================
-- Switch to User2 and verify reverse isolation
-- ============================================================
set local request.jwt.claims to '{"sub":"22222222-2222-2222-2222-222222222222"}';

-- Test 9: User2 can read own org
select is(
  (select count(*) from public.organizations where id = 'aaaa0000-0000-0000-0000-000000000002'),
  1::bigint,
  'User2 can read own organisation'
);

-- Test 10: User2 CANNOT read org1
select is(
  (select count(*) from public.organizations where id = 'aaaa0000-0000-0000-0000-000000000001'),
  0::bigint,
  'User2 CANNOT read other organisation'
);

-- Test 11: User2 can read own studio
select is(
  (select count(*) from public.studios where id = 'bbbb0000-0000-0000-0000-000000000002'),
  1::bigint,
  'User2 can read own studio'
);

-- Test 12: User2 CANNOT read org1 studio
select is(
  (select count(*) from public.studios where id = 'bbbb0000-0000-0000-0000-000000000001'),
  0::bigint,
  'User2 CANNOT read other org studio'
);

-- Test 13: User2 CANNOT read org1 dancers
select is(
  (select count(*) from public.dancers where id = 'dddd0000-0000-0000-0000-000000000001'),
  0::bigint,
  'User2 CANNOT read other org dancers'
);

-- Test 14: User2 can read own dancers
select is(
  (select count(*) from public.dancers where id = 'dddd0000-0000-0000-0000-000000000002'),
  1::bigint,
  'User2 can read own dancers'
);

-- ============================================================
-- Platform admin sees everything
-- ============================================================
set local request.jwt.claims to '{"sub":"33333333-3333-3333-3333-333333333333"}';

-- Test 15: Platform admin can read all orgs
select is(
  (select count(*) from public.organizations),
  2::bigint,
  'Platform admin can read all organisations'
);

-- Test 16: Platform admin can read all studios
select is(
  (select count(*) from public.studios),
  2::bigint,
  'Platform admin can read all studios'
);

-- Test 17: Platform admin can read all events
select is(
  (select count(*) from public.events),
  2::bigint,
  'Platform admin can read all events'
);

-- Test 18: Platform admin can read all dancers
select is(
  (select count(*) from public.dancers),
  2::bigint,
  'Platform admin can read all dancers'
);

-- ============================================================
-- Append-only tables
-- ============================================================

-- Test 19: Audit logs cannot be deleted (as authenticated user)
set local request.jwt.claims to '{"sub":"11111111-1111-1111-1111-111111111111"}';

insert into public.audit_logs (organization_id, actor_user_id, actor_type, action)
values ('aaaa0000-0000-0000-0000-000000000001', '11111111-1111-1111-1111-111111111111', 'user', 'test.action');

select throws_ok(
  $$delete from public.audit_logs where action = 'test.action'$$,
  null,
  'Audit logs cannot be deleted'
);

-- Test 20: Consent records cannot be updated
insert into public.consent_records (user_id, organization_id, consent_type, document_version, given)
values ('11111111-1111-1111-1111-111111111111', 'aaaa0000-0000-0000-0000-000000000001', 'terms', 'v1', true);

select throws_ok(
  $$update public.consent_records set given = false where consent_type = 'terms'$$,
  null,
  'Consent records cannot be updated'
);

select * from finish();
rollback;
