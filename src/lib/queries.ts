import "server-only";
import { sql } from "@/db";
import type { PlacedFeature, ValidationRow, GeoJSONGeometry } from "@/lib/geo";

// ---- Design library ------------------------------------------------------

export interface DesignSummary {
  id: string;
  name: string;
  model_type: string | null;
  living_area_sf: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  updated_at: string;
}

/** A user's saved house designs (building_templates), newest first. */
export async function listDesigns(ownerId: string): Promise<DesignSummary[]> {
  return sql<DesignSummary[]>`
    select id, name, model_type, living_area_sf, bedrooms, bathrooms, updated_at
    from feasible.building_templates
    where owner_id = ${ownerId}
    order by updated_at desc`;
}

export interface DesignTakeoffRow {
  category: string;
  description: string | null;
  quantity: number;
  unit: string;
}
export interface DesignDetail {
  id: string;
  name: string;
  model_type: string | null;
  living_area_sf: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  footprint_width_ft: number | null;
  footprint_depth_ft: number | null;
  attributes: Record<string, unknown>;
  storage_path: string | null;
  file_kind: string | null;
  takeoff: DesignTakeoffRow[];
}

/** One design with its takeoff + plan-file pointer, scoped to the owner. */
export async function loadDesign(id: string, ownerId: string): Promise<DesignDetail | null> {
  const [d] = await sql<
    {
      id: string;
      name: string;
      model_type: string | null;
      living_area_sf: number | null;
      bedrooms: number | null;
      bathrooms: number | null;
      footprint_width_ft: number | null;
      footprint_depth_ft: number | null;
      attributes: Record<string, unknown> | null;
    }[]
  >`
    select id, name, model_type, living_area_sf, bedrooms, bathrooms,
           footprint_width_ft, footprint_depth_ft, attributes
    from feasible.building_templates
    where id = ${id} and owner_id = ${ownerId}`;
  if (!d) return null;

  const [file] = await sql<{ storage_path: string; kind: string }[]>`
    select storage_path, kind from feasible.project_files
    where template_id = ${id} and owner_id = ${ownerId}
    order by created_at desc limit 1`;

  const takeoff = await sql<DesignTakeoffRow[]>`
    select ti.category, ti.description, ti.quantity, ti.unit::text as unit
    from feasible.takeoff_items ti
    join feasible.takeoffs t on t.id = ti.takeoff_id
    where t.template_id = ${id} and t.owner_id = ${ownerId}
    order by ti.created_at`;

  return {
    id: d.id,
    name: d.name,
    model_type: d.model_type,
    living_area_sf: d.living_area_sf,
    bedrooms: d.bedrooms,
    bathrooms: d.bathrooms,
    footprint_width_ft: d.footprint_width_ft,
    footprint_depth_ft: d.footprint_depth_ft,
    attributes: d.attributes ?? {},
    storage_path: file?.storage_path ?? null,
    file_kind: file?.kind ?? null,
    takeoff,
  };
}

export interface ProjectSummary {
  id: string;
  name: string;
  address: string | null;
  status: string;
  center_lat: number | null;
  center_lng: number | null;
  updated_at: string;
  parcel_count: number;
}

/** All of a user's studies, newest first, with a parcel count for the card. */
export async function listProjects(ownerId: string): Promise<ProjectSummary[]> {
  const rows = await sql<ProjectSummary[]>`
    select p.id, p.name, p.address, p.status::text as status,
           p.center_lat, p.center_lng, p.updated_at,
           (select count(*)::int from feasible.parcels pc where pc.project_id = p.id) as parcel_count
    from feasible.projects p
    where p.owner_id = ${ownerId}
    order by p.updated_at desc
  `;
  return rows;
}

export interface ParcelInfo {
  id: string;
  frontage_edge_idx: number | null;
  zoning_district: string | null;
  front_setback_ft: number | null;
  side_setback_ft: number | null;
  rear_setback_ft: number | null;
  max_coverage_pct: number | null;
  area_sf: number | null;
}

export interface ProjectDetail {
  id: string;
  name: string;
  address: string | null;
  status: string;
  center_lat: number | null;
  center_lng: number | null;
  features: PlacedFeature[];
  validations: ValidationRow[];
  /** The parcel's non-geometry state (setbacks, frontage tag) — null until one exists. */
  parcel: ParcelInfo | null;
  /** True when a building envelope has been computed and is current. */
  hasEnvelope: boolean;
}

function parseGj(s: string): GeoJSONGeometry {
  return JSON.parse(s) as GeoJSONGeometry;
}

/**
 * A project and everything placed on it, geometry as 4326 GeoJSON ready for the
 * map. Scoped by ownerId — returns null if the project isn't the caller's.
 */
