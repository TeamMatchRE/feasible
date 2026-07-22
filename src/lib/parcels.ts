import "server-only";

/**
 * Connecticut parcel lookup against the official statewide assessor GIS.
 *
 * Source: the CT Office of Policy & Management / COG "CAMA and Parcel" layer,
 * published as a public ArcGIS FeatureServer. A point-intersect query returns
 * the parcel polygon (as 4326 GeoJSON) plus assessor attributes (town, address,
 * owner, acreage, parcel id). This is the authoritative, free source — Google
 * has no parcel API and MLS RETS carries only lot-size text, not geometry.
 *
 * The returned ring is [lng,lat][] in EPSG:4326, closed, ready to hand to the
 * existing toGeom() path in the project actions (ST_GeomFromGeoJSON → 2234).
 */

const CT_PARCEL_LAYER =
  "https://services3.arcgis.com/3FL1kr7L4LvwA2Kb/arcgis/rest/services/Connecticut_CAMA_and_Parcel_Layer_2024/FeatureServer/0";

export interface ParcelHit {
  /** Outer ring, [lng,lat][], EPSG:4326, closed (first == last). */
  ring: [number, number][];
  town: string | null;
  address: string | null;
  owner: string | null;
  acres: number | null;
  parcelId: string | null;
  /** True when the source parcel was multipolygon and we kept the largest ring. */
  multipart: boolean;
}

interface EsriProps {
  Town_Name?: string | null;
  Location_1?: string | null;
  Owner?: string | null;
  Land_Acres?: number | null;
  Parcel_ID?: string | null;
}

type Ring = [number, number][];

/** Shoelace area (in squared degrees — only used to compare candidate rings). */
function ringArea(ring: Ring): number {
  let a = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [x1, y1] = ring[i];
    const [x2, y2] = ring[i + 1];
    a += x1 * y2 - x2 * y1;
  }
  return Math.abs(a) / 2;
}

/** Ensure a ring is closed (first vertex repeated at the end). */
function close(ring: Ring): Ring {
  if (ring.length === 0) return ring;
  const [fx, fy] = ring[0];
  const [lx, ly] = ring[ring.length - 1];
  return fx === lx && fy === ly ? ring : [...ring, [fx, fy]];
}

/**
 * Fetch the CT parcel that contains (lat,lng). Returns null when no parcel is
 * found (point off a mapped parcel, out of state) or the service errors.
 */
export async function fetchParcelAt(lat: number, lng: number): Promise<ParcelHit | null> {
  const params = new URLSearchParams({
    geometry: `${lng},${lat}`,
    geometryType: "esriGeometryPoint",
    inSR: "4326",
    outSR: "4326",
    spatialRel: "esriSpatialRelIntersects",
    outFields: "Town_Name,Location_1,Owner,Land_Acres,Parcel_ID",
    returnGeometry: "true",
    f: "geojson",
  });

  let json: {
    features?: { geometry: { type: string; coordinates: unknown }; properties: EsriProps }[];
    error?: { message?: string };
  };
  try {
    const res = await fetch(`${CT_PARCEL_LAYER}/query?${params}`, {
      // Parcel geometry is stable; a day of caching is fine and spares the service.
      next: { revalidate: 86400 },
    });
    if (!res.ok) return null;
    json = await res.json();
  } catch {
    return null;
  }
  if (json.error || !json.features?.length) return null;

  const feat = json.features[0];
  const geom = feat.geometry;
  let ring: Ring;
  let multipart = false;

  if (geom.type === "Polygon") {
    ring = (geom.coordinates as Ring[])[0];
  } else if (geom.type === "MultiPolygon") {
    // Keep the largest outer ring — our column is a single Polygon. Rare for
    // residential lots; flagged so the UI can warn if it ever matters.
    multipart = true;
    const polys = geom.coordinates as Ring[][];
    let best = polys[0][0];
    let bestArea = ringArea(best);
    for (const p of polys) {
      const a = ringArea(p[0]);
      if (a > bestArea) {
        best = p[0];
        bestArea = a;
      }
    }
    ring = best;
  } else {
    return null;
  }

  const p = feat.properties ?? {};
  return {
    ring: close(ring),
    town: p.Town_Name ?? null,
    address: p.Location_1 ?? null,
    owner: p.Owner ?? null,
    acres: p.Land_Acres ?? null,
    parcelId: p.Parcel_ID ?? null,
    multipart,
  };
}
