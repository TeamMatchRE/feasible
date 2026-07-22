"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { sql } from "@/db";
import { fetchParcelAt } from "@/lib/parcels";
import { proposeFromPdf, proposeFromWebSearch, type ProposeResult } from "@/lib/zoning";
import { fetchFloodAt, type FloodReport } from "@/lib/flood";
import {
  RULES,
  HOUSE_IN_ENVELOPE,
  verdictOf,
  type FeatureKind,
  type GeoJSONGeometry,
  type PlacedFeature,
  type ValidationRow,
  type ValidationStatus,
} from "@/lib/geo";

/** Throws unless `projectId` belongs to the signed-in user. Returns userId. */
async function assertOwner(projectId: string): Promise<string> {
  const user = await requireUser();
  const [row] = await sql<{ id: string }[]>`
    select id from feasible.projects
    where id = ${projectId} and owner_id = ${user.id}
  `;
  if (!row) throw new Error("Project not found.");
  return user.id;
}

// GeoJSON (4326) -> a geometry(...,2234) column value.
function toGeom(geojson: GeoJSONGeometry) {
  const gj = JSON.stringify(geojson);
  return sql`ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${gj}), 4326), 2234)`;
}
// A geometry column read back as 4326 GeoJSON text. Plain string wrapped with
// sql.unsafe() at each call site (never at import — that would eagerly build the
// client and break `next build` when DATABASE_URL is absent from the build env).
const AS_GJ_SQL = "ST_AsGeoJSON(ST_Transform(geom, 4326))";

export interface SaveResult {
  ok: boolean;
  feature?: PlacedFeature;
  error?: string;
}

/**
 * Persist a drawn feature into its proper table, transforming lat/lng to State
 * Plane feet on the way in, and return it back as GeoJSON with any PostGIS
 * generated measurements (area, length) already computed.
 */
