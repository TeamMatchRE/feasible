import "server-only";

/**
 * FEMA flood-zone lookup against the National Flood Hazard Layer (NFHL) — the
 * same authoritative source the MLS "Property Flood Report" uses. Two point-
 * intersect queries against FEMA's public ArcGIS service:
 *   layer 28 (Flood Hazard Zones) → zone code, subtype, SFHA flag, base flood elev
 *   layer 3  (FIRM Panels)         → panel number + effective date
 *
 * Advisory only — FEMA's own disclaimer says the map isn't for regulatory use.
 */

const NFHL = "https://hazards.fema.gov/arcgis/rest/services/public/NFHL/MapServer";

export interface FloodReport {
  zone: string | null;
  /** ZONE_SUBTY, e.g. "AREA OF MINIMAL FLOOD HAZARD" / "0.2 PCT ANNUAL CHANCE FLOOD HAZARD". */
  subtype: string | null;
  /** Special Flood Hazard Area: true = "In", false = "Out", null = unknown. */
  sfha: boolean | null;
  /** Base flood elevation (ft) when the zone carries one (AE/VE); else null. */
  staticBfe: number | null;
  panel: string | null;
  /** FIRM panel effective date as ISO yyyy-mm-dd. */
  panelDate: string | null;
  /** A plain-language gloss of the zone for the card. */
  description: string;
}

// Short human descriptions for the common zones (FEMA's own wording, condensed).
const ZONE_DESC: Record<string, string> = {
  X: "Outside the 100- and 500-year floodplains (minimal hazard).",
  AE: "100-year floodplain with a base flood elevation determined.",
  A: "100-year floodplain; no base flood elevation determined.",
  AO: "Shallow flooding (sheet flow), 1–3 ft depths.",
  AH: "Shallow flooding (ponding) with a base flood elevation.",
  VE: "Coastal high-hazard area with wave action and a base flood elevation.",
  D: "Possible but undetermined flood hazard.",
};

interface ZoneAttrs {
  FLD_ZONE?: string | null;
  ZONE_SUBTY?: string | null;
  SFHA_TF?: string | null;
  STATIC_BFE?: number | null;
}
interface PanelAttrs {
  FIRM_PAN?: string | null;
  EFF_DATE?: number | null;
}

async function queryFirst<T>(layer: number, lat: number, lng: number, fields: string): Promise<T | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: fields,
    returnGeometry: "false",
    f: "json",
  });
  try {
    const res = await fetch(`${NFHL}/${layer}/query?${params}`, { next: { revalidate: 86400 } });
    if (!res.ok) return null;
    const json = (await res.json()) as { features?: { attributes: T }[]; error?: unknown };
    if (json.error || !json.features?.length) return null;
    return json.features[0].attributes;
  } catch {
    return null;
  }
}

/** Fetch the FEMA flood report at (lat,lng). Returns null when out of NFHL coverage. */
export async function fetchFloodAt(lat: number, lng: number): Promise<FloodReport | null> {
  const zone = await queryFirst<ZoneAttrs>(28, lat, lng, "FLD_ZONE,ZONE_SUBTY,SFHA_TF,STATIC_BFE");
  if (!zone) return null;
  const panel = await queryFirst<PanelAttrs>(3, lat, lng, "FIRM_PAN,EFF_DATE");

  const code = zone.FLD_ZONE ?? null;
  const sfha = zone.SFHA_TF == null ? null : zone.SFHA_TF.toUpperCase() === "T";
  // Static BFE uses -9999 as a "not applicable" sentinel.
  const bfe = zone.STATIC_BFE != null && zone.STATIC_BFE > -1000 ? zone.STATIC_BFE : null;
  const panelDate =
    panel?.EFF_DATE != null ? new Date(panel.EFF_DATE).toISOString().slice(0, 10) : null;

  const description =
    (code && ZONE_DESC[code]) ??
    zone.ZONE_SUBTY ??
    (code ? `FEMA flood zone ${code}.` : "Flood hazard not determined.");

  return {
    zone: code,
    subtype: zone.ZONE_SUBTY ?? null,
    sfha,
    staticBfe: bfe,
    panel: panel?.FIRM_PAN ?? null,
    panelDate,
    description,
  };
}
