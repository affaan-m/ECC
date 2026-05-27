-- 0001_init.sql
-- StageFlow: Complete schema initialisation
-- ============================================================

-- Enable required extensions
create extension if not exists "citext" with schema "public";
create extension if not exists "pgcrypto" with schema "extensions";

-- ============================================================
-- Trigger function: auto-set updated_at on row modification
-- ============================================================
create or replace function public.handle_updated_at()
returns trigger language plpgsql as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- ============================================================
-- IDENTITY & TENANCY
-- ============================================================

-- plans (created before organizations because organizations references plans)
create table public.plans (
  id          uuid primary key default gen_random_uuid(),
  code        text unique not null,
  name        text not null,
  monthly_price_pence  int,
  yearly_price_pence   int,
  one_time_setup_pence int not null default 0,
  features    jsonb not null default '{}',
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
alter table public.plans enable row level security;

-- profiles
create table public.profiles (
  id                uuid primary key references auth.users on delete cascade,
  email             citext not null,
  full_name         text,
  avatar_url        text,
  is_platform_admin boolean not null default false,
  phone             text,
  locale            text not null default 'en-GB',
  marketing_opt_in  boolean not null default false,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now()
);
alter table public.profiles enable row level security;

create trigger profiles_updated_at
  before update on public.profiles
  for each row execute function public.handle_updated_at();

-- organizations
create table public.organizations (
  id                              uuid primary key default gen_random_uuid(),
  slug                            citext unique not null,
  name                            text not null,
  legal_name                      text,
  contact_email                   citext,
  country_code                    text not null default 'GB',
  vat_number                      text,
  status                          text not null default 'active'
                                    check (status in ('active','suspended','archived')),
  plan_id                         uuid references public.plans(id) on delete set null,
  stripe_connect_account_id       text,
  stripe_connect_charges_enabled  boolean not null default false,
  stripe_connect_payouts_enabled  boolean not null default false,
  platform_fee_bps                int not null default 0,
  created_at                      timestamptz not null default now(),
  updated_at                      timestamptz not null default now(),
  deleted_at                      timestamptz
);
alter table public.organizations enable row level security;

create trigger organizations_updated_at
  before update on public.organizations
  for each row execute function public.handle_updated_at();

-- organization_members
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null check (role in ('owner','admin','staff','judge')),
  invited_by      uuid references public.profiles(id) on delete set null,
  invited_at      timestamptz,
  accepted_at     timestamptz,
  created_at      timestamptz not null default now(),
  primary key (organization_id, user_id)
);
alter table public.organization_members enable row level security;

-- studios
create table public.studios (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  slug            citext not null,
  contact_email   citext,
  contact_phone   text,
  address_line1   text,
  address_line2   text,
  city            text,
  county          text,
  postcode        text,
  country_code    text not null default 'GB',
  principal_name  text,
  status          text not null default 'active'
                    check (status in ('active','suspended','archived')),
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  deleted_at      timestamptz,
  unique (organization_id, slug)
);
alter table public.studios enable row level security;

create trigger studios_updated_at
  before update on public.studios
  for each row execute function public.handle_updated_at();

-- studio_members
create table public.studio_members (
  studio_id  uuid not null references public.studios(id) on delete cascade,
  user_id    uuid not null references public.profiles(id) on delete cascade,
  role       text not null check (role in ('owner','teacher','assistant')),
  created_at timestamptz not null default now(),
  primary key (studio_id, user_id)
);
alter table public.studio_members enable row level security;

-- ============================================================
-- BRANDING, DOMAINS, EMBED
-- ============================================================

-- organization_branding
create table public.organization_branding (
  organization_id  uuid primary key references public.organizations(id) on delete cascade,
  logo_url         text,
  logo_dark_url    text,
  favicon_url      text,
  primary_color    text not null default '#7F77DD',
  accent_color     text not null default '#1D9E75',
  background_color text,
  text_color       text,
  font_family      text not null default 'Inter',
  custom_css       text,
  email_from_name  text,
  email_footer_html text,
  social_links     jsonb not null default '{}',
  updated_at       timestamptz not null default now()
);
alter table public.organization_branding enable row level security;

create trigger organization_branding_updated_at
  before update on public.organization_branding
  for each row execute function public.handle_updated_at();

-- custom_domains
create table public.custom_domains (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  domain              citext unique not null,
  verification_token  text,
  verification_method text check (verification_method in ('txt','cname')),
  verified_at         timestamptz,
  ssl_status          text not null default 'pending'
                        check (ssl_status in ('pending','issued','failed')),
  created_at          timestamptz not null default now()
);
alter table public.custom_domains enable row level security;

-- embed_allowed_origins
create table public.embed_allowed_origins (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  origin          text not null,
  label           text,
  created_at      timestamptz not null default now(),
  unique (organization_id, origin)
);
alter table public.embed_allowed_origins enable row level security;

-- ============================================================
-- BILLING
-- ============================================================

