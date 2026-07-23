import { existsSync } from "node:fs";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
import postgres from "postgres";
import { seedCostsIfEmpty, loadCosts } from "./src/lib/costs";

const sql = postgres(process.env.DATABASE_URL!, { prepare: false, max: 1 });
const owners = await sql<{ owner_id: string }[]>`
  select distinct owner_id from feasible.cost_catalog_items where owner_id is not null`;
console.log("owners with catalog:", owners.length);
for (const { owner_id } of owners) {
  await seedCostsIfEmpty(owner_id);
  const cat = await loadCosts(owner_id);
  const names = new Map<string, number>();
  for (const it of cat.items) names.set(it.name.toLowerCase(), (names.get(it.name.toLowerCase()) ?? 0) + 1);
  const dupes = [...names].filter(([, n]) => n > 1);
  console.log(`\nowner ${owner_id.slice(0, 8)} — ${cat.items.length} items`);
  for (const sec of ["Building Components", "Infrastructure"]) {
    const its = cat.items.filter((i) => i.section === sec);
    const cats = [...new Set(its.map((i) => i.category))];
    console.log(`  ${sec}: ${its.length} items / ${cats.length} cats`);
    console.log(`     ${cats.join(", ")}`);
  }
  console.log("  duplicate names:", dupes.length ? dupes.map(([n]) => n) : "none");
  const sample = cat.items.find((i) => i.name === "Windows");
  if (sample) console.log("  e.g. Windows →", sample.section, "/", sample.category, "rates", JSON.stringify(sample.rates));
}
await sql.end();