export async function saveFeature(
  projectId: string,
  kind: FeatureKind,
  geojson: GeoJSONGeometry,
  extra?: { label?: string | null; num_bedrooms?: number | null; road_class?: "private" | "public" },
): Promise<SaveResult> {
  try {
    await assertOwner(projectId);
    const label = extra?.label ?? null;

    switch (kind) {
      case "parcel": {
        const [r] = await sql<{ id: string; gj: string; area_sf: number; perimeter_ft: number }[]>`
          insert into feasible.parcels (project_id, label, geom)
          values (${projectId}, ${label}, ${toGeom(geojson)})
          returning id, ${sql.unsafe(AS_GJ_SQL)} as gj, area_sf, perimeter_ft`;
        await touch(projectId);
        return ok({ kind, id: r.id, label, geojson: JSON.parse(r.gj), area_sf: r.area_sf, perimeter_ft: r.perimeter_ft });
      }
      case "house": {
        const [r] = await sql<{ id: string; gj: string }[]>`
          insert into feasible.template_placements (project_id, label, geom)
          values (${projectId}, ${label}, ${toGeom(geojson)})
          returning id, ${sql.unsafe(AS_GJ_SQL)} as gj`;
        await touch(projectId);
        return ok({ kind, id: r.id, label, geojson: JSON.parse(r.gj) });
      }
      case "well": {
        const [r] = await sql<{ id: string; gj: string }[]>`
          insert into feasible.wells (project_id, label, geom)
          values (${projectId}, ${label}, ${toGeom(geojson)})
          returning id, ${sql.unsafe(AS_GJ_SQL)} as gj`;
        await touch(projectId);
        return ok({ kind, id: r.id, label, geojson: JSON.parse(r.gj) });
      }
      case "septic": {
        const [r] = await sql<{ id: string; gj: string; num_bedrooms: number | null }[]>`
          insert into feasible.septic_systems (project_id, label, num_bedrooms, geom)
          values (${projectId}, ${label}, ${extra?.num_bedrooms ?? null}, ${toGeom(geojson)})
          returning id, ${sql.unsafe(AS_GJ_SQL)} as gj, num_bedrooms`;
        await touch(projectId);
        return ok({ kind, id: r.id, label, geojson: JSON.parse(r.gj), num_bedrooms: r.num_bedrooms });
      }
      case "leachfield": {
        // A leach field belongs to a septic system — attach it to the project's
        // most recent one. That models the real dependency and keeps the
        // well↔leachfield check meaningful.
        const [septic] = await sql<{ id: string }[]>`
          select id from feasible.septic_systems
          where project_id = ${projectId} order by created_at desc limit 1`;
        if (!septic) return { ok: false, error: "Place a septic tank first — the leach field attaches to it." };
        const [r] = await sql<{ id: string; gj: string; area_sf: number }[]>`
          insert into feasible.leach_fields (septic_id, label, geom)
          values (${septic.id}, ${label}, ${toGeom(geojson)})
          returning id, ${sql.unsafe(AS_GJ_SQL)} as gj, area_sf`;
        await touch(projectId);
        return ok({ kind, id: r.id, label, geojson: JSON.parse(r.gj), area_sf: r.area_sf });
      }
      case "road": {
        const [r] = await sql<{ id: string; gj: string; length_ft: number }[]>`
          insert into feasible.road_segments (project_id, label, class, geom)
          values (${projectId}, ${label}, ${extra?.road_class ?? "private"}, ${toGeom(geojson)})
          returning id, ${sql.unsafe(AS_GJ_SQL)} as gj, length_ft`;
        await touch(projectId);
        return ok({ kind, id: r.id, label, geojson: JSON.parse(r.gj), length_ft: r.length_ft });
      }
      default:
        return { ok: false, error: `Unknown feature kind: ${kind}` };
    }
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

const KIND_TABLE: Record<FeatureKind, string> = {
  parcel: "feasible.parcels",
  house: "feasible.template_placements",
  well: "feasible.wells",
  septic: "feasible.septic_systems",
  leachfield: "feasible.leach_fields",
  road: "feasible.road_segments",
  // Not user-drawn/deletable through the generic path; managed by computeEnvelope.
  envelope: "feasible.building_envelopes",
};

export interface ImportParcelResult {
  ok: boolean;
  feature?: PlacedFeature;
  meta?: { town: string | null; owner: string | null; acres: number | null; multipart: boolean };
  error?: string;
}

/**
 * Pull the real parcel that contains (lat,lng) from the CT assessor GIS and
 * store it as this project's parcel — replacing any existing one (and clearing
 * the now-stale envelope/validations). Geometry rides the same toGeom() path as
 * a hand-drawn parcel, so everything downstream is unchanged.
 */
export async function importParcel(
  projectId: string,
  point: { lat: number; lng: number },
): Promise<ImportParcelResult> {
  try {
    await assertOwner(projectId);
    const hit = await fetchParcelAt(point.lat, point.lng);
    if (!hit) {
      return { ok: false, error: "No CT parcel found at that location. Draw the lot manually, or check the address." };
    }
    const geojson: GeoJSONGeometry = { type: "Polygon", coordinates: [hit.ring] };

    // Replace: a project has one parcel. Dropping it clears the envelope (FK
    // cascade is on project, not parcel, so clear envelope explicitly) and any
    // validations that referenced the old boundary.
    await sql`delete from feasible.parcels where project_id = ${projectId}`;
    await sql`delete from feasible.building_envelopes where project_id = ${projectId}`;
    await sql`delete from feasible.design_validations where project_id = ${projectId}`;

    const [r] = await sql<{ id: string; gj: string; area_sf: number; perimeter_ft: number }[]>`
      insert into feasible.parcels (project_id, label, geom)
      values (${projectId}, ${hit.address}, ${toGeom(geojson)})
      returning id, ${sql.unsafe(AS_GJ_SQL)} as gj, area_sf, perimeter_ft`;

    // The assessor parcel id lives on the project (parcels has no apn column);
    // centre the project on the parcel if it wasn't already placed.
    await sql`
      update feasible.projects
      set apn = coalesce(${hit.parcelId}, apn),
          center_lat = coalesce(center_lat, ${point.lat}),
          center_lng = coalesce(center_lng, ${point.lng}),
          updated_at = now()
      where id = ${projectId}`;

    revalidatePath(`/projects/${projectId}`);
    return {
      ok: true,
      feature: { kind: "parcel", id: r.id, label: hit.address, geojson: JSON.parse(r.gj), area_sf: r.area_sf, perimeter_ft: r.perimeter_ft },
      meta: { town: hit.town, owner: hit.owner, acres: hit.acres, multipart: hit.multipart },
    };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Parcel import failed." };
  }
}

/** Remove a placed feature (ownership already re-checked via the project). */
export async function deleteFeature(
  projectId: string,
  kind: FeatureKind,
  id: string,
): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertOwner(projectId);
    const table = KIND_TABLE[kind];
    if (!table) return { ok: false, error: "Unknown kind." };
    // leach_fields has no project_id; it's guarded by its septic's project.
    if (kind === "leachfield") {
      await sql`
        delete from feasible.leach_fields lf
        using feasible.septic_systems s
        where lf.id = ${id} and s.id = lf.septic_id and s.project_id = ${projectId}`;
    } else {
      await sql.unsafe(`delete from ${table} where id = $1 and project_id = $2`, [id, projectId]);
    }
    await touch(projectId);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Delete failed." };
  }
}

