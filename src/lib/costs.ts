import "server-only";
import { sql } from "@/db";

/**
 * Construction cost catalog: quality tiers (Base / Upgraded / Superior) modelled
 * as three `cost_profiles`, components as `cost_catalog_items`, and the
 * component×tier unit costs as `cost_profile_rates`. Per-user, seeded once with
 * an illustrative baseline the user then edits (or replaces from a spreadsheet).
 * Rates here are rough US residential placeholders — NOT authoritative.
 */

export const TIERS = ["Base", "Upgraded", "Superior"] as const;
export type Tier = (typeof TIERS)[number];

export const SECTIONS = ["Building Components", "Infrastructure"] as const;
export type Section = (typeof SECTIONS)[number];

/**
 * The default catalog — a full new-build development, not just the home.
 * Taxonomy mirrors David's 21HVT build budget (sections/line items), split into
 * the two Costs tabs. Rates are illustrative US-residential placeholders the user
 * edits — NOT his sheet's actuals. [section, category, name, unit, Base, Up, Superior]
 */
const CATALOG: [Section, string, string, string, number, number, number][] = [
  // ── Building Components ──────────────────────────────────────────────
  ["Building Components", "Foundation", "Foundation & footings", "LS", 60000, 90000, 140000],
  ["Building Components", "Foundation", "Basement slab", "SF", 6, 8, 11],
  ["Building Components", "Foundation", "Garage slab", "SF", 6, 8, 11],
  ["Building Components", "Foundation", "Porch slabs", "SF", 8, 12, 18],
  ["Building Components", "Foundation", "Damp-proofing", "LS", 2500, 3500, 6000],
  ["Building Components", "Framing", "Framing (material & labor)", "SF", 22, 32, 48],
  ["Building Components", "Exterior", "Siding", "SF", 5, 9, 17],
  ["Building Components", "Exterior", "Cedar accent siding", "SF", 9, 14, 22],
  ["Building Components", "Exterior", "Roofing", "SF", 4.5, 7, 13],
  ["Building Components", "Exterior", "Metal roofing", "SF", 9, 14, 22],
  ["Building Components", "Exterior", "Soffit & fascia", "LF", 8, 14, 24],
  ["Building Components", "Windows & Doors", "Windows", "EA", 450, 750, 1200],
  ["Building Components", "Windows & Doors", "Exterior doors", "EA", 600, 1200, 2800],
  ["Building Components", "Windows & Doors", "Garage doors", "EA", 1200, 2200, 4500],
  ["Building Components", "Windows & Doors", "Gutters", "LF", 7, 12, 22],
  ["Building Components", "Windows & Doors", "Interior doors", "EA", 150, 320, 700],
  ["Building Components", "Decks & Porches", "Decking", "SF", 30, 45, 70],
  ["Building Components", "Decks & Porches", "Porch", "SF", 40, 60, 95],
  ["Building Components", "Electrical", "Electrical (rough & final)", "LS", 45000, 62000, 85000],
  ["Building Components", "Electrical", "Interior lighting fixtures", "LS", 6000, 12000, 25000],
  ["Building Components", "Electrical", "Exterior lighting fixtures", "LS", 2000, 4000, 8000],
  ["Building Components", "Electrical", "Standby generator", "LS", 8000, 14000, 25000],
  ["Building Components", "Plumbing", "Plumbing (rough & final)", "LS", 40000, 56000, 78000],
  ["Building Components", "Plumbing", "Plumbing fixtures", "EA", 350, 950, 2600],
  ["Building Components", "Plumbing", "Water heater(s)", "EA", 2500, 5000, 10000],
  ["Building Components", "Plumbing", "Gas piping", "LS", 2000, 3500, 6000],
  ["Building Components", "HVAC", "HVAC system", "LS", 25000, 40000, 65000],
  ["Building Components", "Insulation", "Insulation", "SF", 1.5, 2.5, 4],
  ["Building Components", "Drywall & Paint", "Drywall", "SF", 2, 2.75, 3.75],
  ["Building Components", "Drywall & Paint", "Interior paint", "SF", 2.5, 4, 7],
  ["Building Components", "Drywall & Paint", "Exterior paint", "LS", 4000, 8000, 15000],
  ["Building Components", "Bathrooms", "Bath tile", "SF", 12, 22, 45],
  ["Building Components", "Bathrooms", "Tub / shower", "EA", 1200, 3000, 8000],
  ["Building Components", "Bathrooms", "Toilet", "EA", 350, 700, 1600],
  ["Building Components", "Bathrooms", "Vanity", "EA", 800, 2000, 5000],
  ["Building Components", "Kitchen", "Kitchen cabinets", "LF", 250, 550, 1200],
  ["Building Components", "Kitchen", "Countertops", "SF", 40, 75, 150],
  ["Building Components", "Kitchen", "Backsplash", "SF", 15, 30, 60],
  ["Building Components", "Appliances", "Appliance package", "LS", 12000, 30000, 70000],
  ["Building Components", "Flooring", "Flooring", "SF", 4, 9, 20],
  ["Building Components", "Flooring", "Tile flooring", "SF", 8, 15, 30],
  ["Building Components", "Flooring", "Carpet", "SF", 3, 5, 9],
  ["Building Components", "Trim & Carpentry", "Interior trim", "LF", 6, 12, 25],
  ["Building Components", "Trim & Carpentry", "Built-in cabinetry", "LF", 200, 450, 950],
  // ── Infrastructure ──────────────────────────────────────────────────
  ["Infrastructure", "Development", "Land cost", "LS", 150000, 200000, 300000],
  ["Infrastructure", "Development", "Site engineering", "LS", 10000, 15000, 25000],
  ["Infrastructure", "Development", "Architect", "LS", 8000, 15000, 30000],
  ["Infrastructure", "Development", "Interior designer", "LS", 4000, 8000, 18000],
  ["Infrastructure", "Development", "Surveyor", "LS", 2000, 3000, 5000],
  ["Infrastructure", "Development", "Building permit", "LS", 8000, 12500, 20000],
  ["Infrastructure", "Development", "Zoning & wetland permits", "LS", 0, 1500, 5000],
  ["Infrastructure", "Site Work", "Stake out", "LS", 1000, 1800, 3000],
  ["Infrastructure", "Site Work", "Tree clearing", "LS", 2500, 6000, 15000],
  ["Infrastructure", "Site Work", "Strip topsoil", "LS", 3000, 5000, 9000],
  ["Infrastructure", "Site Work", "Blasting", "LS", 0, 20000, 50000],
  ["Infrastructure", "Site Work", "Excavation", "LS", 30000, 60000, 110000],
  ["Infrastructure", "Site Work", "Sub-grade foundation prep", "LS", 4000, 6000, 10000],
  ["Infrastructure", "Utilities", "Well / water service", "LS", 9000, 14000, 22000],
  ["Infrastructure", "Utilities", "Septic system", "LS", 30000, 45000, 70000],
  ["Infrastructure", "Utilities", "Water line trenching", "LF", 15, 25, 40],
  ["Infrastructure", "Utilities", "Electrical & telecom trenching", "LF", 20, 35, 55],
  ["Infrastructure", "Utilities", "Utility service connection", "LS", 6000, 12000, 25000],
  ["Infrastructure", "Drainage & Grading", "Backfill & compaction", "LS", 15000, 27000, 45000],
  ["Infrastructure", "Drainage & Grading", "Footing drain system", "LS", 5000, 8500, 14000],
  ["Infrastructure", "Drainage & Grading", "Yard & gutter drains", "LS", 3000, 6000, 12000],
  ["Infrastructure", "Drainage & Grading", "Final grading", "LS", 3000, 5000, 9000],
  ["Infrastructure", "Driveway & Hardscape", "Driveway", "SY", 40, 70, 130],
  ["Infrastructure", "Driveway & Hardscape", "Curbing", "LF", 25, 40, 70],
  ["Infrastructure", "Driveway & Hardscape", "Patio", "SF", 15, 28, 55],
  ["Infrastructure", "Driveway & Hardscape", "Stone cladding", "SF", 30, 50, 90],
  ["Infrastructure", "Landscaping", "Topsoil & seeding", "LS", 8000, 15000, 30000],
  ["Infrastructure", "Landscaping", "Trees & shrubs", "LS", 3000, 8000, 20000],
  ["Infrastructure", "Landscaping", "Irrigation", "LS", 8000, 12000, 22000],
  ["Infrastructure", "Site Improvements", "Pool & decking", "LS", 0, 80000, 200000],
  ["Infrastructure", "Site Improvements", "Fencing", "LF", 25, 45, 90],
  ["Infrastructure", "Site Improvements", "Shed / barn", "LS", 0, 15000, 50000],
  ["Infrastructure", "Site Improvements", "Outdoor kitchen", "LS", 0, 25000, 75000],
  ["Infrastructure", "Project Costs", "Builder's risk insurance", "LS", 5000, 7600, 12000],
  ["Infrastructure", "Project Costs", "General liability insurance", "LS", 1200, 1700, 3000],
  ["Infrastructure", "Project Costs", "Dumpster & debris removal", "LS", 4000, 8000, 15000],
  ["Infrastructure", "Project Costs", "Temporary toilet & utilities", "LS", 1500, 3000, 6000],
  ["Infrastructure", "Project Costs", "As-built survey & pins", "LS", 2000, 3000, 5000],
];

