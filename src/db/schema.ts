/**
 * Intentionally minimal.
 *
 * Feasible's authoritative DDL is the hand-written PostGIS migration in
 * db/migrations/ — geometry columns and GENERATED-ALWAYS ST_Area()/ST_Length()
 * columns can't be represented in Drizzle. The app talks to the DB through the
 * raw `sql` client in ./index.ts, not a Drizzle query builder.
 *
 * This file exists only so drizzle.config.ts resolves (e.g. `drizzle-kit
 * studio`). If you want typed row shapes, model them as plain TS interfaces in
 * the query modules rather than re-deriving the schema here.
 */
export {};
