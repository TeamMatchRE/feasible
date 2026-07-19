-- =============================================================================
-- FEASIBLE — Preliminary Site Design / Feasibility
-- Migration 0001: schema, PostGIS, RLS.
--
-- Home: the brooke-identity Postgres (project ref xipcwxosjnvuoazbckfi).
-- Everything Feasible owns lives under the `feasible` schema so it never
-- collides with identity/auth/shared or the other hub apps.
--
-- Adapted from the original "Groundwork" design. Deltas from that draft:
--   * All objects namespaced into schema `feasible` (was `public`).
--   * gen_random_uuid() (core) instead of uuid-ossp.
--   * PostGIS is created in `extensions` (Supabase convention); if it already
--     exists elsewhere the IF NOT EXISTS makes this a harmless no-op.
--   * profiles.id = auth.uid(); upserted on first login.
--   * The child-table RLS the draft left as a "replicate this" TODO is written
--     out in full here.
--
-- Spatial reference: all geometry stored in EPSG:2234 (NAD83 / Connecticut
-- State Plane, US survey feet) so ST_Length/ST_Area/ST_Distance return feet
-- with no query-time reprojection. Southern-New-England parcels a few hundred
-- ppm off true scale — negligible for local setback distances. Client sends and
-- receives GeoJSON in EPSG:4326 (lat/lon); the app ST_Transform()s on the way
-- in and out. Change the SRID per region if you expand beyond CT/MA/RI.
-- =============================================================================

create extension if not exists postgis with schema extensions;

create schema if not exists feasible;
-- feasible first (new tables land here), then extensions/public so unqualified
-- PostGIS functions resolve wherever PostGIS actually lives.
set search_path = feasible, extensions, public;

