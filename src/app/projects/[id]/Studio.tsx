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
  type FeatureKind,
  type PlacedFeature,
  type GeoJSONGeometry,
  type ValidationRow,
} from "@/lib/geo";
import { saveFeature, deleteFeature, runFeasibility } from "./actions";

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
  center,
  initialFeatures,
  initialValidations,
}: {
  projectId: string;
  center: { lat: number; lng: number } | null;
  initialFeatures: PlacedFeature[];
  initialValidations: ValidationRow[];
}) {
  const mapDivRef = useRef<HTMLDivElement>(null);
  const gRef = useRef<typeof google | null>(null);
  const mapRef = useRef<google.maps.Map | null>(null);
  const overlaysRef = useRef<Map<string, google.maps.MVCObject>>(new Map());
  const draftRef = useRef<Draft>({ points: [], line: null, poly: null, markers: [] });

  const [ready, setReady] = useState(false);
  const [features, setFeatures] = useState<PlacedFeature[]>(initialFeatures);
  const [validations, setValidations] = useState<ValidationRow[]>(initialValidations);
  const [activeTool, setActiveTool] = useState<FeatureKind | null>(null);
  const [draftCount, setDraftCount] = useState(0);
  const [bedrooms, setBedrooms] = useState(3);
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState<string | null>(null);
  const [skipped, setSkipped] = useState<string[]>([]);

  const activeToolRef = useRef<FeatureKind | null>(null);
  const bedroomsRef = useRef(3);
  const busyRef = useRef(false);
  activeToolRef.current = activeTool;
  bedroomsRef.current = bedrooms;
  busyRef.current = busy;

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

  // A map click: place a point immediately, or add a polygon/line vertex.
  const onMapClick = useCallback(
    (latLng: google.maps.LatLng) => {
      const kind = activeToolRef.current;
      if (!kind || busyRef.current) return;
      const meta = KIND_META[kind];
      if (meta.geom === "Point") {
        setActiveTool(null);
        void save(kind, { type: "Point", coordinates: [latLng.lng(), latLng.lat()] });
        return;
      }
      draftRef.current.points.push(latLng);
      setDraftCount(draftRef.current.points.length);
      redrawDraft(kind);
    },
    [save, redrawDraft],
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

        // Draw existing features + frame to the parcel if present.
        const bounds = new g.maps.LatLngBounds();
        let hasBounds = false;
        for (const f of initialFeatures) {
          overlaysRef.current.set(f.id, drawFeature(g, map, f));
          if (f.geojson.type === "Polygon") {
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

  function pickTool(kind: FeatureKind) {
    clearDraft();
    setMsg(null);
    setActiveTool((cur) => (cur === kind ? null : kind));
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

        <div ref={mapDivRef} className="h-[62vh] w-full bg-linen" />
        {msg ? (
          <div className="border-t border-line bg-fail/5 px-3 py-2 text-sm text-fail">{msg}</div>
        ) : null}
      </div>

      {/* Sidebar */}
      <aside className="flex flex-col gap-4">
        <VerdictCard verdict={verdict} onRun={onRun} busy={busy} ready={ready} />

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
                  <button
                    onClick={() => onDelete(f)}
                    disabled={busy}
                    className="text-xs text-muted transition hover:text-fail disabled:opacity-50"
                  >
                    Remove
                  </button>
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
  if (f.kind === "road") return fmtFt(f.length_ft);
  if (f.kind === "septic" && f.num_bedrooms) return `${f.num_bedrooms} br`;
  return "";
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
