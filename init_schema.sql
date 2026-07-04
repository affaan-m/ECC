-- =================================================================
-- INIT SCHEMA — Full Postgres database for the Agent Memory System
-- =================================================================
-- Order: extensions → schemas → tables → indexes → RLS → partitions
-- Run once on a fresh Postgres instance with pgvector installed.
-- =================================================================

-- =================================================================
-- 0. EXTENSIONS
-- =================================================================

create extension if not exists vector;
create extension if not exists pgcrypto;    -- for gen_random_uuid()

-- =================================================================
-- 1. SCHEMAS
-- =================================================================

create schema if not exists event_store;
create schema if not exists memory;
create schema if not exists langgraph;

-- =================================================================
-- 2. TABLES
-- =================================================================
-- Order: event_store.events → typed_memory → memory_edges
--        → retrieval_logs → audit_log → pending_org_approvals
--        → trace_events → diagnostic_reports

-- =================================================================
-- 2a. LAYER 1: RAW EVENT STORE
-- =================================================================

create table event_store.events (
    id              uuid not null default gen_random_uuid(),
    event_type      text not null,
    source          text not null,
    user_id         text not null,
    session_id      text not null,
    org_id          text,
    role            text not null default 'user'
                    check (role in ('owner', 'admin', 'team', 'user', 'reader')),
    payload         jsonb not null,
    metadata        jsonb not null default '{}',
    idempotency_key text,
    processing_started_at timestamptz,
    processing_error text,
    processing_attempts integer not null default 0,
    processed_at    timestamptz,                    -- when the event->memory worker picked this up
    created_at      timestamptz not null default now(),

    constraint events_pk primary key (id, created_at)
) partition by range (created_at);

-- =================================================================
-- 2b. LAYER 2: TYPED MEMORY
-- =================================================================

create table memory.typed_memory (
    id              uuid not null default gen_random_uuid(),
    memory_type     text not null
                    check (memory_type in ('episodic', 'semantic', 'procedural')),
    category        text not null
                    check (category in (
                        'fact', 'preference', 'interaction', 'action_item',
                        'correction', 'procedure', 'knowledge_base', 'org_approved'
                    )),
    content         text not null,
    summary         text,
    user_id         text not null,
    session_id      text not null,
    org_id          text,
    role            text not null default 'user',
    visibility      text not null default 'team'
                    check (visibility in ('owner_only', 'team', 'org', 'public')),
    confidence      real not null default 1.0
                    check (confidence >= 0 and confidence <= 1.0),
    source          text not null default 'agent_inference'
                    check (source in (
                        'user_utterance', 'tool_result', 'agent_inference',
                        'knowledge_base_import', 'hermes_import',
                        'skillloop_proposal', 'vault_bridge',
                        'system_generated', 'test'
                    )),
    embedding       vector(1536),
    metadata        jsonb not null default '{}',
    expires_at      timestamptz,
    superseded_by   uuid references memory.typed_memory(id),
    source_event_id uuid,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),

    constraint typed_memory_pk primary key (id)
);

-- =================================================================
-- 2c. MEMORY GRAPH (edges between typed_memory entries)
-- =================================================================

create table memory.memory_edges (
    id              uuid not null default gen_random_uuid(),
    source_id       text not null,
    target_id       text not null,
    edge_type       text not null
                    check (edge_type in (
                        'related_to', 'contradicts', 'supersedes', 'supports',
                        'derived_from', 'part_of', 'references'
                    )),
    weight          real not null default 1.0
                    check (weight >= 0 and weight <= 1.0),
    created_by      text not null default 'system'
                    check (created_by in ('system', 'agent_inference', 'user_defined')),
    metadata        jsonb not null default '{}',
    created_at      timestamptz not null default now(),

    constraint memory_edges_pk primary key (id),
    constraint memory_edges_unique unique (source_id, target_id, edge_type)
);

-- =================================================================
-- 2d. RETRIEVAL LOGS (observability / debugging)
-- =================================================================