/**
 * Ensure the user's catalog exists and matches the current taxonomy. Idempotent
 * and additive: creates the 3 tiers on first run, then for each catalog entry
 * either re-canonicalises an existing item's section/category/unit (preserving any
 * rates the user has edited) or inserts a new item with illustrative rates. Never
 * deletes; the user's own added components are left untouched.
 */
export async function seedCostsIfEmpty(userId: string): Promise<void> {
  let profiles = await sql<{ id: string; name: string }[]>`
    select id, name from feasible.cost_profiles where owner_id = ${userId}`;
  if (!profiles.length) {
    profiles = await sql<{ id: string; name: string }[]>`
      insert into feasible.cost_profiles (owner_id, name, is_default)
      values (${userId}, 'Base', true), (${userId}, 'Upgraded', false), (${userId}, 'Superior', false)
      returning id, name`;
  }
  const pid: Record<string, string> = {};
  for (const p of profiles) pid[p.name] = p.id;

  // Existing items keyed by lower-cased name (names are unique across the catalog).
  const existing = await sql<{ id: string; name: string }[]>`
    select id, name from feasible.cost_catalog_items where owner_id = ${userId}`;
  const byName = new Map(existing.map((e) => [e.name.toLowerCase(), e.id]));

  for (const [section, category, name, unit, base, up, sup] of CATALOG) {
    const found = byName.get(name.toLowerCase());
    if (found) {
      // Re-home an existing item into the current taxonomy; keep its rates.
      await sql`
        update feasible.cost_catalog_items
        set section = ${section}, category = ${category}, unit = ${unit}::feasible.unit_of_measure
        where id = ${found} and owner_id = ${userId}`;
      continue;
    }
    const [item] = await sql<{ id: string }[]>`
      insert into feasible.cost_catalog_items (owner_id, section, category, name, unit)
      values (${userId}, ${section}, ${category}, ${name}, ${unit}::feasible.unit_of_measure)
      returning id`;
    for (const [tier, cost] of [["Base", base], ["Upgraded", up], ["Superior", sup]] as const) {
      if (pid[tier]) {
        await sql`
          insert into feasible.cost_profile_rates (owner_id, cost_profile_id, catalog_item_id, unit_cost)
          values (${userId}, ${pid[tier]}, ${item.id}, ${cost})`;
      }
    }
  }
}