/** The project's address + a best-effort town (parsed from a "…, Town, CT …" address). */
async function projectLocale(projectId: string): Promise<{ address: string | null; town: string | null }> {
  const [p] = await sql<{ address: string | null }[]>`
    select address from feasible.projects where id = ${projectId}`;
  const address = p?.address ?? null;
  let town: string | null = null;
  if (address) {
    // "21 Hidden Valley Trail, Canton, CT 06019" -> "Canton"
    const parts = address.split(",").map((s) => s.trim());
    const stateIdx = parts.findIndex((s) => /^(CT|MA|RI|Connecticut|Massachusetts|Rhode Island)\b/i.test(s));
    if (stateIdx > 0) town = parts[stateIdx - 1] || null;
  }
  return { address, town };
}

export interface FloodResult {
  ok: boolean;
  report?: FloodReport;
  error?: string;
}

/**
 * FEMA flood-zone report for the study. Uses the parcel centroid when a parcel
 * exists, else the project's map center. Advisory only; ephemeral (not stored).
 */
export async function checkFlood(projectId: string): Promise<FloodResult> {
  try {
    await assertOwner(projectId);
    // Prefer the parcel centroid (4326); fall back to the project's saved center.
    const [pt] = await sql<{ lat: number | null; lng: number | null }[]>`
      with c as (
        select st_transform(st_centroid(geom), 4326) as g
        from feasible.parcels where project_id = ${projectId} limit 1
      )
      select
        coalesce((select st_y(g) from c), (select center_lat from feasible.projects where id = ${projectId})) as lat,
        coalesce((select st_x(g) from c), (select center_lng from feasible.projects where id = ${projectId})) as lng`;
    if (!pt || pt.lat == null || pt.lng == null) {
      return { ok: false, error: "Pull the parcel first (or set a location) so we know where to check." };
    }
    const report = await fetchFloodAt(Number(pt.lat), Number(pt.lng));
    if (!report) return { ok: false, error: "No FEMA flood data at this location." };
    return { ok: true, report };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Flood lookup failed." };
  }
}

/** AI zoning lookup from an uploaded regs PDF (base64, no data: prefix). Proposal only — does NOT save. */
export async function proposeZoningFromPdf(projectId: string, pdfBase64: string): Promise<ProposeResult> {
  try {
    await assertOwner(projectId);
    const { address, town } = await projectLocale(projectId);
    return await proposeFromPdf(pdfBase64, town, address);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Zoning lookup failed." };
  }
}

/** AI zoning lookup via web search. Proposal only — does NOT save. */
export async function proposeZoningFromSearch(projectId: string): Promise<ProposeResult> {
  try {
    await assertOwner(projectId);
    const { address, town } = await projectLocale(projectId);
    return await proposeFromWebSearch(town, address);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Zoning search failed." };
  }
}

export interface ZoningInput {
  zoning_district?: string | null;
  front_setback_ft?: number | null;
  side_setback_ft?: number | null;
  rear_setback_ft?: number | null;
  max_coverage_pct?: number | null;
}

/**
 * Save the confirmed zoning district + dimensional setbacks onto the parcel.
 * These are the values that drive the building envelope — distinct from the
 * health-code well/septic distances in feasible.setback_rules. Whether they came
 * from an uploaded PDF, a web lookup, or manual entry, they land here only after
 * the user confirms them.
 */
