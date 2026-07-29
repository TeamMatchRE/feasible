-- =====================================================================
-- MULTI-FAMILY — large MF underwriting (build-to-rent vs sell out vs blend)
--
-- Backs the Multi-Family tab. The shape follows the Procopio Companies model
-- David's partners underwrite with (see src/lib/multifamily.ts): a unit mix with
-- market and affordable tiers, other income, an opex build, and one cost basis
-- that three different exits are measured against.
--
-- Assumptions live in JSONB rather than 40 columns. They're read and written as a
-- whole object by one editor, they're versioned by the app not the database, and
-- the model grows — a rate curve and a waterfall are coming. Anything the app
-- needs to LIST or SORT by (name, city, units, cost) stays a real column.
-- =====================================================================

create table if not exists feasible.mf_deals (
    id                  uuid primary key default gen_random_uuid(),
    owner_id            uuid not null references feasible.profiles (id) on delete cascade,

    -- Identity
    name                text not null,
    address             text,
    city                text,
    state               text default 'CT',

    -- Property level (Assumptions!B2:D16)
    gross_sqft          numeric(12,2),
    commercial_sqft     numeric(12,2) default 0,
    height_stories      integer,
    garage_spaces       integer default 0,
    surface_spaces      integer default 0,
    storage_spaces      integer default 0,

    -- Cost basis. A full cost-coded budget can be attached later; until then the
    -- deal carries a single total so it can still be underwritten.
    total_project_cost  numeric(14,2) default 0,
    budget              jsonb,

    -- Everything else: vacancy, other income, opex, exit + sell-out assumptions.
    assumptions         jsonb not null default '{}'::jsonb,

    notes               text,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists mf_deals_owner_idx on feasible.mf_deals (owner_id, updated_at desc);

-- ---------------------------------------------------------------------
-- UNIT MIX — one row per unit type per tier.
-- Rows, not JSON, because the AI comp matcher joins against them by type and the
-- mix is the thing most often edited a line at a time.
-- ---------------------------------------------------------------------
create table if not exists feasible.mf_unit_types (
    id              uuid primary key default gen_random_uuid(),
    deal_id         uuid not null references feasible.mf_deals (id) on delete cascade,
    -- 'market' or 'affordable' — the model prices the same bedroom count differently
    -- in each tier, so they are separate rows rather than a discount factor.
    tier            text not null default 'market' check (tier in ('market', 'affordable')),
    label           text not null,              -- "1 Bed", "2 Bed", "Studio"…
    unit_count      integer not null default 0,
    rent_monthly    numeric(12,2) not null default 0,
    sqft            numeric(10,2) not null default 0,
    -- Only used by the sell-out and blended exits. NULL means "not priced", which
    -- the engine reports honestly instead of treating as $0.
    sell_price      numeric(14,2),
    sort_order      integer not null default 0
);

create index if not exists mf_unit_types_deal_idx on feasible.mf_unit_types (deal_id, tier, sort_order);

-- ---------------------------------------------------------------------
-- COMPS — rent comps and for-sale comps, on the same table.
-- They answer the two halves of the same question (what does it rent for / what
-- does it sell for) and are displayed side by side against the subject, exactly
-- like the workbook's Rent Comps sheet.
-- ---------------------------------------------------------------------
create table if not exists feasible.mf_comps (
    id              uuid primary key default gen_random_uuid(),
    deal_id         uuid not null references feasible.mf_deals (id) on delete cascade,
    kind            text not null check (kind in ('rent', 'sale')),

    property_name   text,
    address         text,
    city            text,
    year_built      integer,
    units           integer,
    distance_mi     numeric(6,2),

    -- Per-unit-type detail: [{ label, count, rent | price, sqft }]
    detail          jsonb not null default '[]'::jsonb,

    -- Provenance. AI-proposed comps are drafts until an underwriter confirms them —
    -- the same propose→verify discipline CMAssist uses, for the same reason: a comp
    -- nobody checked shouldn't silently move a $50M decision.
    source          text,                       -- 'CoStar', 'AI', 'manual'…
    source_date     date,
    ai_generated    boolean not null default false,
    confirmed       boolean not null default false,
    note            text,

    created_at      timestamptz not null default now()
);

create index if not exists mf_comps_deal_idx on feasible.mf_comps (deal_id, kind, created_at desc);

-- ---------------------------------------------------------------------
-- RLS — same posture as the rest of feasible: you see your own work.
-- ---------------------------------------------------------------------
alter table feasible.mf_deals      enable row level security;
alter table feasible.mf_unit_types enable row level security;
alter table feasible.mf_comps      enable row level security;

drop policy if exists mf_deals_owner on feasible.mf_deals;
create policy mf_deals_owner on feasible.mf_deals
  for all to authenticated
  using (owner_id = auth.uid()) with check (owner_id = auth.uid());

drop policy if exists mf_unit_types_owner on feasible.mf_unit_types;
create policy mf_unit_types_owner on feasible.mf_unit_types
  for all to authenticated
  using (exists (select 1 from feasible.mf_deals d where d.id = deal_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from feasible.mf_deals d where d.id = deal_id and d.owner_id = auth.uid()));

drop policy if exists mf_comps_owner on feasible.mf_comps;
create policy mf_comps_owner on feasible.mf_comps
  for all to authenticated
  using (exists (select 1 from feasible.mf_deals d where d.id = deal_id and d.owner_id = auth.uid()))
  with check (exists (select 1 from feasible.mf_deals d where d.id = deal_id and d.owner_id = auth.uid()));