create table memory.retrieval_logs (
    id                  uuid not null default gen_random_uuid(),
    query               text not null,
    query_embedding     vector(1536),
    memory_type_filter  text,
    category_filter     text,
    retrieval_method    text not null
                        check (retrieval_method in (
                            'vector', 'fts', 'fts_only', 'hybrid', 'graph',
                            'direct_lookup'
                        )),
    results_count       integer not null default 0,
    memory_ids          uuid[],
    relevance_scores    real[],
    latency_ms          integer not null,
    user_id             text not null,
    session_id          text not null,
    trace_id            text,
    context_used        boolean,
    created_at          timestamptz not null default now(),

    constraint retrieval_logs_pk primary key (id)
);

-- =================================================================
-- 2e. AUDIT LOG (compliance / debugging)
-- =================================================================

create table memory.audit_log (
    id              uuid not null default gen_random_uuid(),
    event_type      text not null
                    check (event_type in (
                        'memory_written', 'memory_updated', 'memory_deleted',
                        'memory_read', 'permission_denied', 'system_lint',
                        'verification_failed', 'fail_closed', 'checkpoint_cleaned'
                    )),
    user_id         text not null,
    session_id      text,
    target_id       uuid,
    details         jsonb not null default '{}',
    created_at      timestamptz not null default now(),

    constraint audit_log_pk primary key (id)
);

-- =================================================================
-- 2f. PENDING ORG APPROVALS (Phase 3)
-- =================================================================

create table memory.pending_org_approvals (
    id              uuid not null default gen_random_uuid(),
    memory_id       uuid not null references memory.typed_memory(id) on delete cascade,
    proposed_by     text not null,
    proposed_at     timestamptz not null default now(),
    reviewed_by     text,
    reviewed_at     timestamptz,
    status          text not null default 'pending'
                    check (status in ('pending', 'approved', 'rejected')),
    review_notes    text,

    constraint pending_org_approvals_pk primary key (id)
);

-- =================================================================
-- 2g. TRACE EVENTS (diagnostic observability)
-- =================================================================

create table memory.trace_events (
    id              uuid not null default gen_random_uuid(),
    trace_id        text not null,
    step_name       text not null,
    status          text not null
                    check (status in ('ok', 'fallback', 'error', 'skipped')),
    source          text not null,
    user_id         text not null,
    org_id          text,
    session_id      text not null,
    latency_ms      integer,
    results_count   integer,
    error_message   text,
    details         jsonb not null default '{}',
    created_at      timestamptz not null default now(),

    constraint trace_events_pk primary key (id)
);

-- =================================================================
-- 2h. DIAGNOSTIC REPORTS (human-approved remediation queue)
-- =================================================================

create table memory.diagnostic_reports (
    id                  uuid not null default gen_random_uuid(),
    trace_id            text not null,
    user_id             text not null,
    org_id              text,
    session_id          text not null,
    issue_summary       text not null,
    trace_summary       text not null,
    proposed_fix        text not null,
    independent_reviews jsonb not null default '[]',
    next_steps          jsonb not null default '[]',
    approval_status     text not null default 'pending_human_approval'
                        check (approval_status in (
                            'pending_human_approval', 'approved',
                            'rejected', 'implemented'
                        )),
    approved_by         text,
    approved_at         timestamptz,
    created_at          timestamptz not null default now(),

    constraint diagnostic_reports_pk primary key (id)
);

-- =================================================================
-- 2i. DREAM RUNS (one row per dream.py invocation, run metadata)
--     Declared BEFORE dream_proposals so the foreign key can be added.
-- =================================================================

create table memory.dream_runs (
    run_id              uuid not null default gen_random_uuid(),
    user_id             text,  -- nullable: legacy/admin runs may not have one
    started_at          timestamptz not null default now(),
    finished_at         timestamptz,
    model               text,
    rows_scanned        integer not null default 0,
    proposals_count     integer not null default 0,
    adopted_count       integer not null default 0,
    rejected_count      integer not null default 0,
    skipped_count       integer not null default 0,
    summary             text,
    instructions        text,
    status              text not null default 'in_progress'
                        check (status in ('in_progress', 'completed', 'failed', 'discarded')),
    error_message       text,

    constraint dream_runs_pk primary key (run_id)
);

