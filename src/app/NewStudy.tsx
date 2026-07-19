"use client";

import { useState, useRef } from "react";
import { createProject } from "./actions";
import { loadGoogleMaps } from "@/lib/google-maps";

/**
 * New-study form. The address is geocoded in the browser (Maps JS Geocoder,
 * same referrer-restricted key the map uses) so the study opens framed on the
 * site. Geocoding is optional — you can create without it and place the parcel
 * by eye.
 */
export default function NewStudy() {
  const [open, setOpen] = useState(false);
  const [address, setAddress] = useState("");
  const [resolved, setResolved] = useState<{ lat: number; lng: number; formatted: string } | null>(null);
  const [locating, setLocating] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const nameRef = useRef<HTMLInputElement>(null);

  async function locate() {
    if (!address.trim()) return;
    setLocating(true);
    setErr(null);
    try {
      const g = await loadGoogleMaps();
      const geocoder = new g.maps.Geocoder();
      const { results } = await geocoder.geocode({ address });
      const best = results[0];
      if (!best) {
        setErr("Couldn't find that address.");
        setResolved(null);
      } else {
        const loc = best.geometry.location;
        setResolved({ lat: loc.lat(), lng: loc.lng(), formatted: best.formatted_address });
        if (nameRef.current && !nameRef.current.value) {
          nameRef.current.value = best.formatted_address.split(",")[0];
        }
      }
    } catch {
      setErr("Geocoding failed — check the Maps key / referrer settings.");
    } finally {
      setLocating(false);
    }
  }

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-parchment transition hover:bg-ink-soft"
      >
        New study
      </button>
    );
  }

  return (
    <form
      action={createProject}
      className="w-full rounded-lg border border-line bg-parchment/60 p-5"
    >
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
            Study name
          </span>
          <input
            ref={nameRef}
            name="name"
            required
            placeholder="e.g. 12 Powder Mill Rd — lot split"
            className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-gold"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">
            Site address
          </span>
          <div className="flex gap-2">
            <input
              name="address"
              value={address}
              onChange={(e) => {
                setAddress(e.target.value);
                setResolved(null);
              }}
              placeholder="123 Main St, Canton, CT"
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-gold"
            />
            <button
              type="button"
              onClick={locate}
              disabled={locating || !address.trim()}
              className="whitespace-nowrap rounded-md border border-line bg-white px-3 py-2 text-sm text-ink transition hover:bg-linen disabled:opacity-50"
            >
              {locating ? "Locating…" : "Locate"}
            </button>
          </div>
        </label>
      </div>

      <input type="hidden" name="center_lat" value={resolved?.lat ?? ""} />
      <input type="hidden" name="center_lng" value={resolved?.lng ?? ""} />

      {resolved ? (
        <p className="mt-3 text-xs text-pass">
          Located: {resolved.formatted} ({resolved.lat.toFixed(5)}, {resolved.lng.toFixed(5)})
        </p>
      ) : null}
      {err ? <p className="mt-3 text-xs text-fail">{err}</p> : null}

      <div className="mt-4 flex items-center gap-3">
        <button
          type="submit"
          className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-parchment transition hover:bg-ink-soft"
        >
          Create &amp; open studio
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="text-sm text-muted transition hover:text-ink"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