export async function saveZoning(projectId: string, z: ZoningInput): Promise<{ ok: boolean; error?: string }> {
  try {
    await assertOwner(projectId);
    const [r] = await sql<{ id: string }[]>`
      update feasible.parcels set
        zoning_district  = ${z.zoning_district ?? null},
        front_setback_ft = ${z.front_setback_ft ?? null},
        side_setback_ft  = ${z.side_setback_ft ?? null},
        rear_setback_ft  = ${z.rear_setback_ft ?? null},
        max_coverage_pct = ${z.max_coverage_pct ?? null}
      where project_id = ${projectId}
      returning id`;
    if (!r) return { ok: false, error: "Pull or draw the parcel first." };
    revalidatePath(`/projects/${projectId}`);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not save zoning." };
  }
}

export interface EnvelopeResult {
  ok: boolean;
  feature?: PlacedFeature;
  error?: string;
}

/**
 * Compute the buildable "building envelope" from the parcel + its setbacks and
 * store it (one current row per project). Method: inset each boundary edge by
 * its role's setback (front edge = front_setback, the edge farthest from it =
 * rear, the rest = side), by subtracting a buffer of each edge from the parcel.
 * When no frontage edge is tagged, fall back to a uniform inset = the largest
 * setback (conservative). Returns the envelope as a 4326 GeoJSON polygon.
 */
export async function computeEnvelope(projectId: string): Promise<EnvelopeResult> {
  try {
    await assertOwner(projectId);

    const [p] = await sql<
      {
        frontage_edge_idx: number | null;
        fr: number | null;
        sd: number | null;
        re: number | null;
        nverts: number;
      }[]
    >`
      select frontage_edge_idx,
             front_setback_ft as fr, side_setback_ft as sd, rear_setback_ft as re,
             st_npoints(st_exteriorring(geom)) as nverts
      from feasible.parcels where project_id = ${projectId}`;
    if (!p) return { ok: false, error: "Import or draw the parcel first." };
    if (p.fr == null && p.sd == null && p.re == null) {
      return { ok: false, error: "Set the zoning setbacks first — the envelope is built from them." };
    }

    const fr = Number(p.fr ?? 0);
    const sd = Number(p.sd ?? 0);
    const re = Number(p.re ?? 0);

    // Build the inset geometry. Two paths: per-edge (frontage tagged) or uniform.
    const envSql =
      p.frontage_edge_idx == null
        ? sql`
            with par as (select geom from feasible.parcels where project_id = ${projectId})
            select st_buffer(geom, ${-Math.max(fr, sd, re)}) as g from par`
        : sql`
            with par as (
              select geom, ${p.frontage_edge_idx}::int as fidx from feasible.parcels where project_id = ${projectId}
            ),
            pts as (
              select (dp).path[1] as idx, (dp).geom as pt, par.geom as pgeom, par.fidx
              from par, st_dumppoints(st_exteriorring(par.geom)) dp
            ),
            edges as (
              select a.idx as eidx, st_makeline(a.pt, b.pt) as eline, a.pgeom, a.fidx
              from pts a join pts b on b.idx = a.idx + 1
            ),
            front as (
              select eline as fline, st_lineinterpolatepoint(eline, 0.5) as fmid
              from edges where eidx = (select fidx from par) + 1
            ),
            rear as (
              select eidx as ridx from edges
              order by st_distance(st_lineinterpolatepoint(eline, 0.5), (select fmid from front)) desc
              limit 1
            ),
            classified as (
              select e.eline, e.pgeom,
                case
                  when e.eidx = (select fidx from par) + 1 then ${fr}::double precision
                  when e.eidx = (select ridx from rear)     then ${re}::double precision
                  else ${sd}::double precision
                end as setback
              from edges e
            ),
            buffers as (select st_buffer(eline, setback) as b from classified where setback > 0)
            select st_difference((select geom from par), coalesce((select st_union(b) from buffers), st_geomfromtext('POLYGON EMPTY', 2234))) as g`;

    // The difference can be a MultiPolygon (a pinched lot splitting the buildable
    // area); keep the largest single polygon for the geometry(Polygon) column.
    const [env] = await sql<{ gj: string; area_sf: number | null; empty: boolean }[]>`
      with raw as (${envSql}),
      largest as (
        select gd.geom as geom
        from raw, st_dump(st_collectionextract(raw.g, 3)) gd
        order by st_area(gd.geom) desc
        limit 1
      )
      select ${sql.unsafe("ST_AsGeoJSON(ST_Transform(geom, 4326))")} as gj,
             st_area(geom) as area_sf,
             (geom is null or st_isempty(geom)) as empty
      from largest`;

    if (!env || env.empty || !env.gj) {
      // Nothing buildable — the setbacks consume the lot. Clear any old envelope.
      await sql`delete from feasible.building_envelopes where project_id = ${projectId}`;
      return { ok: false, error: "No buildable area remains — the setbacks consume the whole lot." };
    }

    const basis = JSON.stringify({ front_ft: fr, side_ft: sd, rear_ft: re, frontage_edge_idx: p.frontage_edge_idx });
    await sql`delete from feasible.building_envelopes where project_id = ${projectId}`;
    const [row] = await sql<{ id: string; gj: string; area_sf: number }[]>`
      insert into feasible.building_envelopes (project_id, geom, basis)
      values (${projectId},
              ST_Transform(ST_SetSRID(ST_GeomFromGeoJSON(${env.gj}), 4326), 2234),
              ${basis}::jsonb)
      returning id, ${sql.unsafe(AS_GJ_SQL)} as gj, area_sf`;

    revalidatePath(`/projects/${projectId}`);
    return { ok: true, feature: { kind: "envelope", id: row.id, label: "Building envelope", geojson: JSON.parse(row.gj), area_sf: row.area_sf } };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Envelope computation failed." };
  }
}

