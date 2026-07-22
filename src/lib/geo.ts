/**
 * Shared geo vocabulary for Feasible. Client-safe (no server-only imports) so
 * the map studio and the server actions agree on kinds, colors, and geometry
 * shapes. All GeoJSON here is EPSG:4326 (lat/lng) — the DB stores EPSG:2234
 * (CT State Plane, feet) and transforms on the boundary.
 */

/** The things a user can place on a site. */
export type FeatureKind =
  | "parcel"
  | "house"
  | "well"
  | "septic"
  | "leachfield"
  | "road"
  | "envelope";

export type GeomType = "Polygon" | "Point" | "LineString";

/** GeoJSON geometry as it crosses the client/server boundary (always 4326). */
export interface GeoJSONGeometry {
  type: GeomType;
  coordinates: unknown;
}

export interface PlacedFeature {
  kind: FeatureKind;
  id: string;
  label: string | null;
  geojson: GeoJSONGeometry;
  /** Present for polygons (parcel/house/leachfield). */
  area_sf?: number | null;
  /** Present for the parcel. */
  perimeter_ft?: number | null;
  /** Present for roads. */
  length_ft?: number | null;
  /** Present for septic. */
  num_bedrooms?: number | null;
}

/** Per-kind drawing behaviour + palette. Colors stay in the Brooke register. */
export const KIND_META: Record<
  FeatureKind,
  { label: string; geom: GeomType; stroke: string; fill: string }
> = {
  parcel: { label: "Property line", geom: "Polygon", stroke: "#1b2a44", fill: "#1b2a4400" },
  house: { label: "House", geom: "Polygon", stroke: "#8c6d34", fill: "#b08a4633" },
  leachfield: { label: "Leach field", geom: "Polygon", stroke: "#2f6b4f", fill: "#2f6b4f2e" },
  well: { label: "Well", geom: "Point", stroke: "#2b6ca3", fill: "#2b6ca3" },
  septic: { label: "Septic tank", geom: "Point", stroke: "#7a4bbf", fill: "#7a4bbf" },
  road: { label: "Road / drive", geom: "LineString", stroke: "#5a5346", fill: "#5a534600" },
  // The computed buildable area. Not user-drawn — rendered from the setbacks.
  envelope: { label: "Building envelope", geom: "Polygon", stroke: "#2f6b4f", fill: "#2f6b4f22" },
};

export type ValidationStatus = "pass" | "warn" | "fail";

export interface ValidationRow {
  rule_key: string;
  measured_ft: number | null;
  required_ft: number | null;
  status: ValidationStatus;
  subject_a: string | null;
  subject_b: string | null;
  message: string | null;
}

/**
 * The setback checks the engine runs, and how to describe each. `rule_key`
 * matches feasible.setback_rules. `a`/`b` name the two feature kinds measured;
 * `measure` says whether we want edge-to-edge (min distance) — always min here.
 * If a required distance isn't present in setback_rules, the check is skipped.
 */
export interface RuleDef {
  rule_key: string;
  label: string;
  a: FeatureKind;
  b: FeatureKind | "property_line" | "watercourse";
}

export const RULES: RuleDef[] = [
  { rule_key: "well_to_septic", label: "Well → Septic tank", a: "well", b: "septic" },
  { rule_key: "well_to_leachfield", label: "Well → Leach field", a: "well", b: "leachfield" },
  { rule_key: "well_to_property_line", label: "Well → Property line", a: "well", b: "property_line" },
  { rule_key: "septic_to_property_line", label: "Septic tank → Property line", a: "septic", b: "property_line" },
  { rule_key: "leachfield_to_property_line", label: "Leach field → Property line", a: "leachfield", b: "property_line" },
];

/**
 * The building-envelope containment check. Structurally different from the
 * distance RULES above (it's ST_Within, not ST_Distance), so the engine
 * produces it separately — but it shares the ValidationRow shape and shows up
 * in the same Setback-checks list.
 */
export const HOUSE_IN_ENVELOPE = "house_in_envelope";

const EXTRA_LABELS: Record<string, string> = {
  [HOUSE_IN_ENVELOPE]: "House within building envelope",
};

/** Human label for a rule_key, falling back to the raw key. */
export function ruleLabel(key: string): string {
  return RULES.find((r) => r.rule_key === key)?.label ?? EXTRA_LABELS[key] ?? key;
}

/**
 * Per-edge lengths of a closed 4326 ring, in feet, with each segment's midpoint
 * (for on-map dimension labels like the MLS "302 ft / 434 ft" annotations).
 * Uses the haversine great-circle distance — plenty accurate at parcel scale
 * and avoids pulling in Google's geometry library (the loader ships with none).
 */
export function ringEdgesFt(
  ring: [number, number][],
): { mid: [number, number]; ft: number }[] {
  const R_FT = 20925721.784; // mean Earth radius in feet
  const rad = (d: number) => (d * Math.PI) / 180;
  const out: { mid: [number, number]; ft: number }[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    const [lng1, lat1] = ring[i];
    const [lng2, lat2] = ring[i + 1];
    const dLat = rad(lat2 - lat1);
    const dLng = rad(lng2 - lng1);
    const a =
      Math.sin(dLat / 2) ** 2 +
      Math.cos(rad(lat1)) * Math.cos(rad(lat2)) * Math.sin(dLng / 2) ** 2;
    const ft = 2 * R_FT * Math.asin(Math.min(1, Math.sqrt(a)));
    out.push({ mid: [(lng1 + lng2) / 2, (lat1 + lat2) / 2], ft });
  }
  return out;
}

/** Overall verdict from a set of validation rows. */
export function verdictOf(rows: ValidationStatus[]): "feasible" | "not_feasible" | "incomplete" {
  if (rows.length === 0) return "incomplete";
  if (rows.some((s) => s === "fail")) return "not_feasible";
  return "feasible";
}

export function fmtFt(n: number | null | undefined): string {
  if (n == null) return "—";
  return `${Math.round(n * 10) / 10} ft`;
}

export function fmtSf(n: number | null | undefined): string {
  if (n == null) return "—";
  const sf = Math.round(n);
  const ac = sf / 43560;
  return `${sf.toLocaleString()} sf (${ac.toFixed(2)} ac)`;
}
