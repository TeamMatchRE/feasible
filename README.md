# Feasible

Preliminary site-design / land-feasibility tool for Brooke Team. Draw a lot on
an aerial, drop the house, well, septic, and leach field on it, and Feasible
checks the setbacks and returns a **feasible / not-feasible** verdict — answering
"can you build here, and roughly what does the site work involve?"

Appraiser-grade by design: every derived number (area, length, distance) is a
PostGIS-computed generated column or a snapshotted value, so an estimate is
reproducible and explainable months later.

## Stack

- **Next.js 15** (App Router) · **React 19** · **Tailwind v4**
- **Supabase (brooke-identity)** Google auth — same identity layer as the other
  hub apps. RLS applies through the anon/JWT path.
- **PostGIS** in the brooke-identity Postgres, under a dedicated `feasible`
  schema. Geometry is stored in **EPSG:2234** (CT State Plane, US survey feet)
  so `ST_Length`/`ST_Area`/`ST_Distance` return feet with no reprojection. The
  client always speaks **EPSG:4326** GeoJSON; the app transforms on the boundary.
- **Google Maps JS** (drawing + geometry libraries) for the map studio — reuses
  the existing `GOOGLE_MAPS_API_KEY`.
- Data layer is **raw `postgres-js` SQL** (`src/db/index.ts`), not Drizzle —
  geometry columns and `GENERATED ALWAYS` PostGIS columns don't survive a query
  builder. Drizzle is kept only for `db:studio`.

## Setup

```bash
npm install
cp .env.example .env.local     # fill in — see below
npm run db:migrate             # applies db/migrations/*.sql (idempotent)
npm run dev                    # http://localhost:3010
```

`.env.local` needs the brooke-identity `DATABASE_URL` + Supabase keys (copy from
another hub app, e.g. soi-giant) and `NEXT_PUBLIC_GOOGLE_MAPS_API_KEY` (copy from
dwell / solar-roofing-app). Restrict the Maps key by HTTP referrer to
`localhost:3010` + the prod host, and make sure the **Geocoding API** and
**Maps JavaScript API** are enabled.

## Data model

The authoritative DDL is **`db/migrations/0001_init.sql`** — read it, not
`src/db/schema.ts` (a stub). Highlights:

- `projects` → a feasibility study. `parcels`, `site_features`,
  `template_placements`, `wells`, `septic_systems`, `leach_fields`,
  `road_segments` hang off it, each with its own geometry.
- `setback_rules` — the distances the engine checks. Ships with an
  **illustrative CT default set** (well↔septic 75′, etc.) flagged
  `ILLUSTRATIVE — verify`. **Replace these with verified local health-code /
  zoning values before anyone leans on the verdict.**
- `design_validations` — the engine's output, one row per rule checked.
- Reference/library tables (`cost_profiles`, `cost_catalog_items`,
  `jurisdictions`, …) and the takeoff/costing tables exist in the schema but are
  not yet wired into the UI (see below).

RLS: owner-scoped private tables key on `auth.uid()`; child tables inherit
through their parent project. Belt-and-suspenders — the app's geometry queries
run over the privileged `DATABASE_URL` (which bypasses RLS), and every server
action re-establishes the signed-in user and scopes by their id.

## The feasibility engine

`runFeasibility()` (`src/app/projects/[id]/actions.ts`) walks `RULES`
(`src/lib/geo.ts`), measures the true edge-to-edge distance in feet between the
two feature sets with `ST_Distance`, compares against the governing
`setback_rules` row, and writes `design_validations`:

- `measured < required` → **fail**
- `measured < required × 1.05` → **warn** (meets it, but only just)
- else → **pass**

Verdict: any fail → **not feasible**; otherwise **feasible**; no rules
evaluable → **not yet checked**.

## What's in this build (MVP)

Create a study at an address → map studio → draw the property line, place the
house / well / septic / leach field / road → run the feasibility check → verdict
+ per-rule breakdown. Deployed nowhere yet; runs locally on :3010 and shows in
LilyPad (admin-only tile).

## Deferred (schema is ready, UI is not)

- **Cost takeoffs & the cost catalog** (`cost_*`, `takeoffs`, `takeoff_items`) —
  price the road/utility runs and the building.
- **Building template library** — upload a footprint once, drop it on many lots
  (`building_templates`; placements currently store freehand footprints).
- **DWG/DXF/PDF plan parsing** (`project_files`, `parse_status`) — Supabase
  Storage + a parser.
- **Jurisdiction-specific setbacks** — the engine already prefers a
  jurisdiction/owner override; the UI to manage them isn't built.
- **Editing placed geometry** — MVP saves shapes as drawn; reshaping means a
  delete + redraw for now.
- **MA/RI State Plane** — everything is EPSG:2234 (CT). Fine for local setback
  distances across southern New England; revisit if precision matters at scale.