export interface CostItem {
  id: string;
  section: string;
  category: string;
  name: string;
  unit: string;
  rates: Record<Tier, number | null>;
}
export interface CostCatalog {
  profiles: { id: string; name: Tier }[];
  items: CostItem[];
}

/** The user's full cost grid: components × tier unit costs. */
export async function loadCosts(userId: string): Promise<CostCatalog> {
  const profiles = await sql<{ id: string; name: string }[]>`
    select id, name from feasible.cost_profiles where owner_id = ${userId}`;
  const order: Record<string, number> = { Base: 0, Upgraded: 1, Superior: 2 };
  profiles.sort((a, b) => (order[a.name] ?? 9) - (order[b.name] ?? 9));

  const rows = await sql<
    { item_id: string; section: string; category: string; name: string; unit: string; profile: string; unit_cost: number | null }[]
  >`
    select ci.id as item_id, ci.section, ci.category, ci.name, ci.unit::text as unit, cp.name as profile, r.unit_cost
    from feasible.cost_catalog_items ci
    cross join feasible.cost_profiles cp
    left join feasible.cost_profile_rates r
      on r.catalog_item_id = ci.id and r.cost_profile_id = cp.id
    where ci.owner_id = ${userId} and cp.owner_id = ${userId}
    order by ci.section, ci.category, ci.name`;

  const byItem = new Map<string, CostItem>();
  for (const r of rows) {
    let it = byItem.get(r.item_id);
    if (!it) {
      it = { id: r.item_id, section: r.section, category: r.category, name: r.name, unit: r.unit, rates: { Base: null, Upgraded: null, Superior: null } };
      byItem.set(r.item_id, it);
    }
    if (r.profile in it.rates) it.rates[r.profile as Tier] = r.unit_cost == null ? null : Number(r.unit_cost);
  }
  return {
    profiles: profiles.map((p) => ({ id: p.id, name: p.name as Tier })),
    items: [...byItem.values()],
  };
}

export interface PricedLine {
  category: string;
  description: string | null;
  quantity: number;
  unit: string;
  /** Tier rates for the matched component, or null when nothing matched. */
  rates: Record<Tier, number | null> | null;
  matchName: string | null;
}

/** A design's takeoff joined to the cost catalog by category/name (advisory). */
export async function priceDesign(designId: string, userId: string): Promise<PricedLine[]> {
  const takeoff = await sql<{ category: string; description: string | null; quantity: number; unit: string }[]>`
    select ti.category, ti.description, ti.quantity, ti.unit::text as unit
    from feasible.takeoff_items ti
    join feasible.takeoffs t on t.id = ti.takeoff_id
    where t.template_id = ${designId} and t.owner_id = ${userId}
    order by ti.created_at`;

  const catalog = await loadCosts(userId);
  const match = (cat: string) => {
    const c = cat.toLowerCase();
    return (
      catalog.items.find((i) => c.includes(i.name.toLowerCase()) || i.name.toLowerCase().includes(c)) ?? null
    );
  };

  return takeoff.map((t) => {
    const m = match(t.category);
    return {
      category: t.category,
      description: t.description,
      quantity: Number(t.quantity),
      unit: t.unit,
      rates: m ? m.rates : null,
      matchName: m ? m.name : null,
    };
  });
}
