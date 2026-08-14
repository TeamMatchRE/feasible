-- =====================================================================
-- MULTI-FAMILY SCENARIOS
--
-- A deal was one set of numbers. Underwriting is the act of asking "what if the
-- rents are 5% lower / we sell the townhomes instead of holding them / the cap
-- moves 50 bps", and until now the only way to ask was to overwrite the answer
-- you already had.
--
-- So the underwriting state moves off the deal and onto a SCENARIO, and a deal
-- carries many. The deal keeps its identity — name, address, notes, who it is
-- shared with, its comps — because those are facts about the property, not about
-- a case you are testing. Everything you can type into the underwriter belongs
-- to the scenario.
--
-- THE UNIT MIX MOVES WITH IT. A scenario that cannot change unit counts or
-- dispositions is not much of a scenario: "sell the townhomes instead" is a
-- change to the mix. So mf_unit_types is re-parented from deal to scenario. It
-- stays rows rather than JSON for the reason 0005 gives — the mix is edited a
-- line at a time and the comp matcher updates it by label.
--
-- Migration order matters and is not reversible by hand, so it is written to be
-- safe on a database that already has deals in it:
--
--   1. create mf_scenarios
--   2. give every existing deal a 'Base case' built from its current values
--   3. point each deal's active_scenario_id at it
--   4. re-parent the existing unit rows onto that scenario
--   5. only then make scenario_id NOT NULL and drop deal_id
--
-- Step 5 runs after 4 on purpose: making the column NOT NULL before the backfill
-- would fail on the first existing row.
--
-- The columns left behind on mf_deals (gross_sqft, assumptions, cost_program,
-- line_details, total_project_cost…) are now LEGACY. They hold whatever the deal
-- last had before scenarios existed and are no longer read — loadMfDeal reads the
-- active scenario. They are kept rather than dropped so this migration destroys
-- nothing; treat them as dead and do not write to them.
-- =====================================================================

create table if not exists feasible.mf_scenarios (
    id                  uuid primary key default gen_random_uuid(),
    deal_id             uuid not null references feasible.mf_deals (id) on delete cascade,

    name                text not null,
    -- Free text: "rents held flat, 6.5% exit" — why this case exists.
    note                text,

    -- Property-level inputs. On the scenario because a case may test a different
    -- building: more commercial space, another storey, a bigger garage.
    gross_sqft          numeric(12,2),
    commercial_sqft     numeric(12,2) default 0,
    height_stories      integer,
    garage_spaces       integer default 0,
    surface_spaces      integer default 0,
    storage_spaces      integer default 0,

    -- The hand-typed cost basis, used when the cost program's override is on.
    total_project_cost  numeric(14,2) default 0,

    assumptions         jsonb not null default '{}'::jsonb,
    cost_program        jsonb not null default '{}'::jsonb,
    line_details        jsonb not null default '{}'::jsonb,

    sort_order          integer not null default 0,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);

create index if not exists mf_scenarios_deal_idx
    on feasible.mf_scenarios (deal_id, sort_order, created_at);

-- Which scenario the editor opens. ON DELETE SET NULL rather than CASCADE: losing
-- a scenario must never take the deal with it.
alter table feasible.mf_deals
    add column if not exists active_scenario_id uuid
        references feasible.mf_scenarios (id) on delete set null;

alter table feasible.mf_unit_types
    add column if not exists scenario_id uuid
        references feasible.mf_scenarios (id) on delete cascade;

-- ---------------------------------------------------------------------
-- Backfill. Idempotent: a deal that already has a scenario is skipped, so
-- re-running the migration does not mint duplicate base cases.
-- ---------------------------------------------------------------------
insert into feasible.mf_scenarios (
    deal_id, name, gross_sqft, commercial_sqft, height_stories,
    garage_spaces, surface_spaces, storage_spaces, total_project_cost,
    assumptions, cost_program, line_details, sort_order)
select d.id, 'Base case', d.gross_sqft, d.commercial_sqft, d.height_stories,
       d.garage_spaces, d.surface_spaces, d.storage_spaces, d.total_project_cost,
       d.assumptions, d.cost_program, d.line_details, 0
from feasible.mf_deals d
where not exists (select 1 from feasible.mf_scenarios s where s.deal_id = d.id);

update feasible.mf_deals d
   set active_scenario_id = s.id
  from feasible.mf_scenarios s
 where s.deal_id = d.id
   and d.active_scenario_id is null;

-- ⚠️ REPLAY GUARD. deal_id is dropped further down, and every migration file is
-- replayed on every run (scripts/migrate.ts keeps no applied-migrations table),
-- so this backfill must become a no-op once the column is gone.
do $$
begin
  if exists (select 1 from information_schema.columns
              where table_schema = 'feasible' and table_name = 'mf_unit_types'
                and column_name = 'deal_id') then
    update feasible.mf_unit_types u
       set scenario_id = d.active_scenario_id
      from feasible.mf_deals d
     where u.deal_id = d.id
       and u.scenario_id is null;
  end if;
end $$;

-- ---------------------------------------------------------------------
-- Re-parent for good. Any unit row still lacking a scenario at this point is an
-- orphan whose deal is gone; delete it rather than let NOT NULL fail.
-- ---------------------------------------------------------------------
delete from feasible.mf_unit_types where scenario_id is null;

alter table feasible.mf_unit_types alter column scenario_id set not null;

-- The RLS policy from 0005 reaches the owner through deal_id, so it pins the
-- column and the drop below fails while it exists. Drop it first and rebuild it
-- against the new parent, one hop longer: unit → scenario → deal → owner.
--
-- As in 0005 this policy is defence in depth only. The app connects with a
-- privileged role that bypasses RLS (see src/lib/mf-access.ts), and nothing
-- reaches these tables through an authenticated Supabase session — which is also
-- why it stays owner-only and does not model the sharing added in 0008.
drop policy if exists mf_unit_types_owner on feasible.mf_unit_types;

drop index if exists feasible.mf_unit_types_deal_idx;
alter table feasible.mf_unit_types drop column if exists deal_id;

create policy mf_unit_types_owner on feasible.mf_unit_types
  for all to authenticated
  using (exists (select 1
                   from feasible.mf_scenarios s
                   join feasible.mf_deals d on d.id = s.deal_id
                  where s.id = scenario_id and d.owner_id = auth.uid()))
  with check (exists (select 1
                        from feasible.mf_scenarios s
                        join feasible.mf_deals d on d.id = s.deal_id
                       where s.id = scenario_id and d.owner_id = auth.uid()));

create index if not exists mf_unit_types_scenario_idx
    on feasible.mf_unit_types (scenario_id, tier, sort_order);

comment on table feasible.mf_scenarios is
    'One underwriting case for a deal. Owns every input the underwriter edits, including the unit mix (mf_unit_types.scenario_id). The deal owns identity, comps and sharing.';
comment on column feasible.mf_deals.active_scenario_id is
    'The scenario the editor opens. Null only in the moment between deleting the last scenario and creating another.';
