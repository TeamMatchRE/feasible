"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import { loadGoogleMaps } from "@/lib/google-maps";
import {
  KIND_META,
  RULES,
  ruleLabel,
  verdictOf,
  fmtFt,
  fmtSf,
  ringEdgesFt,
  distFt,
  nearestOnRing,
  type FeatureKind,
  type PlacedFeature,
  type GeoJSONGeometry,
  type ValidationRow,
  type LngLat,
} from "@/lib/geo";
import type { ParcelInfo } from "@/lib/queries";
import { OVERLAYS, type OverlayId } from "@/lib/overlays";
import {
  saveFeature,
  deleteFeature,
  runFeasibility,
  importParcel,
  setFrontageEdge,
  computeEnvelope,
  saveZoning,
  proposeZoningFromPdf,
  proposeZoningFromSearch,
  checkFlood,
  checkWetlands,
  checkElevation,
  placeDesign,
  type ZoningInput,
  type ElevationReport,
} from "./actions";
import type { FloodReport } from "@/lib/flood";
import type { WetlandsReport } from "@/lib/wetlands";
import type { PlaceableDesign } from "@/lib/queries";

// Default frame: north-central CT, until a project has a center or a parcel.
const CT_DEFAULT = { lat: 41.8, lng: -72.75 };

const TOOL_ORDER: FeatureKind[] = ["parcel", "house", "well", "septic", "leachfield", "road"];

/* ---- Render a saved feature (4326 GeoJSON) as a Google overlay ------------- */

function drawFeature(
  g: typeof google,
  map: google.maps.Map,
  f: PlacedFeature,
): google.maps.MVCObject {
  const meta = KIND_META[f.kind];
  if (f.geojson.type === "Point") {
    const [lng, lat] = f.geojson.coordinates as [number, number];
    return new g.maps.Marker({
      position: { lat, lng },
      map,
      title: meta.label,
      clickable: false, // let map clicks pass through so new features can be placed on top
      icon: {
        path: g.maps.SymbolPath.CIRCLE,
        scale: 7,
        fillColor: meta.stroke,
        fillOpacity: 1,
        strokeColor: "#ffffff",
        strokeWeight: 2,
      },
    });
  }
  if (f.geojson.type === "LineString") {
    const path = (f.geojson.coordinates as [number, number][]).map(([lng, lat]) => ({ lat, lng }));
    if (f.kind === "road") {
      // Driveway: a casing (light edge) under a fill, so it reads as a paved
      // ribbon on the aerial rather than a thin line. Two polylines behind one
      // MVCObject-like handle so the existing overlay add/remove path still works.
      const casing = new g.maps.Polyline({ path, map, clickable: false, strokeColor: "#efe7d6", strokeWeight: 9, strokeOpacity: 0.95, zIndex: 1 });
      const fill = new g.maps.Polyline({ path, map, clickable: false, strokeColor: "#8a7a5c", strokeWeight: 5, strokeOpacity: 1, zIndex: 2 });
      return {
        setMap: (m: google.maps.Map | null) => {
          casing.setMap(m);
          fill.setMap(m);
        },
      } as unknown as google.maps.MVCObject;
    }
    return new g.maps.Polyline({
      path,
      map,
      clickable: false,
      strokeColor: meta.stroke,
      strokeWeight: 4,
      strokeOpacity: 0.9,
    });
  }
  // Polygon
  const ring = (f.geojson.coordinates as [number, number][][])[0].map(([lng, lat]) => ({ lat, lng }));
  return new g.maps.Polygon({
    paths: ring,
    map,
    clickable: false, // crucial: a clickable parcel would swallow clicks meant to place a well/septic inside it
    strokeColor: meta.stroke,
    strokeWeight: 2,
    fillColor: meta.stroke,
    fillOpacity: f.kind === "parcel" ? 0 : 0.18,
  });
}

/* ---- Component ------------------------------------------------------------- */

interface Draft {
  points: google.maps.LatLng[];
  line: google.maps.Polyline | null;
  poly: google.maps.Polygon | null;
  markers: google.maps.Marker[];
}