export async function loadProject(
  projectId: string,
  ownerId: string,
): Promise<ProjectDetail | null> {
  const [proj] = await sql<
    {
      id: string;
      name: string;
      address: string | null;
      status: string;
      center_lat: number | null;
      center_lng: number | null;
    }[]
  >`
    select id, name, address, status::text as status, center_lat, center_lng
    from feasible.projects
    where id = ${projectId} and owner_id = ${ownerId}
  `;
  if (!proj) return null;

  const g = "ST_AsGeoJSON(ST_Transform(geom, 4326))";
  const features: PlacedFeature[] = [];

  const parcels = await sql<
    {
      id: string;
      label: string | null;
      gj: string;
      area_sf: number | null;
      perimeter_ft: number | null;
      frontage_edge_idx: number | null;
      zoning_district: string | null;
      front_setback_ft: number | null;
      side_setback_ft: number | null;
      rear_setback_ft: number | null;
      max_coverage_pct: number | null;
    }[]
  >`
    select id, label, ${sql.unsafe(g)} as gj, area_sf, perimeter_ft,
           frontage_edge_idx, zoning_district,
           front_setback_ft, side_setback_ft, rear_setback_ft, max_coverage_pct
    from feasible.parcels where project_id = ${projectId}`;
  let parcel: ParcelInfo | null = null;
  for (const r of parcels) {
    features.push({ kind: "parcel", id: r.id, label: r.label, geojson: parseGj(r.gj), area_sf: r.area_sf, perimeter_ft: r.perimeter_ft });
    parcel = {
      id: r.id,
      frontage_edge_idx: r.frontage_edge_idx,
      zoning_district: r.zoning_district,
      front_setback_ft: r.front_setback_ft,
      side_setback_ft: r.side_setback_ft,
      rear_setback_ft: r.rear_setback_ft,
      max_coverage_pct: r.max_coverage_pct,
      area_sf: r.area_sf,
    };
  }

  // The computed building envelope, if any, rides along as a (non-deletable) overlay.
  const envelopes = await sql<{ id: string; gj: string; area_sf: number | null }[]>`
    select id, ${sql.unsafe(g)} as gj, area_sf
    from feasible.building_envelopes where project_id = ${projectId}`;
  for (const r of envelopes)
    features.push({ kind: "envelope", id: r.id, label: "Building envelope", geojson: parseGj(r.gj), area_sf: r.area_sf });

  const houses = await sql<{ id: string; label: string | null; gj: string }[]>`
    select id, label, ${sql.unsafe(g)} as gj
    from feasible.template_placements where project_id = ${projectId}`;
  for (const r of houses)
    features.push({ kind: "house", id: r.id, label: r.label, geojson: parseGj(r.gj) });

  const wells = await sql<{ id: string; label: string | null; gj: string }[]>`
    select id, label, ${sql.unsafe(g)} as gj
    from feasible.wells where project_id = ${projectId}`;
  for (const r of wells)
    features.push({ kind: "well", id: r.id, label: r.label, geojson: parseGj(r.gj) });

  const septics = await sql<{ id: string; label: string | null; gj: string; num_bedrooms: number | null }[]>`
    select id, label, ${sql.unsafe(g)} as gj, num_bedrooms
    from feasible.septic_systems where project_id = ${projectId}`;
  for (const r of septics)
    features.push({ kind: "septic", id: r.id, label: r.label, geojson: parseGj(r.gj), num_bedrooms: r.num_bedrooms });

  const leach = await sql<{ id: string; label: string | null; gj: string; area_sf: number | null }[]>`
    select lf.id, lf.label, ${sql.unsafe("ST_AsGeoJSON(ST_Transform(lf.geom, 4326))")} as gj, lf.area_sf
    from feasible.leach_fields lf
    join feasible.septic_systems s on s.id = lf.septic_id
    where s.project_id = ${projectId}`;
  for (const r of leach)
    features.push({ kind: "leachfield", id: r.id, label: r.label, geojson: parseGj(r.gj), area_sf: r.area_sf });

  const roads = await sql<{ id: string; label: string | null; gj: string; length_ft: number | null }[]>`
    select id, label, ${sql.unsafe(g)} as gj, length_ft
    from feasible.road_segments where project_id = ${projectId}`;
  for (const r of roads)
    features.push({ kind: "road", id: r.id, label: r.label, geojson: parseGj(r.gj), length_ft: r.length_ft });

  const validations = await sql<ValidationRow[]>`
    select rule_key, measured_ft, required_ft, status::text as status,
           subject_a, subject_b, message
    from feasible.design_validations
    where project_id = ${projectId}
    order by checked_at desc, rule_key`;

  return {
    id: proj.id,
    name: proj.name,
    address: proj.address,
    status: proj.status,
    center_lat: proj.center_lat,
    center_lng: proj.center_lng,
    features,
    validations,
    parcel,
    hasEnvelope: envelopes.length > 0,
  };
}