-- subscriptions
create table public.subscriptions (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  plan_id                 uuid not null references public.plans(id) on delete restrict,
  status                  text not null default 'trialing'
                            check (status in ('trialing','active','past_due','canceled','paused')),
  stripe_customer_id      text,
  stripe_subscription_id  text,
  current_period_start    timestamptz,
  current_period_end      timestamptz,
  cancel_at               timestamptz,
  setup_fee_paid_at       timestamptz,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now()
);
alter table public.subscriptions enable row level security;

create trigger subscriptions_updated_at
  before update on public.subscriptions
  for each row execute function public.handle_updated_at();

-- ============================================================
-- EVENTS & TAXONOMY
-- ============================================================

-- events
create table public.events (
  id                      uuid primary key default gen_random_uuid(),
  organization_id         uuid not null references public.organizations(id) on delete cascade,
  slug                    citext not null,
  name                    text not null,
  description             text,
  venue_name              text,
  venue_address           text,
  starts_on               date,
  ends_on                 date,
  registration_opens_at   timestamptz,
  registration_closes_at  timestamptz,
  music_upload_deadline    timestamptz,
  currency                text not null default 'GBP',
  cover_image_url         text,
  status                  text not null default 'draft'
                            check (status in ('draft','published','registration_open',
                                              'registration_closed','in_progress','complete','archived')),
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  unique (organization_id, slug)
);
alter table public.events enable row level security;

create trigger events_updated_at
  before update on public.events
  for each row execute function public.handle_updated_at();

-- age_groups
create table public.age_groups (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  min_age         int,
  max_age         int,
  sort_order      int not null default 0
);
alter table public.age_groups enable row level security;

-- styles
create table public.styles (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  sort_order      int not null default 0
);
alter table public.styles enable row level security;

-- entry_types
create table public.entry_types (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  min_dancers     int,
  max_dancers     int,
  sort_order      int not null default 0
);
alter table public.entry_types enable row level security;

-- event_categories
create table public.event_categories (
  id                  uuid primary key default gen_random_uuid(),
  event_id            uuid not null references public.events(id) on delete cascade,
  age_group_id        uuid references public.age_groups(id) on delete set null,
  style_id            uuid references public.styles(id) on delete set null,
  entry_type_id       uuid references public.entry_types(id) on delete set null,
  name                text not null,
  price_pence         int not null default 0,
  max_routine_seconds int not null default 180,
  capacity            int,
  created_at          timestamptz not null default now(),
  unique (event_id, age_group_id, style_id, entry_type_id)
);
alter table public.event_categories enable row level security;

-- ============================================================
-- DANCERS, ROUTINES, ENTRIES, MUSIC
-- ============================================================

-- dancers
create table public.dancers (
  id                      uuid primary key default gen_random_uuid(),
  studio_id               uuid not null references public.studios(id) on delete cascade,
  first_name              text not null,
  last_name               text not null,
  date_of_birth           date,
  gender                  text,
  notes                   text,
  photo_url               text,
  parent_guardian_name    text,
  parent_guardian_email   citext,
  parent_guardian_phone   text,
  consent_photo           boolean not null default false,
  consent_video           boolean not null default false,
  consent_medical         boolean not null default false,
  created_at              timestamptz not null default now(),
  updated_at              timestamptz not null default now(),
  deleted_at              timestamptz
);
alter table public.dancers enable row level security;

create trigger dancers_updated_at
  before update on public.dancers
  for each row execute function public.handle_updated_at();

-- routines (music_file_id FK added after music_files table)
create table public.routines (
  id                uuid primary key default gen_random_uuid(),
  studio_id         uuid not null references public.studios(id) on delete cascade,
  event_id          uuid not null references public.events(id) on delete cascade,
  event_category_id uuid references public.event_categories(id) on delete set null,
  title             text not null,
  choreographer     text,
  duration_seconds  int,
  music_file_id     uuid,
  notes             text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  deleted_at        timestamptz
);
alter table public.routines enable row level security;

create trigger routines_updated_at
  before update on public.routines
  for each row execute function public.handle_updated_at();

-- routine_dancers
create table public.routine_dancers (
  routine_id uuid not null references public.routines(id) on delete cascade,
  dancer_id  uuid not null references public.dancers(id) on delete cascade,
  primary key (routine_id, dancer_id)
);
alter table public.routine_dancers enable row level security;

-- music_files
create table public.music_files (
  id                uuid primary key default gen_random_uuid(),
  organization_id   uuid not null references public.organizations(id) on delete cascade,
  studio_id         uuid references public.studios(id) on delete set null,
  routine_id        uuid references public.routines(id) on delete set null,
  storage_path      text not null,
  original_filename text not null,
  mime_type         text,
  size_bytes        bigint,
  duration_seconds  int,
  checksum_sha256   text,
  uploaded_by       uuid references public.profiles(id) on delete set null,
  created_at        timestamptz not null default now()
);
alter table public.music_files enable row level security;

