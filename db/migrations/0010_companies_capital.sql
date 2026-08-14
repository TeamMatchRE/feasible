-- =====================================================================
-- COMPANIES, PROJECT LIFECYCLE, AND THE CAPITAL RAISE
--
-- Feasible was a single-operator tool: one person's studies, one person's
-- deals. Heritage Point Development is a second company with its own partners,
-- its own investor base, its own Drive, and its own branding on anything that
-- goes out by email. Mixing that into one global pool would mean an HPD
-- investor list visible from a Brooke Group deal, and — worse — an investor
-- update going out under the wrong letterhead.
--
-- So a COMPANY owns projects, investors and branding. Membership is keyed by
-- email for the same reason deal sharing is (0008): a partner may not have
-- opened Feasible yet, and email is the durable identity.
--
-- A project (still mf_deals — the underwriting model is unchanged) gains a
-- STAGE, because underwriting is only the first act. The stages mirror the
-- folders Heritage Point already keeps in Drive, which is the strongest
-- evidence available that they are the real ones.
--
-- ⚠️ LEGAL POSTURE. This schema stores and tracks a securities offering. The
-- document rows below are a FILING CABINET and a drafting aid — nothing here
-- makes an offer, verifies accreditation, or replaces counsel-reviewed
-- subscription documents. Anything generated is a draft until a human sends it.
-- =====================================================================

