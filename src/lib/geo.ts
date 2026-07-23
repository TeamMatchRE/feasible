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

/** [lng, lat] in EPSG:4326. */
export type LngLat = [number, number];

const R_FT = 20925721.784; // mean Earth radius in feet
const rad = (d: number) => (d * Math.PI) / 180;

/** Great-circle distance between two 4326 points, in feet. */
export function distFt(a: LngLat, b: LngLat): number {
  const dLat = rad(b[1] - a[1]);
  const dLng = rad(b[0] - a[0]);
  const h =
    Math.sin(dLat / 2) ** 2 + Math.cos(rad(a[1])) * Math.cos(rad(b[1])) * Math.sin(dLng / 2) ** 2;
  return 2 * R_FT * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * Per-edge lengths of a closed 4326 ring, in feet, with each segment's midpoint
 * (for on-map dimension labels like the MLS "302 ft / 434 ft" annotations).
 */
export function ringEdgesFt(ring: LngLat[]): { mid: LngLat; ft: number }[] {
  const out: { mid: LngLat; ft: number }[] = [];
  for (let i = 0; i < ring.length - 1; i++) {
    out.push({
      mid: [(ring[i][0] + ring[i + 1][0]) / 2, (ring[i][1] + ring[i + 1][1]) / 2],
      ft: distFt(ring[i], ring[i + 1]),
    });
  }
  return out;
}

/**
 * Closest point on segment a–b to p, plus its distance in feet. Works in a local
 * equirectangular projection centred on p (accurate at site scale, no Google lib).
 */
export function nearestOnSegment(p: LngLat, a: LngLat, b: LngLat): { point: LngLat; ft: number } {
  const fpdLat = (R_FT * Math.PI) / 180;
  const fpdLng = fpdLat * Math.cos(rad(p[1]));
  const xy = (q: LngLat): [number, number] => [(q[0] - p[0]) * fpdLng, (q[1] - p[1]) * fpdLat];
  const ax = xy(a);
  const bx = xy(b);
  const dx = bx[0] - ax[0];
  const dy = bx[1] - ax[1];
  const len2 = dx * dx + dy * dy;
  // p is the origin (0,0); project it onto the segment.
  const t = len2 === 0 ? 0 : Math.max(0, Math.min(1, -(ax[0] * dx + ax[1] * dy) / len2));
  const cx = ax[0] + t * dx;
  const cy = ax[1] + t * dy;
  const point: LngLat = [p[0] + cx / fpdLng, p[1] + cy / fpdLat];
  return { point, ft: Math.hypot(cx, cy) };
}

/** Closest point on a closed ring's boundary to p, with distance in feet. */
export function nearestOnRing(p: LngLat, ring: LngLat[]): { point: LngLat; ft: number } | null {
  let best: { point: LngLat; ft: number } | null = null;
  for (let i = 0; i < ring.length - 1; i++) {
    const c = nearestOnSegment(p, ring[i], ring[i + 1]);
    if (!best || c.ft < best.ft) best = c;
  }
  return best;
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