create index idx_dream_runs_status on memory.dream_runs (status, started_at desc);
create index idx_dream_runs_user on memory.dream_runs (user_id, started_at desc);

-- =================================================================
-- 2j. DREAM PROPOSALS (batch memory curation staging)
-- =================================================================
-- Populated by skills/memory-dream/scripts/dream.py. One row per
-- proposed action on an existing typed_memory row. ``adopt`` flips
-- the row to ``adopted`` and writes the actual change to typed_memory
-- (with superseded_by / audit_log). ``reject`` records the decision
-- without touching typed_memory.

create table memory.dream_proposals (
    id                          uuid not null default gen_random_uuid(),
    run_id                      uuid not null
                                references memory.dream_runs(run_id) on delete cascade,
    row_id                      uuid not null references memory.typed_memory(id) on delete cascade,
    action                      text not null
                                check (action in (
                                    'keep', 'merge', 'supersede',
                                    'archive', 'flag_for_review'
                                )),
    proposed_replacement        text,
    proposed_superseded_by_id   uuid references memory.typed_memory(id),
    confidence                  real not null default 0.5
                                check (confidence >= 0 and confidence <= 1.0),
    rationale                   text not null,
    reviewer_action             text
                                check (reviewer_action in ('adopted', 'rejected') or reviewer_action is null),
    reviewed_at                 timestamptz,
    created_at                  timestamptz not null default now(),

    constraint dream_proposals_pk primary key (id),
    constraint dream_proposals_unique_row unique (run_id, row_id)
);

create index idx_dream_proposals_run on memory.dream_proposals (run_id, created_at);
create index idx_dream_proposals_pending
    on memory.dream_proposals (created_at desc)
    where reviewer_action is null;

-- =================================================================
-- 3. INDEXES
-- =================================================================

-- 3a. Event store indexes
create index idx_events_user_session on event_store.events (user_id, session_id, created_at desc);
create index idx_events_type        on event_store.events (event_type, created_at desc);
create index idx_events_created_at  on event_store.events (created_at desc);
create index idx_events_unprocessed on event_store.events (created_at)
    where processed_at is null and processing_started_at is null;
create unique index idx_events_idempotency on event_store.events (idempotency_key, created_at)
    where idempotency_key is not null;

-- 3b. Typed memory indexes
create index idx_memory_lookup on memory.typed_memory (user_id, memory_type, category, created_at desc);
create index idx_memory_session on memory.typed_memory (session_id, created_at desc)
    where memory_type = 'episodic';
create index idx_memory_facts on memory.typed_memory (user_id, org_id, category)
    where memory_type = 'semantic' and confidence >= 0.7;
create index idx_memory_procedures on memory.typed_memory (user_id, category)
    where memory_type = 'procedural';
create index idx_memory_expiry on memory.typed_memory (expires_at)
    where expires_at is not null;
create unique index idx_memory_source_event on memory.typed_memory (source_event_id)
    where source_event_id is not null;

-- Full-text search index (hybrid retrieval)
create index idx_memory_fts on memory.typed_memory
    using gin(to_tsvector('english', coalesce(content, '') || ' ' || coalesce(summary, '')));

-- pgvector HNSW index
-- NOTE: Create this AFTER inserting ~1000+ rows for best index quality.
-- For <100K vectors, use IVFFlat instead (faster build, slightly slower query):
--   create index idx_memory_embedding on memory.typed_memory
--       using ivfflat (embedding vector_cosine_ops) with (lists = 100);
-- For >100K vectors, use HNSW:
--   create index idx_memory_embedding on memory.typed_memory
--       using hnsw (embedding vector_cosine_ops) with (m = 16, ef_construction = 200);

-- 3c. Memory edges indexes
create index idx_edges_source on memory.memory_edges (source_id, edge_type);
create index idx_edges_target on memory.memory_edges (target_id, edge_type);

-- 3d. Retrieval logs indexes
create index idx_retrieval_empty on memory.retrieval_logs (retrieval_method, created_at desc)
    where results_count = 0;