create table if not exists feasible.companies (
    id                  uuid primary key default gen_random_uuid(),
    slug                text not null unique,
    name                text not null,
    legal_name          text,
    tagline             text,
    website             text,

    -- Branding for anything outbound. JSONB because it is read and written
    -- whole by one editor and the shape will grow (logo, letterhead, footer).
    brand               jsonb not null default '{}'::jsonb,

    -- The Drive folder this company's projects live under. Null until someone
    -- connects Google Drive.
    drive_root_folder_id text,

    -- Who outbound investor mail comes from.
    email_from_name     text,
    email_from_address  text,

    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create table if not exists feasible.company_members (
    id          uuid primary key default gen_random_uuid(),
    company_id  uuid not null references feasible.companies (id) on delete cascade,
    email       text not null,
    role        text not null default 'member' check (role in ('owner', 'member')),
    created_at  timestamptz not null default now()
);
create unique index if not exists company_members_unique_idx
    on feasible.company_members (company_id, lower(email));
create index if not exists company_members_email_idx
    on feasible.company_members (lower(email));

-- ---------------------------------------------------------------------
-- Projects gain an owner company and a lifecycle stage.
-- ---------------------------------------------------------------------
alter table feasible.mf_deals
    add column if not exists company_id uuid references feasible.companies (id) on delete set null,
    add column if not exists stage text not null default 'underwriting'
        check (stage in ('underwriting', 'offer', 'due_diligence', 'financing',
                         'capital_raise', 'construction', 'sales', 'closed'));

comment on column feasible.mf_deals.stage is
    'Where the project is: underwriting → offer → due_diligence → financing → capital_raise → construction → sales → closed. Mirrors the Drive folder structure Heritage Point keeps.';

-- ---------------------------------------------------------------------
-- INVESTORS — a company's book, independent of any one project.
-- Someone who backed one deal is a prospect for the next.
-- ---------------------------------------------------------------------
create table if not exists feasible.investors (
    id              uuid primary key default gen_random_uuid(),
    company_id      uuid not null references feasible.companies (id) on delete cascade,

    name            text not null,
    -- An investor often subscribes through an LLC or a trust; the person is who
    -- you email, the entity is who signs.
    entity_name     text,
    email           text,
    phone           text,
    address         text,

    -- Follow Up Boss person id, so the contact record stays one record.
    fub_person_id   text,

    notes           text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create index if not exists investors_company_idx on feasible.investors (company_id, name);

-- ---------------------------------------------------------------------
-- INVESTMENTS — one investor's participation in one project.
--
-- committed vs contributed are deliberately separate: a signed commitment is
-- not cash in the account, and a raise that reports them as one number is
-- lying to itself about whether it has closed.
-- ---------------------------------------------------------------------
create table if not exists feasible.investments (
    id                  uuid primary key default gen_random_uuid(),
    project_id          uuid not null references feasible.mf_deals (id) on delete cascade,
    investor_id         uuid not null references feasible.investors (id) on delete cascade,

    committed_amount    numeric(14,2) not null default 0,
    contributed_amount  numeric(14,2) not null default 0,
    -- Optional; left null when the operating agreement decides splits instead.
    ownership_pct       numeric(7,4),

    status              text not null default 'prospect'
        check (status in ('prospect', 'soft_circle', 'committed', 'funded', 'closed')),

    committed_at        date,
    funded_at           date,
    notes               text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create unique index if not exists investments_unique_idx
    on feasible.investments (project_id, investor_id);

-- ---------------------------------------------------------------------
-- INVESTMENT DOCUMENTS — the filing cabinet.
--
-- Signatures are WET: Feasible drafts, a human sends, the investor signs on
-- paper, and the scan goes back to Drive. `drive_file_id` is where it landed.
-- Nothing here is an e-signature flow and it should not pretend to be one.
-- ---------------------------------------------------------------------
create table if not exists feasible.investment_documents (
    id              uuid primary key default gen_random_uuid(),
    investment_id   uuid not null references feasible.investments (id) on delete cascade,

    kind            text not null default 'other'
        check (kind in ('offering', 'commitment', 'subscription', 'operating_agreement',
                        'wire_instructions', 'k1', 'other')),
    name            text not null,
    status          text not null default 'draft'
        check (status in ('draft', 'sent', 'signed', 'filed')),

    -- Draft body lives here until it is filed; then Drive holds the signed PDF.
    body_markdown   text,
    drive_file_id   text,
    drive_url       text,

    sent_at         timestamptz,
    signed_at       timestamptz,
    created_at      timestamptz not null default now()
);
create index if not exists investment_documents_idx on feasible.investment_documents (investment_id, created_at);

-- ---------------------------------------------------------------------
-- LOTS — the revenue side of a for-sale project, one row per home.
--
-- The Enclave sells 8 homes, not 8 "units of a mix": each has its own buyer,
-- its own contract date and its own closing. Projected proceeds and the cash
-- flow curve are computed from these, so they must be per-lot.
-- ---------------------------------------------------------------------
create table if not exists feasible.project_lots (
    id                  uuid primary key default gen_random_uuid(),
    project_id          uuid not null references feasible.mf_deals (id) on delete cascade,

    lot_number          text not null,
    style               text,                    -- 'Ranch', 'Cape'
    list_price          numeric(14,2) not null default 0,
    sale_price          numeric(14,2),           -- null until under contract

    status              text not null default 'available'
        check (status in ('available', 'reserved', 'under_contract', 'closed', 'held')),

    buyer_name          text,
    contract_date       date,
    projected_closing   date,
    actual_closing      date,

    -- Per-lot cost to build, when it differs from the program average.
    build_cost          numeric(14,2),
    notes               text,
    sort_order          integer not null default 0
);
create index if not exists project_lots_idx on feasible.project_lots (project_id, sort_order);

-- ---------------------------------------------------------------------
-- INVESTOR UPDATES — what went out, and what it said.
--
-- `brief` is what the human typed. `body_*` is what the model wrote from it.
-- Both are kept: the brief is the source of truth about intent, and being able
-- to see what was actually sent months later is the whole point of a record.
-- ---------------------------------------------------------------------
create table if not exists feasible.investor_updates (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references feasible.mf_deals (id) on delete cascade,

    brief           text not null,
    subject         text,
    body_html       text,
    body_text       text,

    status          text not null default 'draft'
        check (status in ('draft', 'approved', 'sent')),

    -- Snapshot of who it went to, so a later change to the investor list does
    -- not rewrite history.
    recipients      jsonb not null default '[]'::jsonb,

    created_by      uuid references feasible.profiles (id) on delete set null,
    created_at      timestamptz not null default now(),
    sent_at         timestamptz
);
create index if not exists investor_updates_idx on feasible.investor_updates (project_id, created_at desc);

-- ---------------------------------------------------------------------
-- DRIVE LINKS — a project's folders, by phase.
-- Populated when Google Drive is connected; harmless and empty until then.
-- ---------------------------------------------------------------------
create table if not exists feasible.project_drive_links (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references feasible.mf_deals (id) on delete cascade,
    label           text not null,
    stage           text,
    folder_id       text not null,
    url             text,
    created_at      timestamptz not null default now()
);
create unique index if not exists project_drive_links_unique_idx
    on feasible.project_drive_links (project_id, folder_id);

-- ---------------------------------------------------------------------
-- Google OAuth tokens, per user, for Drive.
--
-- Separate from the Supabase session on purpose: Supabase's Google sign-in does
-- not carry Drive scopes, so connecting Drive is a second, explicit consent the
-- user grants once. Refresh token only — access tokens are short-lived and
-- fetched on demand.
-- ---------------------------------------------------------------------
create table if not exists feasible.google_connections (
    id              uuid primary key default gen_random_uuid(),
    profile_id      uuid not null references feasible.profiles (id) on delete cascade,
    email           text,
    refresh_token   text not null,
    scopes          text,
    connected_at    timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);
create unique index if not exists google_connections_profile_idx
    on feasible.google_connections (profile_id);

comment on table feasible.google_connections is
    'Per-user Google refresh token for Drive. Supabase auth does not carry Drive scopes, so this is a separate explicit consent. Never expose to the client.';
