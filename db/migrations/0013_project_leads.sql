-- =====================================================================
-- WHO IS ASKING ABOUT THIS PROJECT — leads read out of Follow Up Boss.
--
-- The sales side of a development lives in FUB, not here: Nick logs every
-- call-in, showing and follow-up as a note on a person tagged with the
-- project's name. That is the real record of demand, and until now the
-- project's page in Feasible could not see any of it.
--
-- FUB STAYS THE SYSTEM OF RECORD. Nothing below is a copy of the CRM — it is
-- a dated READING of it. `feasible.project_lead_reads` stores one row per
-- refresh: how many leads carried the tag at that moment, a rollup of their
-- stages/sources/staleness, and the narrative a model wrote from their notes.
-- Kept as history rather than a single mutable row for the same reason
-- investor_updates are (0010): "what did this project's pipeline look like in
-- August" is a question worth being able to answer later, and a summary that
-- overwrites itself can never answer it.
--
-- READ-ONLY, one direction. Feasible never writes to Follow Up Boss from here.
-- =====================================================================

-- Which FUB tag identifies this project's leads. NULL means "use the project
-- name", which is already true for The Enclave — the tag in FUB is the name of
-- the community. An explicit value is for the day a project's tag drifts from
-- its name, which is a data-entry accident waiting to happen and should not
-- require a migration to fix.
alter table feasible.mf_deals
    add column if not exists fub_lead_tag text;

comment on column feasible.mf_deals.fub_lead_tag is
    'Follow Up Boss tag whose people are this project''s leads. NULL = fall back to the project name.';

create table if not exists feasible.project_lead_reads (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references feasible.mf_deals (id) on delete cascade,

    -- Snapshotted, not joined: the tag may be changed later, and this row is a
    -- record of what was actually read.
    tag             text not null,
    lead_count      integer not null default 0,

    -- Counts by stage / source / owner, plus new-this-month and gone-quiet.
    -- Computed in code (src/lib/leads.ts) from the FUB payload, so the numbers
    -- on the page are arithmetic and only the prose is a model's opinion.
    stats           jsonb not null default '{}'::jsonb,

    -- What the model wrote. `headline` is the one-line answer; `summary` is the
    -- paragraphs; `themes` and `attention` are its structured lists.
    headline        text,
    summary         text,
    themes          jsonb not null default '[]'::jsonb,
    attention       jsonb not null default '[]'::jsonb,

    -- Which model, so a summary written by an older one is identifiable later.
    model           text,
    generated_by    uuid references feasible.profiles (id) on delete set null,
    created_at      timestamptz not null default now()
);
create index if not exists project_lead_reads_idx
    on feasible.project_lead_reads (project_id, created_at desc);

comment on table feasible.project_lead_reads is
    'A dated reading of the project''s Follow Up Boss leads. FUB remains the system of record; this is never written back to it.';