create index idx_retrieval_slow on memory.retrieval_logs (latency_ms desc, created_at desc)
    where latency_ms > 500;
create index idx_retrieval_user on memory.retrieval_logs (user_id, created_at desc);

-- 3e. Audit log indexes
create index idx_audit_event on memory.audit_log (event_type, created_at desc);
create index idx_audit_user on memory.audit_log (user_id, created_at desc);

-- 3f. Pending approvals index
create index idx_pending_approvals on memory.pending_org_approvals (status, proposed_at);

-- 3g. Trace and diagnostic indexes
create index idx_trace_events_trace on memory.trace_events (trace_id, created_at);
create index idx_trace_events_user on memory.trace_events (user_id, created_at desc);
create index idx_trace_events_error on memory.trace_events (status, created_at desc)
    where status in ('error', 'fallback');
create index idx_diagnostic_reports_pending on memory.diagnostic_reports (approval_status, created_at desc);
create index idx_diagnostic_reports_trace on memory.diagnostic_reports (trace_id);

-- =================================================================
-- 4. ROW-LEVEL SECURITY
-- =================================================================

-- Helper functions
create or replace function memory.get_current_user_id() returns text as $$
    select current_setting('app.current_user', true);
$$ language sql stable;

create or replace function memory.get_current_org_id() returns text as $$
    select current_setting('app.current_org', true);
$$ language sql stable;

create or replace function memory.get_current_role() returns text as $$
    select current_setting('app.current_role', true);
$$ language sql stable;

create or replace function memory.has_trusted_service_identity() returns boolean as $$
    select
        current_user in ('postgres', 'service_role', 'agent_memory_service', 'ecc_service')
        or session_user in ('postgres', 'service_role', 'agent_memory_service', 'ecc_service')
        or (
            to_regrole('memory_service') is not null
            and pg_has_role(current_user, 'memory_service', 'member')
        );
$$ language sql stable;

create or replace function memory.is_service_role() returns boolean as $$
    select memory.get_current_role() = 'service'
       and memory.has_trusted_service_identity();
$$ language sql stable;

-- 4a. typed_memory RLS
alter table memory.typed_memory enable row level security;
alter table memory.typed_memory force row level security;

create policy service_all on memory.typed_memory
    for all
    using (memory.is_service_role())
    with check (memory.is_service_role());

create policy memory_select on memory.typed_memory
    for select
    using (
        user_id = memory.get_current_user_id()
        or (
            visibility in ('team', 'org')
            and org_id is not null
            and org_id = memory.get_current_org_id()
        )
        or visibility = 'public'
    );

create policy user_insert on memory.typed_memory
    for insert
    with check (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    );

create policy user_update on memory.typed_memory
    for update
    using (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    )
    with check (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    );

create policy reader_select on memory.typed_memory
    for select
    using (
        visibility = 'org'
        and memory.get_current_role() = 'reader'
        and org_id is not null
        and org_id = memory.get_current_org_id()
    );

-- 4b. memory_edges RLS
alter table memory.memory_edges enable row level security;
alter table memory.memory_edges force row level security;

create policy edge_select on memory.memory_edges
    for select
    using (
        exists (
            select 1
            from memory.typed_memory source_memory
            join memory.typed_memory target_memory
              on target_memory.id = case
                  when memory_edges.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then memory_edges.target_id::uuid
                  else null
              end
            where source_memory.id = case
                  when memory_edges.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
                  then memory_edges.source_id::uuid
                  else null
              end
              and source_memory.user_id = target_memory.user_id
              and (
                source_memory.user_id = memory.get_current_user_id()
                or target_memory.user_id = memory.get_current_user_id()
                or (
                    source_memory.visibility in ('team', 'org', 'public')
                    and target_memory.visibility in ('team', 'org', 'public')
                    and source_memory.org_id is not null
                    and source_memory.org_id = memory.get_current_org_id()
                    and target_memory.org_id = source_memory.org_id
                )
                or (
                    source_memory.visibility = 'public'
                    and target_memory.visibility = 'public'
                )
                or memory.is_service_role()
              )
        )
        or memory.is_service_role()
    );

