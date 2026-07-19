import { defineConfig } from "drizzle-kit";

// Feasible owns the `feasible` schema inside the brooke-identity Postgres.
// `identity`/`auth`/`public` are managed elsewhere and are not generated from
// here (see schemaFilter). NOTE: the authoritative DDL is the raw PostGIS
// migration in db/migrations/ — drizzle-kit can't express geometry columns or
// GENERATED-ALWAYS ST_Area()/ST_Length() columns, so we hand-write those. The
// Drizzle schema (src/db/schema.ts) is a typed mirror for app queries only.
export default defineConfig({
  schema: "./src/db/schema.ts",
  out: "./drizzle",
  dialect: "postgresql",
  schemaFilter: ["feasible"],
  dbCredentials: {
    url:
      process.env.DATABASE_URL ??
      "postgresql://placeholder:placeholder@localhost:5432/placeholder",
  },
  verbose: true,
  strict: true,
});