-- =============================================================================
-- ENUMS
-- =============================================================================
do $$ begin
  create type feasible.project_status    as enum ('draft','in_review','feasible','not_feasible','archived');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feasible.road_class         as enum ('private','public');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feasible.parse_status       as enum ('pending','processing','parsed','failed');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feasible.validation_status  as enum ('pass','warn','fail');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feasible.septic_system_type as enum ('conventional','mound','chamber','pressure','advanced_treatment','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feasible.file_kind          as enum ('dwg','dxf','pdf','image','other');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feasible.unit_of_measure    as enum ('EA','LF','SF','SY','CY','TON','GAL','LS','HR');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feasible.takeoff_scope      as enum ('template','project');
exception when duplicate_object then null; end $$;
do $$ begin
  create type feasible.feature_type       as enum ('tree','tree_line','wetland','watercourse','easement',
                                     'existing_structure','contour','soil_zone','utility_main',
                                     'flood_zone','wetland_buffer','other');
exception when duplicate_object then null; end $$;

-- =============================================================================
-- IDENTITY  (mirrors the central OIDC authority; id = auth.uid())
-- =============================================================================
create table if not exists feasible.profiles (
    id          uuid primary key,                 -- = auth.uid()
    email       text,
    full_name   text,
    org_id      uuid,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

-- =============================================================================
-- REFERENCE / SHARED LIBRARIES
-- owner_id NULL = global/shared row (readable by everyone);
-- owner_id set  = a user's private override. See RLS at bottom.
-- =============================================================================
create table if not exists feasible.jurisdictions (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid references feasible.profiles(id) on delete cascade,
    name        text not null,
    county      text,
    state       text,
    notes       text,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists feasible.setback_rules (
    id              uuid primary key default gen_random_uuid(),
    owner_id        uuid references feasible.profiles(id) on delete cascade,
    jurisdiction_id uuid references feasible.jurisdictions(id) on delete cascade,
    rule_key        text not null,
    min_distance_ft numeric(8,2) not null,
    citation        text,
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now()
);

create table if not exists feasible.septic_sizing_rules (
    id                  uuid primary key default gen_random_uuid(),
    owner_id            uuid references feasible.profiles(id) on delete cascade,
    jurisdiction_id     uuid references feasible.jurisdictions(id) on delete cascade,
    num_bedrooms        int  not null,
    design_flow_gpd     numeric(10,2) not null,
    min_tank_gallons    int  not null,
    leachfield_factor   numeric(10,4),
    citation            text,
    created_at          timestamptz not null default now(),
    unique (owner_id, jurisdiction_id, num_bedrooms)
);

create table if not exists feasible.utility_types (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid references feasible.profiles(id) on delete cascade,
    code        text not null,
    label       text not null,
    created_at  timestamptz not null default now()
);

create table if not exists feasible.cost_profiles (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid references feasible.profiles(id) on delete cascade,
    name        text not null,
    region      text,
    supplier    text,
    is_default  boolean not null default false,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists feasible.cost_catalog_items (
    id          uuid primary key default gen_random_uuid(),
    owner_id    uuid references feasible.profiles(id) on delete cascade,
    category    text not null,
    name        text not null,
    unit        feasible.unit_of_measure not null,
    created_at  timestamptz not null default now(),
    updated_at  timestamptz not null default now()
);

create table if not exists feasible.cost_profile_rates (
    id              uuid primary key default gen_random_uuid(),
    owner_id        uuid references feasible.profiles(id) on delete cascade,
    cost_profile_id uuid not null references feasible.cost_profiles(id) on delete cascade,
    catalog_item_id uuid not null references feasible.cost_catalog_items(id) on delete cascade,
    unit_cost       numeric(12,4) not null,
    effective_date  date not null default current_date,
    unique (cost_profile_id, catalog_item_id, effective_date)
);

create table if not exists feasible.utility_rates (
    id              uuid primary key default gen_random_uuid(),
    owner_id        uuid references feasible.profiles(id) on delete cascade,
    cost_profile_id uuid not null references feasible.cost_profiles(id) on delete cascade,
    utility_type_id uuid not null references feasible.utility_types(id) on delete cascade,
    road_class      feasible.road_class not null,
    cost_per_lf     numeric(12,4) not null,
    effective_date  date not null default current_date,
    unique (cost_profile_id, utility_type_id, road_class, effective_date)
);

-- =============================================================================
-- BUILDING TEMPLATE LIBRARY
-- =============================================================================
create table if not exists feasible.building_templates (
    id                  uuid primary key default gen_random_uuid(),
    owner_id            uuid not null references feasible.profiles(id) on delete cascade,
    name                text not null,
    model_type          text,
    living_area_sf      numeric(10,2),
    bedrooms            int,
    bathrooms           numeric(4,1),
    footprint_width_ft  numeric(8,2),
    footprint_depth_ft  numeric(8,2),
    footprint_geom      geometry(Polygon, 2234),
    tags                text[] default '{}',
    attributes          jsonb  default '{}',
    source_file_id      uuid,
    created_at          timestamptz not null default now(),
    updated_at          timestamptz not null default now()
);
create index if not exists building_templates_tags_idx on feasible.building_templates using gin (tags);

-- =============================================================================
-- PROJECTS  (one feasibility study per site)
-- =============================================================================
create table if not exists feasible.projects (
    id                      uuid primary key default gen_random_uuid(),
    owner_id                uuid not null references feasible.profiles(id) on delete cascade,
    org_id                  uuid,
    name                    text not null,
    address                 text,
    apn                     text,
    -- Map centring: where to open the editor before any parcel is drawn.
    center_lat              double precision,
    center_lng              double precision,
    jurisdiction_id         uuid references feasible.jurisdictions(id),
    default_cost_profile_id uuid references feasible.cost_profiles(id),
    status                  feasible.project_status not null default 'draft',
    notes                   text,
    created_at              timestamptz not null default now(),
    updated_at              timestamptz not null default now()
);

create table if not exists feasible.parcels (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references feasible.projects(id) on delete cascade,
    label           text,
    geom            geometry(Polygon, 2234) not null,
    area_sf         numeric(14,2) generated always as (st_area(geom)) stored,
    perimeter_ft    numeric(14,2) generated always as (st_perimeter(geom)) stored,
    frontage_ft     numeric(10,2),
    zoning_district text,
    front_setback_ft numeric(8,2),
    side_setback_ft  numeric(8,2),
    rear_setback_ft  numeric(8,2),
    max_coverage_pct numeric(5,2),
    created_at      timestamptz not null default now()
);
create index if not exists parcels_geom_idx on feasible.parcels using gist (geom);

create table if not exists feasible.site_features (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references feasible.projects(id) on delete cascade,
    kind        feasible.feature_type not null,
    geom        geometry(Geometry, 2234) not null,
    attributes  jsonb default '{}',
    source      text,
    created_at  timestamptz not null default now()
);
create index if not exists site_features_geom_idx on feasible.site_features using gist (geom);

create table if not exists feasible.template_placements (
    id                  uuid primary key default gen_random_uuid(),
    project_id          uuid not null references feasible.projects(id) on delete cascade,
    template_id         uuid references feasible.building_templates(id),
    label               text,
    geom                geometry(Polygon, 2234) not null,
    rotation_deg        numeric(6,2) default 0,
    finished_floor_elev numeric(8,2),
    notes               text,
    created_at          timestamptz not null default now()
);
create index if not exists template_placements_geom_idx on feasible.template_placements using gist (geom);

-- =============================================================================
-- INFRASTRUCTURE: ROADS + UTILITIES
-- =============================================================================
create table if not exists feasible.road_segments (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references feasible.projects(id) on delete cascade,
    label       text,
    geom        geometry(LineString, 2234) not null,
    length_ft   numeric(12,2) generated always as (st_length(geom)) stored,
    class       feasible.road_class not null default 'private',
    surface     text,
    width_ft    numeric(6,2),
    notes       text,
    created_at  timestamptz not null default now()
);
create index if not exists road_segments_geom_idx on feasible.road_segments using gist (geom);

create table if not exists feasible.road_utilities (
    id                  uuid primary key default gen_random_uuid(),
    road_segment_id     uuid not null references feasible.road_segments(id) on delete cascade,
    utility_type_id     uuid not null references feasible.utility_types(id),
    cost_profile_id     uuid references feasible.cost_profiles(id),
    unit_cost_lf        numeric(12,4),
    length_ft           numeric(12,2),
    extended_cost       numeric(14,2) generated always as (unit_cost_lf * length_ft) stored,
    created_at          timestamptz not null default now(),
    unique (road_segment_id, utility_type_id)
);

-- =============================================================================
-- PRIVATE UTILITIES: WELL + SEPTIC
-- =============================================================================
create table if not exists feasible.wells (
    id          uuid primary key default gen_random_uuid(),
    project_id  uuid not null references feasible.projects(id) on delete cascade,
    label       text,
    geom        geometry(Point, 2234) not null,
    depth_ft    numeric(8,2),
    notes       text,
    created_at  timestamptz not null default now()
);
create index if not exists wells_geom_idx on feasible.wells using gist (geom);

create table if not exists feasible.septic_systems (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references feasible.projects(id) on delete cascade,
    label           text,
    geom            geometry(Point, 2234) not null,
    system_type     feasible.septic_system_type not null default 'conventional',
    num_bedrooms    int,
    design_flow_gpd numeric(10,2),
    tank_gallons    int,
    notes           text,
    created_at      timestamptz not null default now()
);
create index if not exists septic_systems_geom_idx on feasible.septic_systems using gist (geom);

create table if not exists feasible.leach_fields (
    id              uuid primary key default gen_random_uuid(),
    septic_id       uuid not null references feasible.septic_systems(id) on delete cascade,
    label           text,
    geom            geometry(Polygon, 2234) not null,
    area_sf         numeric(12,2) generated always as (st_area(geom)) stored,
    trench_lf       numeric(10,2),
    perc_rate_mpi   numeric(8,2),
    created_at      timestamptz not null default now()
);
create index if not exists leach_fields_geom_idx on feasible.leach_fields using gist (geom);

-- =============================================================================
-- DESIGN VALIDATIONS  (the "warn me if I'm too close" engine output)
-- =============================================================================
create table if not exists feasible.design_validations (
    id              uuid primary key default gen_random_uuid(),
    project_id      uuid not null references feasible.projects(id) on delete cascade,
    rule_key        text not null,
    measured_ft     numeric(10,2),
    required_ft     numeric(10,2),
    status          feasible.validation_status not null,
    subject_a       text,
    subject_b       text,
    message         text,
    checked_at      timestamptz not null default now()
);
create index if not exists design_validations_project_idx on feasible.design_validations (project_id);

-- =============================================================================
-- TAKEOFFS  (parse a plan -> quantities -> priced against a cost profile)
-- =============================================================================
create table if not exists feasible.takeoffs (
    id              uuid primary key default gen_random_uuid(),
    owner_id        uuid not null references feasible.profiles(id) on delete cascade,
    scope           feasible.takeoff_scope not null,
    template_id     uuid references feasible.building_templates(id) on delete cascade,
    project_id      uuid references feasible.projects(id) on delete cascade,
    source_file_id  uuid,
    cost_profile_id uuid references feasible.cost_profiles(id),
    status          feasible.parse_status not null default 'pending',
    total_cost      numeric(16,2),
    created_at      timestamptz not null default now(),
    updated_at      timestamptz not null default now(),
    check ( (scope = 'template' and template_id is not null)
         or (scope = 'project'  and project_id  is not null) )
);

create table if not exists feasible.takeoff_items (
    id              uuid primary key default gen_random_uuid(),
    takeoff_id      uuid not null references feasible.takeoffs(id) on delete cascade,
    catalog_item_id uuid references feasible.cost_catalog_items(id),
    category        text not null,
    description     text,
    quantity        numeric(14,4) not null,
    unit            feasible.unit_of_measure not null,
    unit_cost       numeric(12,4),
    extended_cost   numeric(16,2) generated always as (quantity * unit_cost) stored,
    source_ref      text,
    created_at      timestamptz not null default now()
);

-- =============================================================================
-- FILES  (Supabase Storage pointers for uploaded plans)
-- =============================================================================
create table if not exists feasible.project_files (
    id            uuid primary key default gen_random_uuid(),
    owner_id      uuid not null references feasible.profiles(id) on delete cascade,
    project_id    uuid references feasible.projects(id) on delete cascade,
    template_id   uuid references feasible.building_templates(id) on delete cascade,
    storage_path  text not null,
    kind          feasible.file_kind not null,
    parse_status  feasible.parse_status not null default 'pending',
    parsed_meta   jsonb default '{}',
    created_at    timestamptz not null default now()
);

-- Deferred FKs now that project_files exists.
do $$ begin
  alter table feasible.building_templates
    add constraint fk_bt_source_file
    foreign key (source_file_id) references feasible.project_files(id) on delete set null;
exception when duplicate_object then null; end $$;
do $$ begin
  alter table feasible.takeoffs
    add constraint fk_to_source_file
    foreign key (source_file_id) references feasible.project_files(id) on delete set null;
exception when duplicate_object then null; end $$;

-- =============================================================================
-- updated_at TRIGGERS
-- =============================================================================
create or replace function feasible.set_updated_at() returns trigger as $$
begin new.updated_at = now(); return new; end;
$$ language plpgsql;

do $$
declare t text;
begin
  foreach t in array array[
    'profiles','jurisdictions','building_templates','projects',
    'cost_profiles','cost_catalog_items','takeoffs'
  ] loop
    execute format('drop trigger if exists trg_%1$s_updated on feasible.%1$s;', t);
    execute format(
      'create trigger trg_%1$s_updated before update on feasible.%1$s
       for each row execute function feasible.set_updated_at();', t);
  end loop;
end $$;

-- =============================================================================
-- ROW LEVEL SECURITY
-- Owner-scoped private tables: owner_id = auth.uid().
-- Shared-library tables: read shared (owner_id IS NULL) or own; write own.
-- Child tables: inherit access through their parent project/template.
--
-- Belt and suspenders: the app's geometry work runs over a privileged
-- connection (DATABASE_URL) that BYPASSES RLS, and every server action scopes
-- by the authenticated user itself. These policies protect any PostgREST /
-- anon-key access path.
-- =============================================================================

-- Owner-only private tables
do $$
declare t text;
begin
  foreach t in array array['building_templates','projects','takeoffs','project_files','profiles'] loop
    execute format('alter table feasible.%I enable row level security;', t);
    execute format('drop policy if exists %1$s_owner on feasible.%1$s;', t);
    if t = 'profiles' then
      execute format($p$create policy %1$s_owner on feasible.%1$s
          using (id = auth.uid()) with check (id = auth.uid());$p$, t);
    else
      execute format($p$create policy %1$s_owner on feasible.%1$s
          using (owner_id = auth.uid()) with check (owner_id = auth.uid());$p$, t);
    end if;
  end loop;
end $$;

-- Shared-library tables
do $$
declare t text;
begin
  foreach t in array array[
    'jurisdictions','setback_rules','septic_sizing_rules','utility_types',
    'cost_profiles','cost_catalog_items','cost_profile_rates','utility_rates'
  ] loop
    execute format('alter table feasible.%I enable row level security;', t);
    execute format('drop policy if exists %1$s_read on feasible.%1$s;', t);
    execute format('drop policy if exists %1$s_write on feasible.%1$s;', t);
    execute format($p$create policy %1$s_read on feasible.%1$s for select
        using (owner_id is null or owner_id = auth.uid());$p$, t);
    execute format($p$create policy %1$s_write on feasible.%1$s for all
        using (owner_id = auth.uid()) with check (owner_id = auth.uid());$p$, t);
  end loop;
end $$;

-- Child tables that reach ownership through projects.id
do $$
declare t text;
begin
  foreach t in array array[
    'parcels','site_features','template_placements','road_segments',
    'wells','septic_systems','design_validations'
  ] loop
    execute format('alter table feasible.%I enable row level security;', t);
    execute format('drop policy if exists %1$s_via_project on feasible.%1$s;', t);
    execute format($p$create policy %1$s_via_project on feasible.%1$s using (
        exists (select 1 from feasible.projects p
                where p.id = %1$s.project_id and p.owner_id = auth.uid())
      ) with check (
        exists (select 1 from feasible.projects p
                where p.id = %1$s.project_id and p.owner_id = auth.uid())
      );$p$, t);
  end loop;
end $$;

-- road_utilities -> road_segments -> projects
alter table feasible.road_utilities enable row level security;
drop policy if exists road_utilities_via_project on feasible.road_utilities;
create policy road_utilities_via_project on feasible.road_utilities using (
  exists (select 1 from feasible.road_segments s join feasible.projects p on p.id = s.project_id
          where s.id = road_utilities.road_segment_id and p.owner_id = auth.uid())
) with check (
  exists (select 1 from feasible.road_segments s join feasible.projects p on p.id = s.project_id
          where s.id = road_utilities.road_segment_id and p.owner_id = auth.uid())
);

-- leach_fields -> septic_systems -> projects
alter table feasible.leach_fields enable row level security;
drop policy if exists leach_fields_via_septic on feasible.leach_fields;
create policy leach_fields_via_septic on feasible.leach_fields using (
  exists (select 1 from feasible.septic_systems s join feasible.projects p on p.id = s.project_id
          where s.id = leach_fields.septic_id and p.owner_id = auth.uid())
) with check (
  exists (select 1 from feasible.septic_systems s join feasible.projects p on p.id = s.project_id
          where s.id = leach_fields.septic_id and p.owner_id = auth.uid())
);

-- takeoff_items -> takeoffs -> owner
alter table feasible.takeoff_items enable row level security;
drop policy if exists takeoff_items_via_takeoff on feasible.takeoff_items;
create policy takeoff_items_via_takeoff on feasible.takeoff_items using (
  exists (select 1 from feasible.takeoffs t
          where t.id = takeoff_items.takeoff_id and t.owner_id = auth.uid())
) with check (
  exists (select 1 from feasible.takeoffs t
          where t.id = takeoff_items.takeoff_id and t.owner_id = auth.uid())
);

-- =============================================================================
-- SEED DATA  (illustrative — REPLACE with verified local code values)
-- =============================================================================
insert into feasible.utility_types (owner_id, code, label)
select * from (values
  (null::uuid,'water','Public/Community Water'),
  (null,'sanitary_sewer','Sanitary Sewer'),
  (null,'storm','Storm Drainage'),
  (null,'electric','Electric'),
  (null,'gas','Natural Gas'),
  (null,'telecom','Telecom/Fiber')
) as v(owner_id, code, label)
where not exists (select 1 from feasible.utility_types where owner_id is null);

-- Example CT-style setbacks — VERIFY against the actual health code / zoning.
-- Shared rows (owner_id null, jurisdiction_id null) = the default rule set every
-- project falls back to until a jurisdiction-specific override is added.
insert into feasible.setback_rules (owner_id, jurisdiction_id, rule_key, min_distance_ft, citation)
select null::uuid, null::uuid, rule_key, min_distance_ft, 'ILLUSTRATIVE — verify'
from (values
  ('well_to_septic',              75::numeric),
  ('well_to_leachfield',          75),
  ('well_to_property_line',       25),
  ('septic_to_watercourse',       50),
  ('leachfield_to_watercourse',   50),
  ('septic_to_property_line',     25),
  ('leachfield_to_property_line', 25)
) as v(rule_key, min_distance_ft)
where not exists (
  select 1 from feasible.setback_rules
  where owner_id is null and jurisdiction_id is null
);