create policy edge_service_all on memory.memory_edges
    for all
    using (memory.is_service_role())
    with check (memory.is_service_role());

-- 4c. event_store.events RLS
alter table event_store.events enable row level security;
alter table event_store.events force row level security;

create policy event_service_all on event_store.events
    for all
    using (memory.is_service_role())
    with check (memory.is_service_role());

create policy event_user_select on event_store.events
    for select
    using (
        user_id = memory.get_current_user_id()
        or (
            org_id is not null
            and org_id = memory.get_current_org_id()
            and memory.get_current_role() in ('owner', 'admin')
        )
    );

-- 4d. retrieval_logs RLS
alter table memory.retrieval_logs enable row level security;
alter table memory.retrieval_logs force row level security;

create policy retrieval_log_select on memory.retrieval_logs
    for select
    using (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    );

create policy retrieval_log_insert on memory.retrieval_logs
    for insert
    with check (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    );

create policy retrieval_log_service_delete on memory.retrieval_logs
    for delete
    using (memory.is_service_role());

-- 4e. audit_log RLS
alter table memory.audit_log enable row level security;
alter table memory.audit_log force row level security;

create policy audit_select on memory.audit_log
    for select
    using (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    );

create policy audit_insert on memory.audit_log
    for insert
    with check (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    );

create policy audit_service_delete on memory.audit_log
    for delete
    using (memory.is_service_role());

-- 4f. pending_org_approvals RLS
alter table memory.pending_org_approvals enable row level security;
alter table memory.pending_org_approvals force row level security;

create policy pending_approvals_service_all on memory.pending_org_approvals
    for all
    using (memory.is_service_role())
    with check (memory.is_service_role());

create policy pending_approvals_org_select on memory.pending_org_approvals
    for select
    using (
        exists (
            select 1
            from memory.typed_memory tm
            where tm.id = memory_id
              and tm.org_id is not null
              and tm.org_id = memory.get_current_org_id()
              and memory.get_current_role() in ('owner', 'admin')
        )
    );

-- 4g. trace_events RLS
alter table memory.trace_events enable row level security;
alter table memory.trace_events force row level security;

create policy trace_events_select on memory.trace_events
    for select
    using (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
        or (
            org_id is not null
            and org_id = memory.get_current_org_id()
            and memory.get_current_role() in ('owner', 'admin')
        )
    );

create policy trace_events_insert on memory.trace_events
    for insert
    with check (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    );

create policy trace_events_service_delete on memory.trace_events
    for delete
    using (memory.is_service_role());

-- 4h. diagnostic_reports RLS
alter table memory.diagnostic_reports enable row level security;
alter table memory.diagnostic_reports force row level security;

create policy diagnostic_reports_select on memory.diagnostic_reports
    for select
    using (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
        or (
            org_id is not null
            and org_id = memory.get_current_org_id()
            and memory.get_current_role() in ('owner', 'admin')
        )
    );

create policy diagnostic_reports_insert on memory.diagnostic_reports
    for insert
    with check (
        memory.is_service_role()
        or user_id = memory.get_current_user_id()
    );

create policy diagnostic_reports_update_approval on memory.diagnostic_reports
    for update
    using (
        memory.is_service_role()
        or (
            org_id is not null
            and org_id = memory.get_current_org_id()
            and memory.get_current_role() in ('owner', 'admin')
        )
    )
    with check (
        memory.is_service_role()
        or (
            org_id is not null
            and org_id = memory.get_current_org_id()
            and memory.get_current_role() in ('owner', 'admin')
        )
    );

-- 4i. dream_runs RLS
alter table memory.dream_runs enable row level security;
alter table memory.dream_runs force row level security;

create policy dream_runs_service_all on memory.dream_runs
    for all
    using (memory.is_service_role())
    with check (memory.is_service_role());

create policy dream_runs_user_select on memory.dream_runs
    for select
    using (
        user_id = memory.get_current_user_id()
    );

