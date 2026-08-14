-- =====================================================================
-- MULTI-FAMILY DEAL SHARING
--
-- Until now a deal was readable by exactly one person: every query carried
-- `owner_id = $me` and that check, in application code, IS the authorization —
-- the app connects with a privileged role that bypasses RLS (see src/db/index.ts
-- and the note in 0001). So widening access is a change to the security model,
-- not just a feature, and it is deliberately narrow:
--
--   * A grant names an EMAIL, not a profile id. The person you want to share
--     with may never have opened Feasible, so there is no profiles row to point
--     a foreign key at. Email is the durable identity; the access check joins it
--     to profiles at read time, so a grant made today starts working the moment
--     that person first signs in.
--
--   * Only two roles. 'viewer' can read the deal and nothing else. 'editor' can
--     also save it. NEITHER can delete the deal or manage its sharing — those
--     stay with the owner, so a collaborator can never lock the owner out or
--     hand the deal to someone else.
--
--   * The Workspace domain gate still applies on top of this. A grant to an
--     outside address is refused at invite time (lib/workspace.emailAllowed) and
--     would be useless anyway, since such an account can never hold a session.
--
-- Nothing here changes an existing deal: a deal with no rows in this table is
-- exactly as private as it was before.
-- =====================================================================

create table if not exists feasible.mf_deal_access (
    id          uuid primary key default gen_random_uuid(),
    deal_id     uuid not null references feasible.mf_deals (id) on delete cascade,

    -- Stored lowercased. The unique index below is on lower(email) as well, so a
    -- second grant to the same person in different casing is rejected by the
    -- database rather than relied on to be normalized by every call site.
    email       text not null,

    role        text not null default 'viewer' check (role in ('viewer', 'editor')),

    -- Who granted it. Kept for the audit trail; set null on profile delete so a
    -- departed employee's grants stay visible rather than cascading away.
    invited_by  uuid references feasible.profiles (id) on delete set null,
    created_at  timestamptz not null default now()
);

create unique index if not exists mf_deal_access_deal_email_idx
    on feasible.mf_deal_access (deal_id, lower(email));

-- The hot path: "which deals can this signed-in person see?" runs on every visit
-- to the deal list.
create index if not exists mf_deal_access_email_idx
    on feasible.mf_deal_access (lower(email));

comment on table feasible.mf_deal_access is
    'Per-deal collaborator grants, keyed by email so a grant can precede the person''s first sign-in. Owner-only to manage. See src/lib/mf-access.ts.';
comment on column feasible.mf_deal_access.role is
    'viewer = read only. editor = read + save. Neither can delete the deal or change its sharing; that stays with mf_deals.owner_id.';
