/**
 * Applies the raw SQL migrations in db/migrations/ in filename order.
 *
 * We hand-run SQL (rather than drizzle-kit migrate) because the schema is
 * PostGIS-first: geometry columns and GENERATED-ALWAYS ST_Area()/ST_Length()
 * columns can't be expressed through drizzle-kit. Each file is expected to be
 * idempotent (IF NOT EXISTS / guarded seeds), so re-running is safe.
 *
 * Usage:  DATABASE_URL=... npx tsx scripts/migrate.ts
 */
import { existsSync, readdirSync, readFileSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");

import { join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const __dirname = dirname(fileURLToPath(import.meta.url));

async function main() {
  const url = process.env.DATABASE_URL;
  if (!url) {
    console.error("DATABASE_URL is not set — add it to .env.local");
    process.exit(1);
  }

  const dir = join(__dirname, "..", "db", "migrations");
  const files = readdirSync(dir)
    .filter((f) => f.endsWith(".sql"))
    .sort();

  if (files.length === 0) {
    console.log("No migrations found in", dir);
    return;
  }

  // A single non-pooled-friendly connection; simple() lets one call run a file
  // containing many statements (DDL + DO blocks).
  const sql = postgres(url, { prepare: false, max: 1 });

  try {
    for (const file of files) {
      const text = readFileSync(join(dir, file), "utf8");
      process.stdout.write(`Applying ${file} … `);
      await sql.unsafe(text);
      console.log("ok");
    }
    console.log("\nAll migrations applied.");
  } catch (err) {
    console.error("\nMigration failed:", err);
    process.exitCode = 1;
  } finally {
    await sql.end();
  }
}

main();