create policy dream_runs_user_insert on memory.dream_runs
    for insert
    with check (
        user_id = memory.get_current_user_id()
    );

create policy dream_runs_user_update on memory.dream_runs
    for update
    using (
        user_id = memory.get_current_user_id()
    )
    with check (
        user_id = memory.get_current_user_id()
    );

-- 4j. dream_proposals RLS
alter table memory.dream_proposals enable row level security;
alter table memory.dream_proposals force row level security;

create policy dream_proposals_service_all on memory.dream_proposals
    for all
    using (memory.is_service_role())
    with check (memory.is_service_role());

create policy dream_proposals_user_select on memory.dream_proposals
    for select
    using (
        exists (
            select 1
            from memory.dream_runs r
            join memory.typed_memory tm on tm.id = dream_proposals.row_id
            where r.run_id = dream_proposals.run_id
              and r.user_id = memory.get_current_user_id()
              and tm.user_id = memory.get_current_user_id()
        )
    );

create policy dream_proposals_user_insert on memory.dream_proposals
    for insert
    with check (
        exists (
            select 1
            from memory.dream_runs r
            join memory.typed_memory tm on tm.id = dream_proposals.row_id
            where r.run_id = dream_proposals.run_id
              and r.user_id = memory.get_current_user_id()
              and tm.user_id = memory.get_current_user_id()
        )
    );

create policy dream_proposals_user_update on memory.dream_proposals
    for update
    using (
        exists (
            select 1
            from memory.dream_runs r
            join memory.typed_memory tm on tm.id = dream_proposals.row_id
            where r.run_id = dream_proposals.run_id
              and r.user_id = memory.get_current_user_id()
              and tm.user_id = memory.get_current_user_id()
        )
    )
    with check (
        exists (
            select 1
            from memory.dream_runs r
            join memory.typed_memory tm on tm.id = dream_proposals.row_id
            where r.run_id = dream_proposals.run_id
              and r.user_id = memory.get_current_user_id()
              and tm.user_id = memory.get_current_user_id()
        )
    );

-- =================================================================
-- 5. EVENT STORE PARTITIONS (create first batch)
-- =================================================================

create table event_store.events_2026_05
    partition of event_store.events
    for values from ('2026-05-01') to ('2026-06-01');

create table event_store.events_2026_06
    partition of event_store.events
    for values from ('2026-06-01') to ('2026-07-01');

create table event_store.events_2026_07
    partition of event_store.events
    for values from ('2026-07-01') to ('2026-08-01');

create table event_store.events_default
    partition of event_store.events default;

-- Monthly partition creation function
create or replace function event_store.create_monthly_partition()
returns void as $$
declare
    next_month text;
    start_date text;
    end_date text;
begin
    next_month := to_char(now() + interval '1 month', 'YYYY_MM');
    start_date := to_char(date_trunc('month', now() + interval '1 month'), 'YYYY-MM-DD');
    end_date   := to_char(date_trunc('month', now() + interval '2 months'), 'YYYY-MM-DD');

    execute format(
        'create table if not exists event_store.events_%s
         partition of event_store.events
         for values from (%L) to (%L)',
        next_month, start_date, end_date
    );
end;
$$ language plpgsql;

-- Run via pg_cron once a month:
-- select cron.schedule('create-event-partition', '0 0 1 * *',
--     $$select event_store.create_monthly_partition()$$);

-- =================================================================
-- 6. DATA CLEANUP FUNCTIONS
-- =================================================================

-- 6a. Drop old event partitions (retention: 90 days)
-- Uses partition bound parsing to determine age:
--   partition bound looks like: FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')
--   we check if the UPPER bound (TO) is older than retention_days
create or replace function event_store.drop_old_partitions(retention_days int default 90)
returns void as $$
declare
    rec record;
    upper_bound date;