-- Now add the FK from routines to music_files
alter table public.routines
  add constraint routines_music_file_id_fkey
  foreign key (music_file_id) references public.music_files(id) on delete set null;

-- entries (invoice_id FK added after invoices table)
create table public.entries (
  id               uuid primary key default gen_random_uuid(),
  event_id         uuid not null references public.events(id) on delete cascade,
  studio_id        uuid not null references public.studios(id) on delete cascade,
  routine_id       uuid not null references public.routines(id) on delete cascade,
  status           text not null default 'draft'
                     check (status in ('draft','submitted','approved','rejected','withdrawn','waitlisted')),
  submitted_at     timestamptz,
  approved_at      timestamptz,
  rejection_reason text,
  invoice_id       uuid,
  amount_pence     int,
  created_at       timestamptz not null default now(),
  updated_at       timestamptz not null default now(),
  unique (event_id, routine_id)
);
alter table public.entries enable row level security;

create trigger entries_updated_at
  before update on public.entries
  for each row execute function public.handle_updated_at();

-- ============================================================
-- INVOICING & PAYMENTS
-- ============================================================

-- invoices
create table public.invoices (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  studio_id       uuid not null references public.studios(id) on delete cascade,
  event_id        uuid references public.events(id) on delete set null,
  number          text not null,
  status          text not null default 'draft'
                    check (status in ('draft','issued','paid','partially_paid','overdue','void','refunded')),
  currency        text not null default 'GBP',
  subtotal_pence  int not null default 0,
  tax_pence       int not null default 0,
  total_pence     int not null default 0,
  amount_paid_pence int not null default 0,
  issued_at       timestamptz,
  due_at          timestamptz,
  paid_at         timestamptz,
  pdf_url         text,
  notes           text,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now(),
  unique (organization_id, number)
);
alter table public.invoices enable row level security;

create trigger invoices_updated_at
  before update on public.invoices
  for each row execute function public.handle_updated_at();

-- invoice_items
create table public.invoice_items (
  id              uuid primary key default gen_random_uuid(),
  invoice_id      uuid not null references public.invoices(id) on delete cascade,
  entry_id        uuid references public.entries(id) on delete set null,
  description     text not null,
  quantity        int not null default 1,
  unit_price_pence int not null,
  total_pence     int not null,
  created_at      timestamptz not null default now()
);
alter table public.invoice_items enable row level security;

-- Now add the FK from entries to invoices
alter table public.entries
  add constraint entries_invoice_id_fkey
  foreign key (invoice_id) references public.invoices(id) on delete set null;

-- payments
create table public.payments (
  id                       uuid primary key default gen_random_uuid(),
  invoice_id               uuid not null references public.invoices(id) on delete cascade,
  amount_pence             int not null,
  currency                 text not null default 'GBP',
  method                   text not null
                             check (method in ('stripe_card','stripe_bacs','bank_transfer','cash','cheque','offline')),
  status                   text not null default 'pending'
                             check (status in ('pending','succeeded','failed','refunded')),
  stripe_payment_intent_id text,
  stripe_charge_id         text,
  paid_at                  timestamptz,
  refunded_at              timestamptz,
  notes                    text,
  created_at               timestamptz not null default now()
);
alter table public.payments enable row level security;

-- ============================================================
-- AUDIT & IMPERSONATION
-- ============================================================

-- audit_logs
create table public.audit_logs (
  id                    uuid primary key default gen_random_uuid(),
  organization_id       uuid references public.organizations(id) on delete set null,
  actor_user_id         uuid references public.profiles(id) on delete set null,
  actor_type            text not null
                          check (actor_type in ('user','platform_admin','system','impersonator')),
  impersonator_user_id  uuid references public.profiles(id) on delete set null,
  action                text not null,
  target_type           text,
  target_id             uuid,
  metadata              jsonb not null default '{}',
  ip_address            inet,
  user_agent            text,
  created_at            timestamptz not null default now()
);
alter table public.audit_logs enable row level security;

create index idx_audit_logs_org_created
  on public.audit_logs (organization_id, created_at desc);
create index idx_audit_logs_actor_created
  on public.audit_logs (actor_user_id, created_at desc);

-- impersonation_sessions
create table public.impersonation_sessions (
  id                uuid primary key default gen_random_uuid(),
  platform_admin_id uuid not null references public.profiles(id) on delete cascade,
  target_user_id    uuid not null references public.profiles(id) on delete cascade,
  reason            text not null,
  started_at        timestamptz not null default now(),
  ended_at          timestamptz,
  ip_address        inet,
  user_agent        text
);
alter table public.impersonation_sessions enable row level security;

-- ============================================================
-- MESSAGING
-- ============================================================

