"use client";

import { Loader } from "@googlemaps/js-api-loader";

/**
 * Shared Google Maps JS loader. One Loader instance per tab so the drawing +
 * geometry libraries load once and every map/geocoder call shares them. Uses
 * the referrer-restricted public key (NEXT_PUBLIC_GOOGLE_MAPS_API_KEY) — the
 * same key dwell / solar already run on. Restrict it by HTTP referrer in the
 * Google Cloud console (localhost:3010 + the prod host).
 */
let loaderPromise: Promise<typeof google> | null = null;

export function loadGoogleMaps(): Promise<typeof google> {
  if (loaderPromise) return loaderPromise;
  const apiKey = process.env.NEXT_PUBLIC_GOOGLE_MAPS_API_KEY;
  if (!apiKey) {
    return Promise.reject(
      new Error("NEXT_PUBLIC_GOOGLE_MAPS_API_KEY is not set — add it to .env.local"),
    );
  }
  // No "drawing" library: Google removed DrawingManager as of Maps JS v3.65.
  // We draw with native click handlers on the stable Polygon/Polyline/Marker
  // primitives instead (see Studio.tsx). Core covers Geocoder + geometry math
  // we need, so no extra libraries are required.
  const loader = new Loader({
    apiKey,
    version: "weekly",
    libraries: [],
  });
  loaderPromise = loader.load();
  return loaderPromise;
}