begin
    for rec in
        select
            inhrelid::regclass::text as partition_name,
            pg_get_expr(relpartbound, inhrelid) as partition_bound
        from pg_inherits
        where inhparent = 'event_store.events'::regclass
    loop
        begin
            -- Extract the upper date bound from the partition range expression
            -- Format: FOR VALUES FROM ('2026-05-01') TO ('2026-06-01')
            upper_bound := split_part(
                split_part(rec.partition_bound, 'TO (', 2),
                ')', 1
            )::date;

            if upper_bound < current_date - retention_days then
                execute format('drop table if exists %s', rec.partition_name);
                raise notice 'Dropped old partition: % (upper bound: %)',
                    rec.partition_name, upper_bound;
            end if;
        exception when others then
            raise warning 'Could not parse partition bound for %: %',
                rec.partition_name, rec.partition_bound;
        end;
    end loop;
end;
$$ language plpgsql;

-- Run weekly:
-- select cron.schedule('drop-old-event-partitions', '0 0 * * 0',
--     $$select event_store.drop_old_partitions(90)$$);

-- 6b. LangGraph checkpoint cleanup
-- LangGraph checkpoint tables are created by the LangGraph checkpoint package,
-- not by this bootstrap schema. Add checkpoint cleanup in a later migration
-- after those tables exist.

-- 6c. Clean up retrieval logs (retention: 30 days)
--
-- Returns the total deleted row count so the caller (the application-
-- side hygiene worker) can record an accurate metric. The previous
-- version returned ``void`` which forced ``run_hygiene_pass`` to
-- fake the count with ``(result IS NULL)::int`` (always 1). This
-- change makes the metric honest.
create or replace function event_store.cleanup_retrieval_logs()
returns integer as $$
declare
    retrieval_deleted integer;
    trace_deleted integer;
begin
    delete from memory.retrieval_logs
    where created_at < now() - interval '30 days';
    get diagnostics retrieval_deleted = row_count;

    delete from memory.trace_events
    where created_at < now() - interval '30 days';
    get diagnostics trace_deleted = row_count;

    return retrieval_deleted + trace_deleted;
end;
$$ language plpgsql;

-- Run daily:
-- select cron.schedule('cleanup-retrieval-logs', '0 4 * * *',
--     $$select event_store.cleanup_retrieval_logs()$$);

-- 6d. Clean up expired typed_memory rows (TTL)
create or replace function memory.cleanup_expired_memory()
returns integer as $$
declare
    deleted_count integer;
begin
    delete from memory.typed_memory
    where expires_at is not null
      and expires_at < now();
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$ language plpgsql;

-- Run every minute via pg_cron, or call from application-side background thread:
-- select cron.schedule('cleanup-expired-memory', '* * * * *',
--     $$select memory.cleanup_expired_memory()$$);

-- 6e. Clean up orphan memory_edges
--
-- Edges in memory.memory_edges reference typed_memory rows by id
-- (source_id, target_id). When a typed_memory row is deleted (e.g.
-- by cleanup_expired_memory or by a supersede in memory-dream) the
-- edges pointing to it become orphans. They never surface in graph
-- queries (the join on typed_memory filters them out) but they
-- accumulate in storage. This function deletes any edge whose
-- source or target no longer exists.
--
-- Returns the number of edges deleted so the caller can record the
-- metric in telemetry.
create or replace function memory.cleanup_orphan_edges()
returns integer as $$
declare
    deleted_count integer;
begin
    delete from memory.memory_edges e
    where not exists (
        select 1 from memory.typed_memory m
        where m.id = case
            when e.source_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then e.source_id::uuid
            else null
        end
    )
    or not exists (
        select 1 from memory.typed_memory m
        where m.id = case
            when e.target_id ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$'
            then e.target_id::uuid
            else null
        end
    );
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$ language plpgsql;

-- 6f. Clean up old audit_log rows (retention: 90 days)
--
-- The audit_log is unbounded growth: every memory write, read,
-- and permission check appends a row. Without a TTL the table
-- grows by 100s of rows per day per active user. Retention of
-- 90 days is enough for incident review and compliance audits
-- without keeping the table a permanent write log.
create or replace function memory.cleanup_audit_log()
returns integer as $$
declare
    deleted_count integer;
begin
    delete from memory.audit_log
    where created_at < now() - interval '90 days';
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$ language plpgsql;