export default function Studio({
  projectId,
  address,
  center,
  initialFeatures,
  initialValidations,
  initialParcel,
  initialHasEnvelope,
  designs,
}: {
  projectId: string;
  address: string | null;
  center: { lat: number; lng: number } | null;
  initialFeatures: PlacedFeature[];
  initialValidations: ValidationRow[];
  initialParcel: ParcelInfo | null;
  initialHasEnvelope: boolean;
  designs: PlaceableDesign[];
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<typeof google | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<Map<string, google.maps.MVCObject>>(new Map());
  const draftRef = useRef<Draft>({ points: [], line: null, poly: null, markers: [] });
  // Edge dimension labels + frontage-tag markers, kept apart from feature overlays.
  const dimLabelsRef = useRef<google.maps.Marker[]>([]);
  const edgeMarkersRef = useRef<google.maps.Marker[]>([]);
  // Live distance "rubber-band" shown while placing a well/septic.
  const measureLineRef = useRef<google.maps.Polyline | null>(null);
  const measureLabelRef = useRef<google.maps.Marker | null>(null);
  // Toggleable ArcGIS raster overlays (flood / wetlands / hillshade).
  const overlayRefs = useRef<Partial<Record<OverlayId, google.maps.ImageMapType>>>({});

  const [ready, setReady] = useState(false);
  const [features, setFeatures] = useState<PlacedFeature[]>(initialFeatures);
  const [validations, setValidations] = useState<ValidationRow[]>(initialValidations);
  const [activeTool, setActiveTool] = useState<FeatureKind | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [bedrooms, setBedrooms] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);
  const [parcel, setParcel] = useState<ParcelInfo | null>(initialParcel);
  const [hasEnvelope, setHasEnvelope] = useState(initialHasEnvelope);
  const [frontageMode, setFrontageMode] = useState(false);
  // Live distances (to the pair feature / property line / house) while placing.
  const [liveMeasure, setLiveMeasure] = useState<{ label: string; ft: number; min?: number }[]>([]);
  const [overlays, setOverlays] = useState<Set<OverlayId>>(new Set());
  // Place-a-design mode: the next map click drops the chosen design's footprint.
  const [placeDesignId, setPlaceDesignId] = useState<string>("");
  const [placeRotation, setPlaceRotation] = useState(0);
  const [placing, setPlacing] = useState(false);
  const placeDesignIdRef = useRef("");
  const placeRotationRef = useRef(0);
  placeDesignIdRef.current = placeDesignId;
  placeRotationRef.current = placeRotation;

  const activeToolRef = useRef<FeatureKind | null>(null);
  const bedroomsRef = useRef(3);
  const busyRef = useRef(false);
  const featuresRef = useRef<PlacedFeature[]>(initialFeatures);
  activeToolRef.current = activeTool;
  bedroomsRef.current = bedrooms;
  busyRef.current = busy;
  featuresRef.current = features;

  const removeOverlay = useCallback((id: string) => {
    const ov = overlaysRef.current.get(id);
    if (ov) {
      (ov as unknown as { setMap: (m: null) => void }).setMap(null);
      overlaysRef.current.delete(id);
    }
  }, []);

  const clearDraft = useCallback(() => {
    const d = draftRef.current;
    d.line?.setMap(null);
    d.poly?.setMap(null);
    d.markers.forEach((m) => m.setMap(null));
    draftRef.current = { points: [], line: null, poly: null, markers: [] };
    setDraftCount(0);
  }, []);

  // Redraw the in-progress geometry from the accumulated vertices.
  const redrawDraft = useCallback((kind: FeatureKind) => {
    const g = gRef.current;
    const map = mapRef.current;
    const d = draftRef.current;
    if (!g || !map) return;
    const meta = KIND_META[kind];
    const path = d.points;

    d.line?.setMap(null);
    d.poly?.setMap(null);
    d.markers.forEach((m) => m.setMap(null));
    d.markers = [];

    if (meta.geom === "Polygon") {
      d.poly =
        d.poly ??
        new g.maps.Polygon({
          map,
          clickable: false,
          strokeColor: meta.stroke,
          strokeWeight: 2,
          fillColor: meta.stroke,
          fillOpacity: 0.15,
        });
      d.poly.setPath(path);
      d.poly.setMap(map);
    } else {
      d.line =
        d.line ??
        new g.maps.Polyline({ map, clickable: false, strokeColor: meta.stroke, strokeWeight: 3 });
      d.line.setPath(path);
      d.line.setMap(map);
    }
    d.markers = path.map(
      (p) =>
        new g.maps.Marker({
          position: p,
          map,
          clickable: false,
          icon: {
            path: g.maps.SymbolPath.CIRCLE,
            scale: 4,
            fillColor: meta.stroke,
            fillOpacity: 1,
            strokeColor: "#ffffff",
            strokeWeight: 1.5,
          },
        }),
    );
  }, []);

  // Persist a completed geometry, then draw it as a managed overlay.
  const save = useCallback(
    async (kind: FeatureKind, geojson: GeoJSONGeometry) => {
      setBusy(true);
      setMsg(null);
      const extra = kind === "septic" ? { num_bedrooms: bedroomsRef.current } : undefined;
      const res = await saveFeature(projectId, kind, geojson, extra);
      setBusy(false);
      if (!res.ok || !res.feature) {
        setMsg(res.error ?? "Save failed.");
        return;
      }
      const f = res.feature;
      setFeatures((prev) => [...prev, f]);
      if (gRef.current && mapRef.current) {
        overlaysRef.current.set(f.id, drawFeature(gRef.current, mapRef.current, f));
      }
    },
    [projectId],
  );

  // ---- Parcel dimension labels + frontage edge markers -------------------

  const clearDimLabels = useCallback(() => {
    dimLabelsRef.current.forEach((m) => m.setMap(null));
    dimLabelsRef.current = [];
  }, []);

  const clearEdgeMarkers = useCallback(() => {
    edgeMarkersRef.current.forEach((m) => m.setMap(null));
    edgeMarkersRef.current = [];
  }, []);

  // Render "302 ft" labels at each parcel edge midpoint.
  const drawDimLabels = useCallback(
    (parcelGeojson: GeoJSONGeometry) => {
      const g = gRef.current;
      const map = mapRef.current;
      if (!g || !map || parcelGeojson.type !== "Polygon") return;
      clearDimLabels();
      const ring = (parcelGeojson.coordinates as [number, number][][])[0];
      for (const { mid, ft } of ringEdgesFt(ring)) {
        dimLabelsRef.current.push(
          new g.maps.Marker({
            position: { lat: mid[1], lng: mid[0] },
            map,
            clickable: false,
            // A zero-area transparent icon; the label carries the text.
            icon: { path: "M 0,0 0,0", strokeOpacity: 0, scale: 0 },
            label: {
              text: `${Math.round(ft)} ft`,
              color: "#1b2a44",
              fontSize: "11px",
              fontWeight: "600",
              className: "dim-label",
            },
          }),
        );
      }
    },
    [clearDimLabels],
  );

  // Geocode the study address (Geocoder is in Maps core — no extra library).
  const geocodeAddress = useCallback((): Promise<{ lat: number; lng: number } | null> => {
    const g = gRef.current;
    if (!g || !address) return Promise.resolve(null);
    return new Promise((resolve) => {
      new g.maps.Geocoder().geocode({ address }, (results, status) => {
        if (status === "OK" && results?.[0]) {
          const loc = results[0].geometry.location;
          resolve({ lat: loc.lat(), lng: loc.lng() });
        } else {
          resolve(null);
        }
      });
    });
  }, [address]);

  // "Pull parcel from address": geocode -> CT parcel GIS -> replace overlay.
  const pullParcel = useCallback(async () => {
    const g = gRef.current;
    const map = mapRef.current;
    if (!g || !map) return;
    setBusy(true);
    setMsg(null);
    // Prefer an explicit address; fall back to the current map centre.
    const pt = (await geocodeAddress()) ?? { lat: map.getCenter()!.lat(), lng: map.getCenter()!.lng() };
    const res = await importParcel(projectId, pt);
    setBusy(false);
    if (!res.ok || !res.feature) {
      setMsg(res.error ?? "Could not pull the parcel.");
      return;
    }
    // Remove any prior parcel/envelope overlays + labels; the import replaced them.
    setFeatures((prev) => {
      prev.filter((f) => f.kind === "parcel" || f.kind === "envelope").forEach((f) => removeOverlay(f.id));
      return prev.filter((f) => f.kind !== "parcel" && f.kind !== "envelope");
    });
    clearEdgeMarkers();
    setFrontageMode(false);
    const f = res.feature;
    setFeatures((prev) => [...prev, f]);
    overlaysRef.current.set(f.id, drawFeature(g, map, f));
    drawDimLabels(f.geojson);
    setParcel({
      id: f.id,
      frontage_edge_idx: null,
      zoning_district: null,
      front_setback_ft: null,
      side_setback_ft: null,
      rear_setback_ft: null,
      max_coverage_pct: null,
      area_sf: f.area_sf ?? null,
    });
    setHasEnvelope(false);
    // Frame to the new parcel.
    const bounds = new g.maps.LatLngBounds();
    for (const [lng, lat] of (f.geojson.coordinates as [number, number][][])[0]) bounds.extend({ lat, lng });
    map.fitBounds(bounds);
    setMsg(`Pulled ${res.meta?.town ?? "parcel"} lot — ${fmtSf(f.area_sf)}.${res.meta?.multipart ? " Multi-part lot — kept the largest piece." : ""}`);
  }, [projectId, geocodeAddress, drawDimLabels, clearEdgeMarkers, removeOverlay]);

  const applyEnvelope = useCallback(
    (feature: PlacedFeature) => {
      const g = gRef.current;
      const map = mapRef.current;
      if (!g || !map) return;
      setFeatures((prev) => {
        prev.filter((f) => f.kind === "envelope").forEach((f) => removeOverlay(f.id));
        const next = prev.filter((f) => f.kind !== "envelope");
        return [...next, feature];
      });
      overlaysRef.current.set(feature.id, drawFeature(g, map, feature));
      setHasEnvelope(true);
    },
    [removeOverlay],
  );

  const onPickFrontage = useCallback(
    async (idx: number) => {
      setBusy(true);
      setMsg(null);
      const res = await setFrontageEdge(projectId, idx);
      setBusy(false);
      clearEdgeMarkers();
      setFrontageMode(false);
      setParcel((p) => (p ? { ...p, frontage_edge_idx: idx } : p));
      if (!res.ok || !res.feature) {
        setMsg(res.error ?? "Could not compute the envelope.");
        return;
      }
      applyEnvelope(res.feature);
      setMsg("Building envelope computed.");
    },
    [projectId, clearEdgeMarkers, applyEnvelope],
  );

  // Frontage tagging: numbered clickable markers at each edge midpoint.
  const placeEdgeMarkers = useCallback(() => {
    const g = gRef.current;
    const map = mapRef.current;
    const pf = featuresRef.current.find((f) => f.kind === "parcel");
    if (!g || !map || !pf || pf.geojson.type !== "Polygon") return;
    clearEdgeMarkers();
    const ring = (pf.geojson.coordinates as [number, number][][])[0];
    ringEdgesFt(ring).forEach(({ mid }, idx) => {
      const marker = new g.maps.Marker({
        position: { lat: mid[1], lng: mid[0] },
        map,
        clickable: true,
        icon: { path: g.maps.SymbolPath.CIRCLE, scale: 9, fillColor: "#b08a46", fillOpacity: 1, strokeColor: "#ffffff", strokeWeight: 2 },
        label: { text: `${idx + 1}`, color: "#ffffff", fontSize: "10px", fontWeight: "700" },
        zIndex: 9999,
      });
      marker.addListener("click", () => void onPickFrontage(idx));
      edgeMarkersRef.current.push(marker);
    });
  }, [clearEdgeMarkers, onPickFrontage]);

  const recomputeEnvelope = useCallback(async () => {
    setBusy(true);
    setMsg(null);
    const res = await computeEnvelope(projectId);
    setBusy(false);
    if (!res.ok || !res.feature) {
      setMsg(res.error ?? "Could not compute the envelope.");
      return;
    }
    applyEnvelope(res.feature);
    setMsg("Building envelope updated.");
  }, [projectId, applyEnvelope]);

  // ---- Live distance measuring while placing a well/septic ----------------

  const clearMeasure = useCallback(() => {
    measureLineRef.current?.setMap(null);
    measureLineRef.current = null;
    measureLabelRef.current?.setMap(null);
    measureLabelRef.current = null;
    setLiveMeasure([]);
  }, []);

  const onMapMove = useCallback(
    (latLng: google.maps.LatLng) => {
      const g = gRef.current;
      const map = mapRef.current;
      const tool = activeToolRef.current;
      if (!g || !map) return;
      if (tool !== "well" && tool !== "septic") {
        if (measureLineRef.current) clearMeasure();
        return;
      }
      const cursor: LngLat = [latLng.lng(), latLng.lat()];
      const feats = featuresRef.current;
      const pairKind: FeatureKind = tool === "well" ? "septic" : "well";

      // Nearest existing pair feature (well↔septic, the 75 ft rule).
      let nearestPair: { pt: LngLat; ft: number } | null = null;
      for (const f of feats) {
        if (f.kind === pairKind && f.geojson.type === "Point") {
          const pt = f.geojson.coordinates as LngLat;
          const ft = distFt(cursor, pt);
          if (!nearestPair || ft < nearestPair.ft) nearestPair = { pt, ft };
        }
      }
      // Nearest point on any placed house.
      let nearestHouse: { pt: LngLat; ft: number } | null = null;
      for (const f of feats) {
        if (f.kind === "house" && f.geojson.type === "Polygon") {
          const ring = (f.geojson.coordinates as LngLat[][])[0];
          const c = nearestOnRing(cursor, ring);
          if (c && (!nearestHouse || c.ft < nearestHouse.ft)) nearestHouse = { pt: c.point, ft: c.ft };
        }
      }
      // Nearest point on the property line.
      let nearestPL: { pt: LngLat; ft: number } | null = null;
      const parcelF = feats.find((f) => f.kind === "parcel" && f.geojson.type === "Polygon");
      if (parcelF) {
        const ring = (parcelF.geojson.coordinates as LngLat[][])[0];
        const c = nearestOnRing(cursor, ring);
        if (c) nearestPL = { pt: c.point, ft: c.ft };
      }

      // Primary rubber-band anchor: the house if placed (David's flow), else the
      // pair feature, else the property line.
      const primary = nearestHouse ?? nearestPair ?? nearestPL;
      if (primary) {
        const from = primary.pt;
        // Colour the label by the governing 75 ft pair rule when a pair exists.
        const ok = nearestPair ? nearestPair.ft >= 75 : true;
        const path = [
          { lat: from[1], lng: from[0] },
          { lat: cursor[1], lng: cursor[0] },
        ];
        if (!measureLineRef.current) {
          measureLineRef.current = new g.maps.Polyline({
            map,
            clickable: false,
            strokeColor: "#1b2a44",
            strokeOpacity: 0,
            icons: [{ icon: { path: "M 0,-1 0,1", strokeOpacity: 0.9, scale: 2 }, offset: "0", repeat: "8px" }],
          });
        }
        measureLineRef.current.setPath(path);
        const mid = { lat: (from[1] + cursor[1]) / 2, lng: (from[0] + cursor[0]) / 2 };
        if (!measureLabelRef.current) {
          measureLabelRef.current = new g.maps.Marker({
            map,
            clickable: false,
            icon: { path: "M 0,0 0,0", strokeOpacity: 0, scale: 0 },
          });
        }
        measureLabelRef.current.setPosition(mid);
        measureLabelRef.current.setLabel({
          text: `${Math.round(primary.ft)} ft`,
          color: ok ? "#1b2a44" : "#a11616",
          fontSize: "12px",
          fontWeight: "700",
        });
      }

      const rows: { label: string; ft: number; min?: number }[] = [];
      if (nearestPair) rows.push({ label: `to ${pairKind === "septic" ? "septic tank" : "well"}`, ft: Math.round(nearestPair.ft), min: 75 });
      if (nearestPL) rows.push({ label: "to property line", ft: Math.round(nearestPL.ft), min: 25 });
      if (nearestHouse) rows.push({ label: "to house", ft: Math.round(nearestHouse.ft) });
      setLiveMeasure(rows);
    },
    [clearMeasure],
  );

  // Drop the chosen design's footprint at the clicked point.
  const dropDesign = useCallback(
    async (latLng: google.maps.LatLng) => {
      const g = gRef.current;
      const map = mapRef.current;
      if (!g || !map) return;
      setPlacing(true);
      setMsg(null);
      const res = await placeDesign(
        projectId,
        placeDesignIdRef.current,
        { lat: latLng.lat(), lng: latLng.lng() },
        placeRotationRef.current,
      );
      setPlacing(false);
      if (!res.ok || !res.feature) {
        setMsg(res.error ?? "Could not place the design.");
        return;
      }
      const f = res.feature;
      setFeatures((prev) => [...prev, f]);
      overlaysRef.current.set(f.id, drawFeature(g, map, f));
      setPlaceDesignId(""); // one drop, then exit place mode
    },
    [projectId],
  );

  // A map click: place a point immediately, or add a polygon/line vertex.
  const onMapClick = useCallback(
    (latLng: google.maps.LatLng) => {
      if (placeDesignIdRef.current && !busyRef.current) {
        void dropDesign(latLng);
        return;
      }
      const kind = activeToolRef.current;
      if (!kind || busyRef.current) return;
      const meta = KIND_META[kind];
      if (meta.geom === "Point") {
        setActiveTool(null);
        clearMeasure();
        void save(kind, { type: "Point", coordinates: [latLng.lng(), latLng.lat()] });
        return;
      }
      draftRef.current.points.push(latLng);
      setDraftCount(draftRef.current.points.length);
      redrawDraft(kind);
    },
    [save, redrawDraft, clearMeasure, dropDesign],
  );

  const finishDraft = useCallback(() => {
    const kind = activeToolRef.current;
    if (!kind) return;
    const meta = KIND_META[kind];
    const pts = draftRef.current.points;
    if (meta.geom === "Polygon") {
      if (pts.length < 3) return;
      const ring = pts.map((p) => [p.lng(), p.lat()]);
      ring.push(ring[0]);
      void save(kind, { type: "Polygon", coordinates: [ring] });
    } else {
      if (pts.length < 2) return;
      void save(kind, { type: "LineString", coordinates: pts.map((p) => [p.lng(), p.lat()]) });
    }
    clearDraft();
    setActiveTool(null);
  }, [save, clearDraft]);

  // Init map once.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const g = await loadGoogleMaps();
        if (cancelled || !mapDivRef.current) return;
        gRef.current = g;
        const map = new g.maps.Map(mapDivRef.current, {
          center: center ?? CT_DEFAULT,
          zoom: center ? 19 : 12,
          mapTypeId: "hybrid",
          tilt: 0,
          disableDoubleClickZoom: true,
          streetViewControl: false,
          fullscreenControl: true,
          mapTypeControl: true,
        });
        mapRef.current = map;

        map.addListener("click", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) onMapClick(e.latLng);
        });
        // Double-click finishes an in-progress polygon/line.
        map.addListener("dblclick", () => finishDraft());
        // Live distance readout while placing a well/septic.
        map.addListener("mousemove", (e: google.maps.MapMouseEvent) => {
          if (e.latLng) onMapMove(e.latLng);
        });

        // Draw existing features + frame to the parcel if present.
        const bounds = new g.maps.LatLngBounds();
        let hasBounds = false;
        for (const f of initialFeatures) {
          overlaysRef.current.set(f.id, drawFeature(g, map, f));
          if (f.kind === "parcel") drawDimLabels(f.geojson);
          if (f.kind === "parcel" && f.geojson.type === "Polygon") {
            for (const [lng, lat] of (f.geojson.coordinates as [number, number][][])[0]) {
              bounds.extend({ lat, lng });
              hasBounds = true;
            }
          }
        }
        if (hasBounds) map.fitBounds(bounds);

        setReady(true);
      } catch (err) {
        setMsg(err instanceof Error ? err.message : "Map failed to load.");
      }
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Show numbered edge markers while tagging the street-front edge.
  useEffect(() => {
    if (frontageMode) placeEdgeMarkers();
    else clearEdgeMarkers();
  }, [frontageMode, placeEdgeMarkers, clearEdgeMarkers]);

  function pickTool(kind: FeatureKind) {
    clearDraft();
    clearMeasure();
    setMsg(null);
    setActiveTool((cur) => (cur === kind ? null : kind));
  }

  function toggleOverlay(id: OverlayId) {
    const g = gRef.current;
    const map = mapRef.current;
    if (!g || !map) return;
    setOverlays((prev) => {
      const next = new Set(prev);
      if (next.has(id)) {
        next.delete(id);
        const imt = overlayRefs.current[id];
        if (imt) {
          const i = map.overlayMapTypes.getArray().indexOf(imt);
          if (i >= 0) map.overlayMapTypes.removeAt(i);
          delete overlayRefs.current[id];
        }
      } else {
        next.add(id);
        const def = OVERLAYS.find((o) => o.id === id)!;
        const imt = new g.maps.ImageMapType({
          name: def.label,
          tileSize: new g.maps.Size(256, 256),
          opacity: 0.55,
          getTileUrl: (c, z) => def.getTileUrl(c.x, c.y, z),
        });
        overlayRefs.current[id] = imt;
        map.overlayMapTypes.push(imt);
      }
      return next;
    });
  }

  async function onDelete(f: PlacedFeature) {
    setBusy(true);
    const res = await deleteFeature(projectId, f.kind, f.id);
    setBusy(false);
    if (!res.ok) {
      setMsg(res.error ?? "Delete failed.");
      return;
    }
    removeOverlay(f.id);
    setFeatures((prev) => prev.filter((x) => x.id !== f.id));
  }

  async function onRun() {
    setBusy(true);
    setMsg(null);
    const res = await runFeasibility(projectId);
    setBusy(false);
    setValidations(res.rows);
    setSkipped(res.skipped);
  }

  const verdict = verdictOf(validations.map((v) => v.status));
  const counts = TOOL_ORDER.reduce<Record<string, number>>((acc, k) => {
    acc[k] = features.filter((f) => f.kind === k).length;
    return acc;
  }, {});
  const activeGeom = activeTool ? KIND_META[activeTool].geom : null;
  const isVertexTool = activeGeom === "Polygon" || activeGeom === "LineString";
  const canFinish = isVertexTool && draftCount >= (activeGeom === "Polygon" ? 3 : 2);

  return (
    <div className="grid gap-4 lg:grid-cols-[1fr_360px]">
      {/* Map + toolbar */}
      <div className="overflow-hidden rounded-lg border border-line bg-white">
        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-parchment/60 px-3 py-2">
          <button
            onClick={() => void pullParcel()}
            disabled={!ready || busy}
            title={address ? `Pull the real lot for ${address}` : "Pull the real lot at the map centre"}
            className="rounded-md border border-ink bg-ink px-3 py-1.5 text-sm font-medium text-parchment transition hover:bg-ink-soft disabled:opacity-50"
          >
            {parcel ? "Re-pull parcel" : "Pull parcel from address"}
          </button>
          <span className="mx-1 h-5 w-px bg-line" aria-hidden />
          {TOOL_ORDER.map((kind) => (
            <button
              key={kind}
              onClick={() => pickTool(kind)}
              disabled={!ready || busy}
              className={`rounded-md border px-3 py-1.5 text-sm transition disabled:opacity-50 ${
                activeTool === kind
                  ? "border-gold bg-gold text-white"
                  : "border-line bg-white text-ink hover:border-gold"
              }`}
            >
              <span
                className="mr-1.5 inline-block h-2.5 w-2.5 rounded-full align-middle"
                style={{ background: KIND_META[kind].stroke }}
              />
              {KIND_META[kind].label}
              {counts[kind] ? <span className="ml-1 text-xs opacity-70">·{counts[kind]}</span> : null}
            </button>
          ))}
          {activeTool === "septic" ? (
            <label className="ml-2 flex items-center gap-1 text-xs text-muted">
              Bedrooms
              <input
                type="number"
                min={1}
                max={8}
                value={bedrooms}
                onChange={(e) => setBedrooms(Number(e.target.value))}
                className="w-14 rounded border border-line px-1.5 py-0.5 text-sm text-ink"
              />
            </label>
          ) : null}

          {isVertexTool ? (
            <div className="ml-auto flex items-center gap-2">
              <button
                onClick={finishDraft}
                disabled={!canFinish}
                className="rounded-md bg-ink px-3 py-1.5 text-sm font-medium text-parchment transition hover:bg-ink-soft disabled:opacity-40"
              >
                Finish {activeGeom === "Polygon" ? "shape" : "line"}
              </button>
              <button
                onClick={() => {
                  clearDraft();
                  setActiveTool(null);
                }}
                className="text-sm text-muted transition hover:text-ink"
              >
                Cancel
              </button>
            </div>
          ) : activeTool ? (
            <span className="ml-auto text-xs text-gold-deep">
              Click the map to place the {KIND_META[activeTool].label.toLowerCase()}.
            </span>
          ) : null}
        </div>

        {isVertexTool ? (
          <div className="border-b border-line bg-gold/5 px-3 py-1.5 text-xs text-gold-deep">
            Click to drop each corner{activeGeom === "Polygon" ? " of the shape" : " of the line"}; double-click or{" "}
            <span className="font-medium">Finish</span> to complete.
            {draftCount ? ` (${draftCount} point${draftCount === 1 ? "" : "s"})` : ""}
          </div>
        ) : null}

        <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-3 py-1.5 text-xs">
          <span className="text-muted">Overlays</span>
          {OVERLAYS.map((o) => {
            const on = overlays.has(o.id);
            return (
              <button
                key={o.id}
                onClick={() => toggleOverlay(o.id)}
                disabled={!ready}
                className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-0.5 transition disabled:opacity-50 ${
                  on ? "border-transparent bg-ink text-parchment" : "border-line bg-white text-ink hover:border-gold"
                }`}
              >
                <span className="inline-block h-2 w-2 rounded-full" style={{ background: on ? "#ffffff" : o.color }} />
                {o.label}
              </button>
            );
          })}
          {overlays.size > 0 ? (
            <span className="ml-auto text-muted/80">
              {OVERLAYS.filter((o) => overlays.has(o.id)).map((o) => o.attribution).join(" · ")} — advisory
            </span>
          ) : null}
        </div>

        {designs.length > 0 ? (
          <div className="flex flex-wrap items-center gap-2 border-b border-line bg-white px-3 py-1.5 text-xs">
            <span className="text-muted">Place design</span>
            <select
              value={placeDesignId}
              onChange={(e) => {
                setPlaceDesignId(e.target.value);
                if (e.target.value) {
                  setActiveTool(null);
                  clearDraft();
                  clearMeasure();
                }
              }}
              disabled={!ready}
              className="rounded border border-line bg-white px-2 py-0.5 text-ink disabled:opacity-50"
            >
              <option value="">Choose a design…</option>
              {designs.map((d) => (
                <option key={d.id} value={d.id}>{d.name}</option>
              ))}
            </select>
            {placeDesignId ? (
              <>
                <label className="flex items-center gap-1 text-muted">
                  Rotate
                  <input
                    type="number"
                    value={placeRotation}
                    onChange={(e) => setPlaceRotation(Number(e.target.value))}
                    className="w-14 rounded border border-line px-1 py-0.5 text-ink"
                  />
                  °
                </label>
                <span className="text-gold-deep">{placing ? "Placing…" : "Click the map to drop it."}</span>
                <button onClick={() => setPlaceDesignId("")} className="text-muted transition hover:text-ink">
                  Cancel
                </button>
              </>
            ) : (
              <span className="text-muted/70">Drops the design&rsquo;s footprint at your click.</span>
            )}
          </div>
        ) : null}

        {activeTool === "well" || activeTool === "septic" ? (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 border-b border-line bg-gold/5 px-3 py-1.5 text-xs">
            <span className="text-gold-deep">
              Move over the map to measure; click to place the {KIND_META[activeTool].label.toLowerCase()}.
            </span>
            {liveMeasure.map((m) => (
              <span key={m.label} className={m.min != null && m.ft < m.min ? "font-semibold text-fail" : "text-ink"}>
                {m.label}: <span className="num">{m.ft} ft</span>
                {m.min != null ? <span className="text-muted"> (min {m.min})</span> : null}
              </span>
            ))}
          </div>
        ) : null}

        <div ref={mapDivRef} className="h-[62vh] w-full bg-linen" />
        {msg ? (
          <div className="border-t border-line bg-fail/5 px-3 py-2 text-sm text-fail">{msg}</div>
        ) : null}
      </div>

      {/* Sidebar */}
      <aside className="flex flex-col gap-4">
        <VerdictCard verdict={verdict} onRun={onRun} busy={busy} ready={ready} />

        <section className="rounded-lg border border-line bg-white p-4">
          <h3 className="font-display text-lg text-ink">Site setup</h3>

          {/* 1 — Parcel */}
          <div className="mt-3 flex items-start justify-between gap-2">
            <div>
              <p className="text-sm text-ink">Parcel</p>
              <p className="text-xs text-muted">
                {parcel ? fmtSf(parcel.area_sf) : "Not pulled — use “Pull parcel from address”."}
              </p>
            </div>
            {parcel ? <span className="shrink-0 rounded bg-pass/10 px-2 py-0.5 text-xs font-medium text-pass">Set</span> : null}
          </div>

          {/* 2 — Setbacks (populated by the zoning step; editable there) */}
          <div className="mt-3 border-t border-line/60 pt-3">
            <p className="text-sm text-ink">Setbacks</p>
            {parcel && (parcel.front_setback_ft != null || parcel.side_setback_ft != null || parcel.rear_setback_ft != null) ? (
              <p className="text-xs text-muted">
                Front {fmtFt(parcel.front_setback_ft)} · Side {fmtFt(parcel.side_setback_ft)} · Rear {fmtFt(parcel.rear_setback_ft)}
                {parcel.zoning_district ? ` · ${parcel.zoning_district}` : ""}
              </p>
            ) : (
              <p className="text-xs text-muted">Not set — add zoning in the “Zoning &amp; setbacks” card.</p>
            )}
          </div>

          {/* 3 — Building envelope */}
          <div className="mt-3 border-t border-line/60 pt-3">
            <div className="flex items-center justify-between gap-2">
              <p className="text-sm text-ink">Building envelope</p>
              {hasEnvelope ? <span className="shrink-0 rounded bg-pass/10 px-2 py-0.5 text-xs font-medium text-pass">Drawn</span> : null}
            </div>
            {!parcel ? (
              <p className="mt-1 text-xs text-muted">Pull the parcel first.</p>
            ) : parcel.front_setback_ft == null && parcel.side_setback_ft == null && parcel.rear_setback_ft == null ? (
              <p className="mt-1 text-xs text-muted">Set the zoning setbacks first — the envelope is built from them.</p>
            ) : frontageMode ? (
              <div className="mt-2 flex items-center gap-2">
                <span className="text-xs text-gold-deep">Click the numbered edge on the map that fronts the street.</span>
                <button onClick={() => setFrontageMode(false)} className="text-xs text-muted hover:text-ink">
                  Cancel
                </button>
              </div>
            ) : (
              <div className="mt-2 flex flex-wrap items-center gap-2">
                <button
                  onClick={() => setFrontageMode(true)}
                  disabled={busy}
                  className="rounded-md border border-gold bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold-deep transition hover:bg-gold/20 disabled:opacity-50"
                >
                  {parcel.frontage_edge_idx != null ? "Re-tag street edge" : "Tag street edge"}
                </button>
                <button
                  onClick={() => void recomputeEnvelope()}
                  disabled={busy}
                  className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition hover:border-gold disabled:opacity-50"
                  title="Recompute from the current setbacks (uniform inset if no street edge is tagged)"
                >
                  {hasEnvelope ? "Recompute" : "Compute (uniform)"}
                </button>
              </div>
            )}
          </div>
        </section>

        {parcel ? (
          <ZoningCard
            projectId={projectId}
            parcel={parcel}
            busy={busy}
            onSaved={(z) => {
              setParcel((p) =>
                p
                  ? {
                      ...p,
                      zoning_district: z.zoning_district ?? null,
                      front_setback_ft: z.front_setback_ft ?? null,
                      side_setback_ft: z.side_setback_ft ?? null,
                      rear_setback_ft: z.rear_setback_ft ?? null,
                      max_coverage_pct: z.max_coverage_pct ?? null,
                    }
                  : p,
              );
              setMsg("Zoning setbacks saved. Tag the street edge to draw the envelope.");
            }}
          />
        ) : null}

        <FloodCard projectId={projectId} />
        <WetlandsCard projectId={projectId} />
        <ElevationCard projectId={projectId} />

        <section className="rounded-lg border border-line bg-white p-4">
          <h3 className="font-display text-lg text-ink">Setback checks</h3>
          {validations.length === 0 ? (
            <p className="mt-2 text-sm text-muted">
              Place a well, septic, and property line, then run the check.
            </p>
          ) : (
            <ul className="mt-3 space-y-2">
              {validations.map((v) => (
                <li key={v.rule_key} className="flex items-start justify-between gap-2 border-b border-line/60 pb-2 last:border-0">
                  <div>
                    <p className="text-sm text-ink">{ruleLabel(v.rule_key)}</p>
                    <p className="text-xs text-muted">{v.message}</p>
                  </div>
                  <StatusPill status={v.status} />
                </li>
              ))}
            </ul>
          )}
          {skipped.length > 0 ? (
            <p className="mt-3 text-xs text-muted">
              Not evaluated (missing features): {skipped.map(ruleLabel).join(", ")}.
            </p>
          ) : null}
          <details className="mt-3">
            <summary className="cursor-pointer text-xs text-muted">Which rules run?</summary>
            <ul className="mt-1 space-y-0.5 text-xs text-muted">
              {RULES.map((r) => (
                <li key={r.rule_key}>· {r.label}</li>
              ))}
            </ul>
            <p className="mt-1 text-xs italic text-muted/80">
              Distances come from the shared CT default set — verify against the
              governing health code / zoning per jurisdiction.
            </p>
          </details>
        </section>

        <section className="rounded-lg border border-line bg-white p-4">
          <h3 className="font-display text-lg text-ink">Placed on site</h3>
          {features.length === 0 ? (
            <p className="mt-2 text-sm text-muted">Nothing placed yet.</p>
          ) : (
            <ul className="mt-3 space-y-1.5">
              {features.map((f) => (
                <li key={f.id} className="flex items-center justify-between gap-2 text-sm">
                  <span className="flex items-center gap-2">
                    <span className="inline-block h-2.5 w-2.5 rounded-full" style={{ background: KIND_META[f.kind].stroke }} />
                    <span className="text-ink">{KIND_META[f.kind].label}</span>
                    <span className="num text-xs text-muted">{metric(f)}</span>
                  </span>
                  {f.kind === "envelope" ? (
                    <span className="text-xs italic text-muted/70">computed</span>
                  ) : (
                    <button
                      onClick={() => onDelete(f)}
                      disabled={busy}
                      className="text-xs text-muted transition hover:text-fail disabled:opacity-50"
                    >
                      Remove
                    </button>
                  )}
                </li>
              ))}
            </ul>
          )}
        </section>
      </aside>
    </div>
  );
}

function metric(f: PlacedFeature): string {
  if (f.kind === "parcel") return fmtSf(f.area_sf);
  if (f.kind === "leachfield") return fmtSf(f.area_sf);
  if (f.kind === "envelope") return fmtSf(f.area_sf);
  if (f.kind === "road") return fmtFt(f.length_ft);
  if (f.kind === "septic" && f.num_bedrooms) return `${f.num_bedrooms} br`;
  return "";
}

function numOrNull(s: string): number | null {
  const n = parseFloat(s);
  return s.trim() === "" || Number.isNaN(n) ? null : n;
}

function ZoningCard({
  projectId,
  parcel,
  busy,
  onSaved,
}: {
  projectId: string;
  parcel: ParcelInfo;
  busy: boolean;
  onSaved: (z: ZoningInput) => void;
}) {
  const [district, setDistrict] = useState(parcel.zoning_district ?? "");
  const [front, setFront] = useState(parcel.front_setback_ft?.toString() ?? "");
  const [side, setSide] = useState(parcel.side_setback_ft?.toString() ?? "");
  const [rear, setRear] = useState(parcel.rear_setback_ft?.toString() ?? "");
  const [coverage, setCoverage] = useState(parcel.max_coverage_pct?.toString() ?? "");
  const [saving, setSaving] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [aiBusy, setAiBusy] = useState<"pdf" | "search" | null>(null);
  const [aiNote, setAiNote] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  function applyProposal(p: {
    zoning_district: string | null;
    front_setback_ft: number | null;
    side_setback_ft: number | null;
    rear_setback_ft: number | null;
    max_coverage_pct: number | null;
    citation: string | null;
    confidence: string | null;
    source_url: string | null;
    notes: string | null;
  }) {
    if (p.zoning_district) setDistrict(p.zoning_district);
    if (p.front_setback_ft != null) setFront(String(p.front_setback_ft));
    if (p.side_setback_ft != null) setSide(String(p.side_setback_ft));
    if (p.rear_setback_ft != null) setRear(String(p.rear_setback_ft));
    if (p.max_coverage_pct != null) setCoverage(String(p.max_coverage_pct));
    const bits = [
      p.confidence ? `${p.confidence} confidence` : null,
      p.citation ?? null,
      p.notes ?? null,
    ].filter(Boolean);
    setAiNote(`Proposed — review before confirming.${bits.length ? " " + bits.join(" · ") : ""}`);
  }

  async function onSearch() {
    setAiBusy("search");
    setErr(null);
    setAiNote(null);
    const res = await proposeZoningFromSearch(projectId);
    setAiBusy(null);
    if (!res.ok || !res.proposal) {
      setErr(res.error ?? "Search failed.");
      return;
    }
    applyProposal(res.proposal);
  }

  async function onPdf(file: File) {
    // Guard the Server Action body cap (16 MB; base64 is ~1.33× the raw file)
    // and runaway token cost — nudge toward the relevant pages, not the whole code.
    if (file.size > 11 * 1024 * 1024) {
      setErr(`That PDF is ${(file.size / 1024 / 1024).toFixed(1)} MB — too large. Upload just the dimensional-standards / setback pages.`);
      return;
    }
    setAiBusy("pdf");
    setErr(null);
    setAiNote(null);
    try {
      const b64 = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
        r.onerror = () => reject(new Error("Could not read the file."));
        r.readAsDataURL(file);
      });
      const res = await proposeZoningFromPdf(projectId, b64);
      setAiBusy(null);
      if (!res.ok || !res.proposal) {
        setErr(res.error ?? "Could not read that PDF.");
        return;
      }
      applyProposal(res.proposal);
    } catch (e) {
      setAiBusy(null);
      setErr(e instanceof Error ? e.message : "Upload failed.");
    }
  }

  async function confirm() {
    setSaving(true);
    setErr(null);
    const z: ZoningInput = {
      zoning_district: district.trim() || null,
      front_setback_ft: numOrNull(front),
      side_setback_ft: numOrNull(side),
      rear_setback_ft: numOrNull(rear),
      max_coverage_pct: numOrNull(coverage),
    };
    const res = await saveZoning(projectId, z);
    setSaving(false);
    if (!res.ok) {
      setErr(res.error ?? "Could not save.");
      return;
    }
    onSaved(z);
  }

  const field = (label: string, val: string, set: (v: string) => void, unit: string) => (
    <label className="flex flex-col gap-1 text-xs text-muted">
      {label}
      <span className="flex items-center gap-1">
        <input
          type="number"
          value={val}
          onChange={(e) => set(e.target.value)}
          className="w-20 rounded border border-line px-1.5 py-1 text-sm text-ink"
        />
        <span>{unit}</span>
      </span>
    </label>
  );

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h3 className="font-display text-lg text-ink">Zoning &amp; setbacks</h3>
      <p className="mt-1 text-xs text-muted">
        Upload the town regs or search for a draft, or type the values in — then confirm. These drive the building envelope.
      </p>

      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void onPdf(f);
            e.target.value = "";
          }}
        />
        <button
          onClick={() => fileRef.current?.click()}
          disabled={aiBusy !== null || saving}
          className="rounded-md border border-gold bg-gold/10 px-2.5 py-1 text-xs font-medium text-gold-deep transition hover:bg-gold/20 disabled:opacity-50"
        >
          {aiBusy === "pdf" ? "Reading PDF…" : "Upload regs PDF"}
        </button>
        <button
          onClick={() => void onSearch()}
          disabled={aiBusy !== null || saving}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition hover:border-gold disabled:opacity-50"
        >
          {aiBusy === "search" ? "Searching…" : "Search online"}
        </button>
      </div>
      {aiNote ? <p className="mt-2 text-xs text-gold-deep">{aiNote}</p> : null}

      <label className="mt-3 flex flex-col gap-1 text-xs text-muted">
        Zoning district
        <input
          type="text"
          value={district}
          onChange={(e) => setDistrict(e.target.value)}
          placeholder="e.g. R-2"
          className="rounded border border-line px-2 py-1 text-sm text-ink"
        />
      </label>

      <div className="mt-3 flex flex-wrap gap-3">
        {field("Front", front, setFront, "ft")}
        {field("Side", side, setSide, "ft")}
        {field("Rear", rear, setRear, "ft")}
        {field("Max coverage", coverage, setCoverage, "%")}
      </div>

      {err ? <p className="mt-2 text-xs text-fail">{err}</p> : null}

      <button
        onClick={() => void confirm()}
        disabled={saving || busy}
        className="mt-3 w-full rounded-md bg-ink px-4 py-2 text-sm font-medium text-parchment transition hover:bg-ink-soft disabled:opacity-50"
      >
        {saving ? "Saving…" : "Confirm setbacks"}
      </button>
    </section>
  );
}

function FloodCard({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<FloodReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    const res = await checkFlood(projectId);
    setBusy(false);
    if (!res.ok || !res.report) {
      setErr(res.error ?? "Flood lookup failed.");
      return;
    }
    setReport(res.report);
  }

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg text-ink">Flood zone</h3>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition hover:border-gold disabled:opacity-50"
        >
          {busy ? "Checking…" : report ? "Re-check" : "Check flood zone"}
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-fail">{err}</p> : null}
      {report ? (
        <div className="mt-3 space-y-1.5 text-sm">
          <div className="flex items-center gap-2">
            <span className="font-medium text-ink">Zone {report.zone ?? "—"}</span>
            <span
              className={`rounded px-2 py-0.5 text-xs font-medium ${
                report.sfha ? "bg-fail/10 text-fail" : "bg-pass/10 text-pass"
              }`}
            >
              SFHA: {report.sfha == null ? "—" : report.sfha ? "In" : "Out"}
            </span>
          </div>
          <p className="text-xs text-muted">{report.description}</p>
          {report.staticBfe != null ? (
            <p className="text-xs text-muted">Base flood elevation: {report.staticBfe} ft</p>
          ) : null}
          <p className="text-xs text-muted">
            {report.panel ? `Panel ${report.panel}` : "Panel —"}
            {report.panelDate ? ` · eff. ${report.panelDate}` : ""}
          </p>
          <p className="mt-1 text-xs italic text-muted/80">
            FEMA NFHL — advisory only, not for regulatory use.
          </p>
        </div>
      ) : !err ? (
        <p className="mt-2 text-xs text-muted">Check the FEMA flood zone for this site.</p>
      ) : null}
    </section>
  );
}

function ElevationCard({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<ElevationReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    const res = await checkElevation(projectId);
    setBusy(false);
    if (!res.ok || !res.report) {
      setErr(res.error ?? "Elevation lookup failed.");
      return;
    }
    setReport(res.report);
  }

  const featLabel: Record<string, string> = { well: "Well", septic: "Septic tank", house: "House" };

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg text-ink">Elevation &amp; slope</h3>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition hover:border-gold disabled:opacity-50"
        >
          {busy ? "Sampling…" : report ? "Re-check" : "Check elevation"}
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-fail">{err}</p> : null}
      {report ? (
        <div className="mt-3 space-y-2 text-sm">
          {report.site ? (
            <div>
              <p className="text-ink">
                Site relief <span className="font-medium">{report.site.reliefFt} ft</span>
              </p>
              <p className="text-xs text-muted">
                Low {report.site.lowFt} ft · High {report.site.highFt} ft
                {report.site.centroidFt != null ? ` · Center ${report.site.centroidFt} ft` : ""}
              </p>
            </div>
          ) : null}
          {report.features.length > 0 ? (
            <ul className="space-y-0.5 border-t border-line/60 pt-2">
              {report.features.map((f, i) => (
                <li key={`${f.kind}-${i}`} className="flex justify-between text-xs">
                  <span className="text-ink">{f.label || featLabel[f.kind] || f.kind}</span>
                  <span className="num text-muted">{f.elevFt != null ? `${f.elevFt} ft` : "—"}</span>
                </li>
              ))}
            </ul>
          ) : null}
          <p className="text-xs italic text-muted/80">USGS 3DEP — LiDAR-derived, advisory (not a survey).</p>
        </div>
      ) : !err ? (
        <p className="mt-2 text-xs text-muted">Ground elevation at each feature + the site&rsquo;s high/low relief.</p>
      ) : null}
    </section>
  );
}

function WetlandsCard({ projectId }: { projectId: string }) {
  const [report, setReport] = useState<WetlandsReport | null>(null);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  async function run() {
    setBusy(true);
    setErr(null);
    const res = await checkWetlands(projectId);
    setBusy(false);
    if (!res.ok || !res.report) {
      setErr(res.error ?? "Wetlands lookup failed.");
      return;
    }
    setReport(res.report);
  }

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-display text-lg text-ink">Wetlands</h3>
        <button
          onClick={() => void run()}
          disabled={busy}
          className="rounded-md border border-line px-2.5 py-1 text-xs text-ink transition hover:border-gold disabled:opacity-50"
        >
          {busy ? "Checking…" : report ? "Re-check" : "Check wetlands"}
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-fail">{err}</p> : null}
      {report ? (
        report.present ? (
          <div className="mt-3 space-y-1.5 text-sm">
            <span className="inline-block rounded bg-warn/10 px-2 py-0.5 text-xs font-medium text-warn">
              {report.count} mapped on/overlapping the parcel
            </span>
            <ul className="mt-1 space-y-1">
              {report.groups.map((g) => (
                <li key={g.type} className="text-xs text-muted">
                  <span className="text-ink">{g.type}</span> — {g.acres} ac{" "}
                  <span className="opacity-70">({g.codes.join(", ")})</span>
                </li>
              ))}
            </ul>
            <p className="mt-1 text-xs italic text-muted/80">
              USFWS NWI — advisory first-pass; a wetland delineation / town IWWC soils govern.
            </p>
          </div>
        ) : (
          <div className="mt-3 text-sm">
            <span className="inline-block rounded bg-pass/10 px-2 py-0.5 text-xs font-medium text-pass">
              None mapped on the parcel
            </span>
            <p className="mt-1 text-xs italic text-muted/80">
              USFWS NWI — no mapped wetlands overlap the lot; not a substitute for a delineation.
            </p>
          </div>
        )
      ) : !err ? (
        <p className="mt-2 text-xs text-muted">Screen the lot against USFWS mapped wetlands.</p>
      ) : null}
    </section>
  );
}

function StatusPill({ status }: { status: ValidationRow["status"] }) {
  const map = {
    pass: { c: "bg-pass/10 text-pass", t: "Pass" },
    warn: { c: "bg-warn/10 text-warn", t: "Tight" },
    fail: { c: "bg-fail/10 text-fail", t: "Fail" },
  } as const;
  const s = map[status];
  return <span className={`shrink-0 rounded px-2 py-0.5 text-xs font-medium ${s.c}`}>{s.t}</span>;
}

function VerdictCard({
  verdict,
  onRun,
  busy,
  ready,
}: {
  verdict: "feasible" | "not_feasible" | "incomplete";
  onRun: () => void;
  busy: boolean;
  ready: boolean;
}) {
  const styles = {
    feasible: { border: "border-pass/40", bg: "bg-pass/5", text: "text-pass", label: "Feasible" },
    not_feasible: { border: "border-fail/40", bg: "bg-fail/5", text: "text-fail", label: "Not feasible" },
    incomplete: { border: "border-line", bg: "bg-parchment/40", text: "text-muted", label: "Not yet checked" },
  }[verdict];
  return (
    <section className={`rounded-lg border ${styles.border} ${styles.bg} p-4`}>
      <p className="text-xs uppercase tracking-wide text-muted">Verdict</p>
      <p className={`font-display text-2xl ${styles.text}`}>{styles.label}</p>
      <button
        onClick={onRun}
        disabled={!ready || busy}
        className="mt-3 w-full rounded-md bg-ink px-4 py-2 text-sm font-medium text-parchment transition hover:bg-ink-soft disabled:opacity-50"
      >
        {busy ? "Checking…" : "Run feasibility check"}
      </button>
    </section>
  );
}
