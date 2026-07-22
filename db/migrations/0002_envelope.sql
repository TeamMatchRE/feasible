-- =============================================================================
-- FEASIBLE — Migration 0002: building envelope + frontage edge.
--
-- Additive only. Adds:
--   * feasible.parcels.frontage_edge_idx — which boundary segment (0-based, in
--     the stored ring order) fronts the street. Drives per-edge setbacks when
--     the envelope is computed; NULL means "not yet tagged" (uniform fallback).
--   * feasible.building_envelopes — the computed buildable-area polygon, kept as
--     a first-class, re-computable overlay (one current row per project).
--
-- Same conventions as 0001: schema-qualified, idempotent, geometry in EPSG:2234.
-- =============================================================================

set search_path = feasible, extensions, public;

alter table feasible.parcels
  add column if not exists frontage_edge_idx int;

create table if not exists feasible.building_envelopes (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references feasible.projects(id) on delete cascade,
    geom        geometry(Polygon, 2234) not null,
    area_sf     numeric(14,2) generated always as (st_area(geom)) stored,
    -- The inputs the envelope was built from (setbacks + which edge was front),
    -- so the UI can explain it and a stale envelope is easy to detect.
    basis       jsonb not null default '{}',
    created_at  timestamptz not null default now()
);
create index if not exists building_envelopes_geom_idx
  on feasible.building_envelopes using gist (geom);
create index if not exists building_envelopes_project_idx
  on feasible.building_envelopes (project_id);

-- RLS: mirror the project-scoped policy the child tables use in 0001. The app's
-- DATABASE_URL is privileged and bypasses RLS (authz is the ownership gate in
-- the server actions), but we keep policies consistent for defence in depth.
alter table feasible.building_envelopes enable row level security;
do $$ begin
  create policy building_envelopes_owner on feasible.building_envelopes
    using (exists (
      select 1 from feasible.projects p
      where p.id = building_envelopes.project_id and p.owner_id = auth.uid()
    ))
    with check (exists (
      select 1 from feasible.projects p
      where p.id = building_envelopes.project_id and p.owner_id = auth.uid()
    ));
exception when duplicate_object then null; end $$;
