import "server-only";
import postgres from "postgres";

/**
 * Raw postgres-js client over the brooke-identity Postgres.
 *
 * Feasible's data layer is raw SQL rather than Drizzle: almost every write and
 * read touches PostGIS (ST_Transform, ST_AsGeoJSON, ST_Distance) or a
 * GENERATED-ALWAYS column, none of which Drizzle's query builder expresses
 * cleanly. Tagged-template `sql` gives parameterised, injection-safe queries
 * with first-class PostGIS.
 *
 * TRUSTED, RLS-BYPASSING connection. DATABASE_URL carries the privileged
 * Postgres role, so the row-level policies in db/migrations do NOT constrain
 * these queries. Every server action MUST therefore establish the signed-in
 * user via requireUser() (see @/lib/session) and scope every statement by that
 * user's id. Never hand a browser data from `sql` without that ownership gate.
 */
let cached: ReturnType<typeof postgres> | null = null;

export function getSql() {
  if (cached) return cached;
  const url = process.env.DATABASE_URL;
  if (!url) throw new Error("DATABASE_URL is not set — add it to .env.local");
  // Supabase's pooled connection can't use prepared statements.
  cached = postgres(url, {
    prepare: false,
    // feasible first so unqualified tables resolve; extensions/public so
    // PostGIS functions resolve wherever the extension actually lives.
    connection: { search_path: "feasible, extensions, public" },
  });
  return cached;
}

/** Lazy proxy: connect on first query, not at import (keeps `next build` happy). */
export const sql: ReturnType<typeof postgres> = new Proxy(
  function () {} as unknown as ReturnType<typeof postgres>,
  {
    apply(_t, _this, args) {
      // support tagged-template call: sql`...`
      return (getSql() as unknown as (...a: unknown[]) => unknown)(...args);
    },
    get(_t, prop, receiver) {
      const real = getSql();
      const value = Reflect.get(real as object, prop, receiver);
      return typeof value === "function" ? value.bind(real) : value;
    },
  },
);
