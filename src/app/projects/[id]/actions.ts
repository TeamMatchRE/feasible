"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { sql } from "@/db";
import {
  RULES,
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
};

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
