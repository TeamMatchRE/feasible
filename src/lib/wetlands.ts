import "server-only";

/**
 * Wetlands lookup against the USFWS National Wetlands Inventory (NWI), hosted on
 * USGS WIM. We query the wetland polygons that INTERSECT the parcel (not a single
 * point), so a large lot with a wetland in one corner is still flagged.
 *
 * Federal mapping — advisory. In CT the locally-regulated inland-wetland *soils*
 * (town IWWC) can differ; this is a first-pass screen, not a delineation.
 */

const NWI = "https://fwspublicservices.wim.usgs.gov/wetlandsmapservice/rest/services/Wetlands/MapServer";

export interface WetlandGroup {
  type: string; // e.g. "Freshwater Forested/Shrub Wetland"
  codes: string[]; // NWI codes, e.g. ["PFO1E"]
  acres: number; // summed mapped extent of the intersecting polygons
}

export interface WetlandsReport {
  present: boolean;
  groups: WetlandGroup[];
  count: number; // number of intersecting wetland polygons
}

interface WetAttrs {
  "Wetlands.WETLAND_TYPE"?: string | null;
  "Wetlands.ATTRIBUTE"?: string | null;
  "Wetlands.ACRES"?: number | null;
}

/**
 * Wetlands intersecting a parcel ring ([lng,lat][], EPSG:4326). Returns a report
 * grouped by wetland type, or null if the service errors.
 */
export async function fetchWetlandsForParcel(ring: [number, number][]): Promise<WetlandsReport | null> {
  const geometry = JSON.stringify({ rings: [ring], spatialReference: { wkid: 4326 } });
  const body = new URLSearchParams({
    geometry,
    geometryType: "esriGeometryPolygon",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "Wetlands.WETLAND_TYPE,Wetlands.ATTRIBUTE,Wetlands.ACRES",
    returnGeometry: "false",
    f: "json",
  });

  let json: { features?: { attributes: WetAttrs }[]; error?: unknown };
  try {
    // POST — a parcel ring can be too long for a query string.
    const res = await fetch(`${NWI}/0/query`, {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: body.toString(),
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }
  if (json.error) return null;
  const feats = json.features ?? [];

  // Group by wetland type; collect distinct codes and sum acres.
  const byType = new Map<string, WetlandGroup>();
  for (const f of feats) {
    const a = f.attributes;
    const type = a["Wetlands.WETLAND_TYPE"] ?? "Wetland";
    const code = a["Wetlands.ATTRIBUTE"] ?? null;
    const acres = a["Wetlands.ACRES"] ?? 0;
    const g = byType.get(type) ?? { type, codes: [], acres: 0 };
    if (code && !g.codes.includes(code)) g.codes.push(code);
    g.acres += acres;
    byType.set(type, g);
  }
  const groups = [...byType.values()]
    .map((g) => ({ ...g, acres: Math.round(g.acres * 100) / 100 }))
    .sort((a, b) => b.acres - a.acres);

  return { present: feats.length > 0, groups, count: feats.length };
}
