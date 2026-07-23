import "server-only";

/**
 * Ground elevation from the USGS 3DEP Elevation Point Query Service (EPQS) —
 * free, nationwide, one point per call. We sample the parcel outline + placed
 * features in parallel to get a spot elevation at each feature and the site's
 * high/low relief. LiDAR-derived (~1 m), so good for grading/gravity-flow gut
 * checks, not a survey.
 */

const EPQS = "https://epqs.nationalmap.gov/v1/json";

/** Elevation (ft) at one point, or null on error / no-data. One quick retry. */
export async function fetchElevation(lat: number, lng: number): Promise<number | null> {
  const url = `${EPQS}?x=${lng}&y=${lat}&units=Feet&wkid=4326`;
  for (let attempt = 0; attempt < 2; attempt++) {
    try {
      const res = await fetch(url, { signal: AbortSignal.timeout(8_000) });
      if (!res.ok) continue;
      const json = (await res.json()) as { value?: number | string };
      const v = typeof json.value === "string" ? parseFloat(json.value) : json.value;
      // EPQS returns a large negative sentinel outside coverage.
      if (v == null || Number.isNaN(v) || v < -1000) return null;
      return Math.round(v * 10) / 10;
    } catch {
      // timeout / transient — retry once
    }
  }
  return null;
}

/**
 * Elevations for many points, index-aligned. EPQS is one-point and gets flaky
 * when hammered, so cap concurrency to a small pool rather than firing all at once.
 */
export async function fetchElevations(pts: { lat: number; lng: number }[]): Promise<(number | null)[]> {
  const out: (number | null)[] = new Array(pts.length).fill(null);
  const POOL = 4;
  let next = 0;
  async function worker() {
    while (next < pts.length) {
      const i = next++;
      out[i] = await fetchElevation(pts[i].lat, pts[i].lng);
    }
  }
  await Promise.all(Array.from({ length: Math.min(POOL, pts.length) }, worker));
  return out;
}