/** Tag which boundary edge fronts the street, then recompute the envelope. */
export async function setFrontageEdge(projectId: string, edgeIdx: number): Promise<EnvelopeResult> {
  try {
    await assertOwner(projectId);
    await sql`
      update feasible.parcels set frontage_edge_idx = ${edgeIdx}
      where project_id = ${projectId}`;
    return await computeEnvelope(projectId);
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not set frontage edge." };
  }
}

export interface FeasibilityResult {
  verdict: "feasible" | "not_feasible" | "incomplete";
  rows: ValidationRow[];
  skipped: string[];
}

/**
 * The engine. For each setback rule, measure the true edge-to-edge distance in
 * feet (geometry is already in State Plane feet, so ST_Distance is direct) and
 * compare against the governing setback_rules row. Writes design_validations,
 * updates project.status, returns the rows + a note of any rule skipped for
 * lack of features.
 */
export async function runFeasibility(projectId: string): Promise<FeasibilityResult> {
  const userId = await assertOwner(projectId);

  // Geometry set for one side of a rule, as a subquery yielding column `g`.
  const geomSet = (side: string) => {
    switch (side) {
      case "well":
        return sql`select geom as g from feasible.wells where project_id = ${projectId}`;
      case "septic":
        return sql`select geom as g from feasible.septic_systems where project_id = ${projectId}`;
      case "leachfield":
        return sql`select lf.geom as g from feasible.leach_fields lf
                   join feasible.septic_systems s on s.id = lf.septic_id
                   where s.project_id = ${projectId}`;
      case "property_line":
        return sql`select ST_Boundary(geom) as g from feasible.parcels where project_id = ${projectId}`;
      case "watercourse":
        return sql`select geom as g from feasible.site_features
                   where project_id = ${projectId} and kind = 'watercourse'`;
      default:
        return sql`select null::geometry as g where false`;
    }
  };

  const rows: ValidationRow[] = [];
  const skipped: string[] = [];

  for (const rule of RULES) {
    // Governing required distance: prefer the user's override, else the shared
    // default. (Jurisdiction-specific overrides layer in here later.)
    const [req] = await sql<{ min_distance_ft: number }[]>`
      select min_distance_ft from feasible.setback_rules
      where rule_key = ${rule.rule_key}
        and (owner_id = ${userId} or owner_id is null)
      order by owner_id nulls last
      limit 1`;
    if (!req) {
      skipped.push(rule.rule_key);
      continue;
    }

    const [dist] = await sql<{ d: number | null; na: number; nb: number }[]>`
      with a as (${geomSet(rule.a)}), b as (${geomSet(rule.b)})
      select min(ST_Distance(a.g, b.g)) as d,
             (select count(*) from a) as na,
             (select count(*) from b) as nb
      from a, b`;

    if (!dist || dist.na === 0 || dist.nb === 0 || dist.d == null) {
      skipped.push(rule.rule_key);
      continue;
    }

    const measured = Number(dist.d);
    const required = Number(req.min_distance_ft);
    let status: ValidationStatus;
    if (measured < required) status = "fail";
    else if (measured < required * 1.05) status = "warn";
    else status = "pass";

    const message =
      status === "fail"
        ? `${Math.round(measured)} ft — short of the ${required} ft minimum.`
        : status === "warn"
          ? `${Math.round(measured)} ft — meets ${required} ft, but only just.`
          : `${Math.round(measured)} ft — clears the ${required} ft minimum.`;

    rows.push({
      rule_key: rule.rule_key,
      measured_ft: Math.round(measured * 10) / 10,
      required_ft: required,
      status,
      subject_a: rule.a,
      subject_b: String(rule.b),
      message,
    });
  }

  // Building-envelope containment: every placed house must sit inside the
  // computed envelope. Only evaluated when both an envelope and a house exist.
  const [envHouse] = await sql<{ nhouses: number; nenv: number; noutside: number; maxout: number | null }[]>`
    with env as (select geom as g from feasible.building_envelopes where project_id = ${projectId}),
         h as (select geom as g from feasible.template_placements where project_id = ${projectId})
    select (select count(*) from h) as nhouses,
           (select count(*) from env) as nenv,
           (select count(*) from h, env where not st_within(h.g, env.g)) as noutside,
           (select max(st_distance(h.g, env.g)) from h, env where not st_within(h.g, env.g)) as maxout`;
  if (envHouse && envHouse.nenv > 0 && envHouse.nhouses > 0) {
    const outside = Number(envHouse.noutside);
    const status: ValidationStatus = outside > 0 ? "fail" : "pass";
    const message =
      outside > 0
        ? `${outside} of ${envHouse.nhouses} house${envHouse.nhouses === 1 ? "" : "s"} cross the setback line` +
          (envHouse.maxout ? ` (up to ${Math.round(Number(envHouse.maxout))} ft outside).` : ".")
        : `All ${envHouse.nhouses} house${envHouse.nhouses === 1 ? "" : "s"} sit within the buildable area.`;
    rows.push({
      rule_key: HOUSE_IN_ENVELOPE,
      measured_ft: envHouse.maxout != null ? Math.round(Number(envHouse.maxout) * 10) / 10 : 0,
      required_ft: 0,
      status,
      subject_a: "house",
      subject_b: "envelope",
      message,
    });
  } else if (envHouse && envHouse.nenv > 0) {
    skipped.push(HOUSE_IN_ENVELOPE);
  }

  // Persist: replace this project's validation set, then set the verdict.
  const verdict = verdictOf(rows.map((r) => r.status));
  await sql`delete from feasible.design_validations where project_id = ${projectId}`;
  for (const r of rows) {
    await sql`
      insert into feasible.design_validations
        (project_id, rule_key, measured_ft, required_ft, status, subject_a, subject_b, message)
      values (${projectId}, ${r.rule_key}, ${r.measured_ft}, ${r.required_ft},
              ${r.status}::feasible.validation_status, ${r.subject_a}, ${r.subject_b}, ${r.message})`;
  }
  const statusValue =
    verdict === "feasible" ? "feasible" : verdict === "not_feasible" ? "not_feasible" : "in_review";
  await sql`
    update feasible.projects set status = ${statusValue}::feasible.project_status, updated_at = now()
    where id = ${projectId}`;

  revalidatePath(`/projects/${projectId}`);
  revalidatePath("/");
  return { verdict, rows, skipped };
}

async function touch(projectId: string) {
  await sql`update feasible.projects set updated_at = now() where id = ${projectId}`;
}

function ok(feature: PlacedFeature): SaveResult {
  return { ok: true, feature };
}