-- conversations
create table public.conversations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  studio_id       uuid references public.studios(id) on delete set null,
  subject         text,
  context_type    text check (context_type in ('entry','invoice','event','dancer','general')),
  context_id      uuid,
  last_message_at timestamptz,
  is_closed       boolean not null default false,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.conversations enable row level security;

create trigger conversations_updated_at
  before update on public.conversations
  for each row execute function public.handle_updated_at();

create index idx_conversations_org on public.conversations (organization_id);
create index idx_conversations_studio on public.conversations (studio_id);

-- conversation_participants
create table public.conversation_participants (
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  user_id         uuid not null references public.profiles(id) on delete cascade,
  role            text not null check (role in ('organizer','studio','platform_admin')),
  last_read_at    timestamptz,
  muted           boolean not null default false,
  primary key (conversation_id, user_id)
);
alter table public.conversation_participants enable row level security;

-- messages
create table public.messages (
  id              uuid primary key default gen_random_uuid(),
  conversation_id uuid not null references public.conversations(id) on delete cascade,
  sender_id       uuid references public.profiles(id) on delete set null,
  body            text not null,
  is_system       boolean not null default false,
  edited_at       timestamptz,
  deleted_at      timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.messages enable row level security;

create index idx_messages_conversation_created
  on public.messages (conversation_id, created_at);

-- message_attachments
create table public.message_attachments (
  id                uuid primary key default gen_random_uuid(),
  message_id        uuid not null references public.messages(id) on delete cascade,
  storage_path      text not null,
  original_filename text not null,
  mime_type         text,
  size_bytes        bigint,
  created_at        timestamptz not null default now()
);
alter table public.message_attachments enable row level security;

-- ============================================================
-- NOTIFICATIONS
-- ============================================================

-- notifications
create table public.notifications (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid references public.organizations(id) on delete set null,
  type            text not null,
  title           text not null,
  body            text,
  link_path       text,
  priority        text not null default 'normal'
                    check (priority in ('low','normal','high','urgent')),
  read_at         timestamptz,
  archived_at     timestamptz,
  metadata        jsonb not null default '{}',
  created_at      timestamptz not null default now()
);
alter table public.notifications enable row level security;

create index idx_notifications_user_read_created
  on public.notifications (user_id, read_at, created_at desc);

-- notification_preferences
create table public.notification_preferences (
  user_id           uuid not null references public.profiles(id) on delete cascade,
  notification_type text not null,
  in_app            boolean not null default true,
  email             boolean not null default true,
  primary key (user_id, notification_type)
);
alter table public.notification_preferences enable row level security;

-- ============================================================
-- INVITATIONS
-- ============================================================

-- pending_invitations
create table public.pending_invitations (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  studio_id       uuid references public.studios(id) on delete set null,
  email           citext not null,
  role            text not null,
  invited_by      uuid references public.profiles(id) on delete set null,
  token           text unique not null,
  expires_at      timestamptz not null,
  accepted_at     timestamptz,
  accepted_by     uuid references public.profiles(id) on delete set null,
  revoked_at      timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.pending_invitations enable row level security;

create index idx_pending_invitations_email on public.pending_invitations (email);
create index idx_pending_invitations_org   on public.pending_invitations (organization_id);
create index idx_pending_invitations_token on public.pending_invitations (token);

-- ============================================================
-- DOCUMENTS
-- ============================================================

-- dancer_documents
create table public.dancer_documents (
  id                uuid primary key default gen_random_uuid(),
  dancer_id         uuid not null references public.dancers(id) on delete cascade,
  studio_id         uuid not null references public.studios(id) on delete cascade,
  document_type     text not null
                      check (document_type in ('birth_certificate','photo_consent','video_consent',
                                               'medical_form','parental_consent','code_of_conduct','other')),
  storage_path      text not null,
  original_filename text not null,
  mime_type         text,
  size_bytes        bigint,
  uploaded_by       uuid references public.profiles(id) on delete set null,
  verified_at       timestamptz,
  verified_by       uuid references public.profiles(id) on delete set null,
  rejected_at       timestamptz,
  rejection_reason  text,
  expires_at        date,
  notes             text,
  created_at        timestamptz not null default now()
);
alter table public.dancer_documents enable row level security;

create index idx_dancer_documents_dancer  on public.dancer_documents (dancer_id);
create index idx_dancer_documents_studio  on public.dancer_documents (studio_id);

-- ============================================================
-- REFUNDS
-- ============================================================

-- refund_requests
create table public.refund_requests (
  id                     uuid primary key default gen_random_uuid(),
  organization_id        uuid not null references public.organizations(id) on delete cascade,
  invoice_id             uuid references public.invoices(id) on delete set null,
  entry_id               uuid references public.entries(id) on delete set null,
  requested_amount_pence int not null,
  approved_amount_pence  int,
  reason                 text,
  category               text not null
                           check (category in ('injury','illness','withdrawal','duplicate',
                                               'organiser_cancellation','other')),
  status                 text not null default 'pending'
                           check (status in ('pending','approved','rejected','processed','failed')),
  requested_by           uuid references public.profiles(id) on delete set null,
  reviewed_by            uuid references public.profiles(id) on delete set null,
  reviewed_at            timestamptz,
  processed_at           timestamptz,
  stripe_refund_id       text,
  internal_notes         text,
  studio_notes           text,
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now()
);
alter table public.refund_requests enable row level security;

create trigger refund_requests_updated_at
  before update on public.refund_requests
  for each row execute function public.handle_updated_at();

create index idx_refund_requests_org on public.refund_requests (organization_id);

-- ============================================================
-- DISCOUNT CODES
-- ============================================================

-- discount_codes
create table public.discount_codes (
  id                  uuid primary key default gen_random_uuid(),
  organization_id     uuid not null references public.organizations(id) on delete cascade,
  event_id            uuid references public.events(id) on delete set null,
  code                citext not null,
  description         text,
  discount_type       text not null
                        check (discount_type in ('percent','fixed_amount','nth_routine_free')),
  discount_value      int not null,
  applies_to          text not null default 'entry'
                        check (applies_to in ('invoice','entry','category')),
  category_filter     jsonb,
  max_uses            int,
  max_uses_per_studio int,
  uses_count          int not null default 0,
  min_entries         int,
  min_subtotal_pence  int,
  starts_at           timestamptz,
  expires_at          timestamptz,
  is_active           boolean not null default true,
  created_at          timestamptz not null default now(),
  unique (organization_id, code)
);
alter table public.discount_codes enable row level security;

-- discount_redemptions
create table public.discount_redemptions (
  id               uuid primary key default gen_random_uuid(),
  discount_code_id uuid not null references public.discount_codes(id) on delete cascade,
  invoice_id       uuid references public.invoices(id) on delete set null,
  studio_id        uuid references public.studios(id) on delete set null,
  amount_pence     int not null,
  redeemed_at      timestamptz not null default now()
);
alter table public.discount_redemptions enable row level security;

create index idx_discount_redemptions_code on public.discount_redemptions (discount_code_id);

-- ============================================================
-- NUMBER SEQUENCES
-- ============================================================

create table public.number_sequences (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  sequence_key    text not null,
  prefix          text not null default '',
  current_value   bigint not null default 0,
  padding         int not null default 4,
  primary key (organization_id, sequence_key)
);
alter table public.number_sequences enable row level security;

-- Atomically increment and return the next formatted value
create or replace function public.next_sequence_value(
  p_org_id       uuid,
  p_sequence_key text
)
returns text
language plpgsql
security definer
as $$
declare
  v_row public.number_sequences%rowtype;
begin
  update public.number_sequences
    set current_value = current_value + 1
    where organization_id = p_org_id
      and sequence_key = p_sequence_key
    returning * into v_row;

  if not found then
    raise exception 'Sequence % not found for org %', p_sequence_key, p_org_id;
  end if;

  return v_row.prefix || lpad(v_row.current_value::text, v_row.padding, '0');
end;
$$;

-- ============================================================
-- EMAIL LOG
-- ============================================================

create table public.email_log (
  id                 uuid primary key default gen_random_uuid(),
  organization_id    uuid references public.organizations(id) on delete set null,
  user_id            uuid references public.profiles(id) on delete set null,
  to_address         citext not null,
  from_address       citext,
  subject            text,
  template           text,
  resend_message_id  text unique,
  status             text not null default 'queued'
                       check (status in ('queued','sent','delivered','opened','clicked',
                                         'bounced','complained','failed')),
  error_message      text,
  sent_at            timestamptz,
  delivered_at       timestamptz,
  opened_at          timestamptz,
  bounced_at         timestamptz,
  metadata           jsonb not null default '{}',
  created_at         timestamptz not null default now()
);
alter table public.email_log enable row level security;

create index idx_email_log_org       on public.email_log (organization_id);
create index idx_email_log_user      on public.email_log (user_id);
create index idx_email_log_to        on public.email_log (to_address);

-- ============================================================
-- GDPR CONSENT
-- ============================================================

create table public.consent_records (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid references public.profiles(id) on delete set null,
  dancer_id              uuid references public.dancers(id) on delete set null,
  organization_id        uuid references public.organizations(id) on delete set null,
  consent_type           text not null
                           check (consent_type in ('terms','privacy','marketing','photo','video',
                                                   'medical','parental','code_of_conduct')),
  document_version       text,
  given                  boolean not null,
  ip_address             inet,
  user_agent             text,
  given_by_name          text,
  given_by_relationship  text,
  created_at             timestamptz not null default now()
);
alter table public.consent_records enable row level security;

create index idx_consent_records_user    on public.consent_records (user_id);
create index idx_consent_records_dancer  on public.consent_records (dancer_id);

-- ============================================================
-- BACKGROUND JOBS
-- ============================================================

create table public.background_jobs (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid references public.organizations(id) on delete set null,
  job_type        text not null,
  payload         jsonb not null default '{}',
  status          text not null default 'queued'
                    check (status in ('queued','running','completed','failed','cancelled')),
  attempts        int not null default 0,
  max_attempts    int not null default 3,
  scheduled_for   timestamptz not null default now(),
  started_at      timestamptz,
  completed_at    timestamptz,
  error_message   text,
  result_path     text,
  result_metadata jsonb,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.background_jobs enable row level security;

create index idx_background_jobs_status on public.background_jobs (status, scheduled_for)
  where status in ('queued','running');
create index idx_background_jobs_org    on public.background_jobs (organization_id);

-- ============================================================
-- API KEYS & WEBHOOKS
-- ============================================================

-- api_keys
create table public.api_keys (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  key_prefix      text not null,
  key_hash        text not null,
  scopes          text[] not null default '{}',
  last_used_at    timestamptz,
  last_used_ip    inet,
  expires_at      timestamptz,
  revoked_at      timestamptz,
  revoked_by      uuid references public.profiles(id) on delete set null,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);
alter table public.api_keys enable row level security;

create index idx_api_keys_key_prefix on public.api_keys (key_prefix);
create index idx_api_keys_org        on public.api_keys (organization_id);

-- webhook_endpoints
create table public.webhook_endpoints (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  url             text not null,
  description     text,
  secret          text not null,
  events          text[] not null default '{}',
  is_active       boolean not null default true,
  failure_count   int not null default 0,
  last_success_at timestamptz,
  last_failure_at timestamptz,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.webhook_endpoints enable row level security;

create trigger webhook_endpoints_updated_at
  before update on public.webhook_endpoints
  for each row execute function public.handle_updated_at();

create index idx_webhook_endpoints_org on public.webhook_endpoints (organization_id);

-- webhook_deliveries
create table public.webhook_deliveries (
  id               uuid primary key default gen_random_uuid(),
  endpoint_id      uuid not null references public.webhook_endpoints(id) on delete cascade,
  event_type       text not null,
  event_id         uuid not null,
  payload          jsonb not null default '{}',
  status           text not null default 'pending'
                     check (status in ('pending','success','failed','retrying','dead')),
  attempts         int not null default 0,
  max_attempts     int not null default 8,
  response_status  int,
  response_body    text,
  response_headers jsonb,
  delivered_at     timestamptz,
  next_retry_at    timestamptz,
  created_at       timestamptz not null default now(),
  unique (endpoint_id, event_id)
);
alter table public.webhook_deliveries enable row level security;

create index idx_webhook_deliveries_status on public.webhook_deliveries (status, next_retry_at)
  where status in ('pending','retrying');
create index idx_webhook_deliveries_endpoint on public.webhook_deliveries (endpoint_id);

-- ============================================================
-- TAGS
-- ============================================================

-- tags
create table public.tags (
  id              uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  name            text not null,
  color           text not null default '#888888',
  description     text,
  created_by      uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now(),
  unique (organization_id, name)
);
alter table public.tags enable row level security;

-- entry_tags
create table public.entry_tags (
  entry_id  uuid not null references public.entries(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  tagged_by uuid references public.profiles(id) on delete set null,
  tagged_at timestamptz not null default now(),
  primary key (entry_id, tag_id)
);
alter table public.entry_tags enable row level security;

create index idx_entry_tags_tag on public.entry_tags (tag_id);

-- dancer_tags
create table public.dancer_tags (
  dancer_id uuid not null references public.dancers(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  tagged_by uuid references public.profiles(id) on delete set null,
  tagged_at timestamptz not null default now(),
  primary key (dancer_id, tag_id)
);
alter table public.dancer_tags enable row level security;

create index idx_dancer_tags_tag on public.dancer_tags (tag_id);

-- studio_tags
create table public.studio_tags (
  studio_id uuid not null references public.studios(id) on delete cascade,
  tag_id    uuid not null references public.tags(id) on delete cascade,
  tagged_by uuid references public.profiles(id) on delete set null,
  tagged_at timestamptz not null default now(),
  primary key (studio_id, tag_id)
);
alter table public.studio_tags enable row level security;

create index idx_studio_tags_tag on public.studio_tags (tag_id);

-- ============================================================
-- SAVED VIEWS
-- ============================================================

create table public.saved_views (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  organization_id uuid not null references public.organizations(id) on delete cascade,
  scope           text not null
                    check (scope in ('entries','studios','dancers','routines','invoices',
                                     'refunds','documents','audit_logs','conversations')),
  name            text not null,
  filters         jsonb not null default '{}',
  sort            jsonb not null default '{}',
  visible_columns text[] not null default '{}',
  is_shared       boolean not null default false,
  is_default      boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.saved_views enable row level security;

create trigger saved_views_updated_at
  before update on public.saved_views
  for each row execute function public.handle_updated_at();

create index idx_saved_views_user on public.saved_views (user_id);
create index idx_saved_views_org  on public.saved_views (organization_id);

-- ============================================================
-- MESSAGE MENTIONS
-- ============================================================

create table public.message_mentions (
  message_id        uuid not null references public.messages(id) on delete cascade,
  mentioned_user_id uuid not null references public.profiles(id) on delete cascade,
  notified_at       timestamptz,
  read_at           timestamptz,
  primary key (message_id, mentioned_user_id)
);
alter table public.message_mentions enable row level security;

create index idx_message_mentions_user on public.message_mentions (mentioned_user_id);

-- ============================================================
-- PHASE 2: RUNNING ORDERS
-- ============================================================

-- running_orders
create table public.running_orders (
  id           uuid primary key default gen_random_uuid(),
  event_id     uuid not null references public.events(id) on delete cascade,
  name         text not null,
  status       text not null default 'draft'
                 check (status in ('draft','published','locked')),
  published_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
alter table public.running_orders enable row level security;

create trigger running_orders_updated_at
  before update on public.running_orders
  for each row execute function public.handle_updated_at();

-- stages
create table public.stages (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null,
  sort_order int not null default 0
);
alter table public.stages enable row level security;

-- running_order_blocks
create table public.running_order_blocks (
  id               uuid primary key default gen_random_uuid(),
  running_order_id uuid not null references public.running_orders(id) on delete cascade,
  stage_id         uuid references public.stages(id) on delete set null,
  name             text,
  starts_at        timestamptz,
  ends_at          timestamptz,
  sort_order       int not null default 0
);
alter table public.running_order_blocks enable row level security;

-- running_order_slots
create table public.running_order_slots (
  id           uuid primary key default gen_random_uuid(),
  block_id     uuid not null references public.running_order_blocks(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,
  position     int not null,
  scheduled_at timestamptz,
  notes        text,
  unique (block_id, position)
);
alter table public.running_order_slots enable row level security;

-- clash_rules
create table public.clash_rules (
  id            uuid primary key default gen_random_uuid(),
  event_id      uuid not null references public.events(id) on delete cascade,
  rule_type     text not null
                  check (rule_type in ('dancer_min_gap','studio_min_gap','category_separation')),
  min_gap_slots int,
  severity      text not null default 'warning'
                  check (severity in ('warning','error')),
  config        jsonb not null default '{}'
);
alter table public.clash_rules enable row level security;

-- ============================================================
-- PHASE 3: JUDGING & SCORING
-- ============================================================

-- judges
create table public.judges (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  user_id         uuid references public.profiles(id) on delete set null,
  display_name    text not null,
  bio             text,
  photo_url       text,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.judges enable row level security;

-- judging_panels
create table public.judging_panels (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null,
  created_at timestamptz not null default now()
);
alter table public.judging_panels enable row level security;

-- judging_panel_members
create table public.judging_panel_members (
  id       uuid primary key default gen_random_uuid(),
  panel_id uuid not null references public.judging_panels(id) on delete cascade,
  judge_id uuid not null references public.judges(id) on delete cascade,
  is_head  boolean not null default false,
  unique (panel_id, judge_id)
);
alter table public.judging_panel_members enable row level security;

-- scoring_criteria
create table public.scoring_criteria (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  name            text not null,
  description     text,
  max_points      numeric(6,2) not null default 10,
  weight          numeric(4,2) not null default 1.0,
  sort_order      int not null default 0
);
alter table public.scoring_criteria enable row level security;

-- score_sheets
create table public.score_sheets (
  id           uuid primary key default gen_random_uuid(),
  entry_id     uuid not null references public.entries(id) on delete cascade,
  judge_id     uuid not null references public.judges(id) on delete cascade,
  panel_id     uuid references public.judging_panels(id) on delete set null,
  total_score  numeric(8,2),
  notes        text,
  is_locked    boolean not null default false,
  submitted_at timestamptz,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now(),
  unique (entry_id, judge_id)
);
alter table public.score_sheets enable row level security;

create trigger score_sheets_updated_at
  before update on public.score_sheets
  for each row execute function public.handle_updated_at();

-- scores (individual criteria scores within a score sheet)
create table public.scores (
  id               uuid primary key default gen_random_uuid(),
  score_sheet_id   uuid not null references public.score_sheets(id) on delete cascade,
  criteria_id      uuid not null references public.scoring_criteria(id) on delete cascade,
  value            numeric(6,2) not null,
  comment          text,
  unique (score_sheet_id, criteria_id)
);
alter table public.scores enable row level security;

-- awards
create table public.awards (
  id         uuid primary key default gen_random_uuid(),
  event_id   uuid not null references public.events(id) on delete cascade,
  name       text not null,
  category   text,
  sort_order int not null default 0,
  created_at timestamptz not null default now()
);
alter table public.awards enable row level security;

-- award_recipients
create table public.award_recipients (
  id           uuid primary key default gen_random_uuid(),
  award_id     uuid not null references public.awards(id) on delete cascade,
  entry_id     uuid references public.entries(id) on delete set null,
  dancer_id    uuid references public.dancers(id) on delete set null,
  studio_id    uuid references public.studios(id) on delete set null,
  placement    int,
  notes        text,
  announced_at timestamptz,
  created_at   timestamptz not null default now()
);
alter table public.award_recipients enable row level security;

-- ============================================================
-- PHASE 3: TICKETS
-- ============================================================

-- ticket_types
create table public.ticket_types (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  name            text not null,
  description     text,
  price_pence     int not null default 0,
  capacity        int,
  sold_count      int not null default 0,
  sale_starts_at  timestamptz,
  sale_ends_at    timestamptz,
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);
alter table public.ticket_types enable row level security;

-- ticket_purchases
create table public.ticket_purchases (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  ticket_type_id  uuid not null references public.ticket_types(id) on delete cascade,
  buyer_user_id   uuid references public.profiles(id) on delete set null,
  buyer_name      text not null,
  buyer_email     citext not null,
  buyer_phone     text,
  quantity        int not null default 1,
  total_pence     int not null,
  currency        text not null default 'GBP',
  stripe_payment_intent_id text,
  status          text not null default 'pending'
                    check (status in ('pending','confirmed','cancelled','refunded')),
  purchased_at    timestamptz,
  cancelled_at    timestamptz,
  qr_code_token   text unique,
  created_at      timestamptz not null default now()
);
alter table public.ticket_purchases enable row level security;

-- ticket_attendees
create table public.ticket_attendees (
  id                 uuid primary key default gen_random_uuid(),
  ticket_purchase_id uuid not null references public.ticket_purchases(id) on delete cascade,
  name               text not null,
  checked_in_at      timestamptz,
  checked_in_by      uuid references public.profiles(id) on delete set null
);
alter table public.ticket_attendees enable row level security;

-- ============================================================
-- PHASE 3: LIVESTREAM
-- ============================================================

create table public.livestream_sessions (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  stage_id        uuid references public.stages(id) on delete set null,
  title           text not null,
  stream_key      text,
  stream_url      text,
  playback_url    text,
  status          text not null default 'idle'
                    check (status in ('idle','live','ended')),
  started_at      timestamptz,
  ended_at        timestamptz,
  viewer_count    int not null default 0,
  is_public       boolean not null default false,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.livestream_sessions enable row level security;

create trigger livestream_sessions_updated_at
  before update on public.livestream_sessions
  for each row execute function public.handle_updated_at();

-- ============================================================
-- PHASE 3: MEDIA GALLERIES
-- ============================================================

-- media_galleries
create table public.media_galleries (
  id              uuid primary key default gen_random_uuid(),
  event_id        uuid not null references public.events(id) on delete cascade,
  name            text not null,
  description     text,
  is_public       boolean not null default false,
  requires_purchase boolean not null default false,
  price_pence     int not null default 0,
  created_at      timestamptz not null default now(),
  updated_at      timestamptz not null default now()
);
alter table public.media_galleries enable row level security;

create trigger media_galleries_updated_at
  before update on public.media_galleries
  for each row execute function public.handle_updated_at();

-- media_items
create table public.media_items (
  id              uuid primary key default gen_random_uuid(),
  gallery_id      uuid not null references public.media_galleries(id) on delete cascade,
  entry_id        uuid references public.entries(id) on delete set null,
  media_type      text not null check (media_type in ('photo','video')),
  storage_path    text not null,
  thumbnail_path  text,
  original_filename text,
  mime_type       text,
  size_bytes      bigint,
  width           int,
  height          int,
  duration_seconds int,
  sort_order      int not null default 0,
  uploaded_by     uuid references public.profiles(id) on delete set null,
  created_at      timestamptz not null default now()
);
alter table public.media_items enable row level security;

-- media_purchases
create table public.media_purchases (
  id              uuid primary key default gen_random_uuid(),
  user_id         uuid not null references public.profiles(id) on delete cascade,
  gallery_id      uuid references public.media_galleries(id) on delete set null,
  event_id        uuid not null references public.events(id) on delete cascade,
  total_pence     int not null,
  currency        text not null default 'GBP',
  stripe_payment_intent_id text,
  status          text not null default 'pending'
                    check (status in ('pending','completed','refunded')),
  purchased_at    timestamptz,
  created_at      timestamptz not null default now()
);
alter table public.media_purchases enable row level security;

-- media_purchase_items
create table public.media_purchase_items (
  id                uuid primary key default gen_random_uuid(),
  media_purchase_id uuid not null references public.media_purchases(id) on delete cascade,
  media_item_id     uuid not null references public.media_items(id) on delete cascade,
  price_pence       int not null,
  download_count    int not null default 0,
  last_downloaded_at timestamptz,
  unique (media_purchase_id, media_item_id)
);
alter table public.media_purchase_items enable row level security;