-- Run weekly via the hygiene worker (less frequent than the
-- hourly expired-memory sweep):
-- select cron.schedule('cleanup-audit-log', '0 3 * * 0',
--     $$select memory.cleanup_audit_log()$$);

-- 6g. Clean up stale pending_org_approvals (older than 30 days)
--
-- A pending approval is a memory row that requires human review
-- before it goes live. If the reviewer never acts, the row sits
-- in 'pending' status forever. We delete rows that have been
-- 'pending' for more than 30 days; the original memory row (in
-- typed_memory) is unaffected and can still be re-proposed if
-- needed.
create or replace function memory.cleanup_pending_org_approvals()
returns integer as $$
declare
    deleted_count integer;
begin
    delete from memory.pending_org_approvals
    where status = 'pending'
      and proposed_at < now() - interval '30 days';
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$ language plpgsql;

-- 6h. Clean up old dream_runs (terminal states, retention: 30 days)
--
-- dream_runs accumulates one row per memory-dream.py invocation.
-- In-flight rows (status='in_progress') are kept; only terminal
-- states (completed, failed, discarded) older than 30 days are
-- removed. dream_proposals cascade-delete via the FK so the
-- staging table is cleaned up with its run.
create or replace function memory.cleanup_old_dream_runs()
returns integer as $$
declare
    deleted_count integer;
begin
    delete from memory.dream_runs
    where status in ('completed', 'failed', 'discarded')
      and finished_at is not null
      and finished_at < now() - interval '30 days';
    get diagnostics deleted_count = row_count;
    return deleted_count;
end;
$$ language plpgsql;

-- 6i. Updated run_hygiene_pass() to include the new cleanups.
--
-- The expanded pass covers every unbounded-growth table identified
-- in the hygiene review (subagent deleg_6dc17f25): retrieval logs,
-- expired memory, orphan edges, audit log, stale approvals, old
-- dream runs. All return ``integer`` so the UNION ALL is uniform.
create or replace function memory.run_hygiene_pass()
returns table(operation text, deleted_count integer) as $$
begin
    return query
        select 'retrieval_logs'::text, event_store.cleanup_retrieval_logs()
        union all
        select 'expired_memory'::text, memory.cleanup_expired_memory()
        union all
        select 'orphan_edges'::text, memory.cleanup_orphan_edges()
        union all
        select 'audit_log'::text, memory.cleanup_audit_log()
        union all
        select 'pending_approvals'::text, memory.cleanup_pending_org_approvals()
        union all
        select 'old_dream_runs'::text, memory.cleanup_old_dream_runs();
end;
$$ language plpgsql;

-- =================================================================
-- 7. USEFUL VIEWS
-- =================================================================

-- What does the agent know about a specific user?
create view memory.user_facts as
select
    id,
    memory_type,
    category,
    content,
    summary,
    confidence,
    source,
    created_at,
    updated_at
from memory.typed_memory
where memory_type = 'semantic'
  and confidence >= 0.7
order by confidence desc, created_at desc;

-- Retrieval quality: queries that returned nothing
create view memory.retrieval_zeros as
select
    query,
    retrieval_method,
    latency_ms,
    user_id,
    created_at
from memory.retrieval_logs
where results_count = 0
order by created_at desc;

-- Retrieval quality: slow queries
create view memory.retrieval_slow as
select
    query,
    retrieval_method,
    latency_ms,
    results_count,
    user_id,
    created_at
from memory.retrieval_logs
where latency_ms > 1000
order by latency_ms desc;

-- Checkpoint growth views intentionally live in a later migration because
-- langgraph.checkpoints does not exist on a fresh database bootstrap.

-- =================================================================
-- 8. VERIFICATION QUERIES (run after schema creation)
-- =================================================================

-- Run these to verify the schema was created correctly:
--
-- select table_name, table_schema
-- from information_schema.tables
-- where table_schema in ('event_store', 'memory', 'langgraph')
-- order by table_schema, table_name;
--
-- select * from event_store.events limit 1;
-- select * from memory.typed_memory limit 1;
-- select * from memory.retrieval_zeros limit 5;
