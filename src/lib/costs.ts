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

// [category, name, unit, Base, Upgraded, Superior]
const BASELINE: [string, string, string, number, number, number][] = [
  ["Envelope", "Windows", "EA", 450, 750, 1200],
  ["Envelope", "Exterior doors", "EA", 600, 1200, 2800],
  ["Envelope", "Siding", "SF", 5, 9, 17],
  ["Envelope", "Insulation", "SF", 1.5, 2.5, 4],
  ["Roof", "Roofing", "SF", 4.5, 7, 13],
  ["Roof", "Soffit & fascia", "LF", 8, 14, 24],
  ["Roof", "Gutters", "LF", 7, 12, 22],
  ["Interior", "Interior doors", "EA", 150, 320, 700],
  ["Interior", "Flooring", "SF", 4, 9, 20],
  ["Interior", "Drywall", "SF", 2, 2.75, 3.75],
  ["Interior", "Kitchen cabinets", "LF", 250, 550, 1200],
  ["Interior", "Countertops", "SF", 40, 75, 150],
  ["Mechanical", "Plumbing fixtures", "EA", 350, 950, 2600],
  ["Mechanical", "HVAC system", "LS", 9000, 16000, 30000],
];

/** Create the 3 tiers + baseline components + rates the first time a user opens Costs. */
export async function seedCostsIfEmpty(userId: string): Promise<void> {
  const existing = await sql`select 1 from feasible.cost_profiles where owner_id = ${userId} limit 1`;
  if (existing.length) return;

  const profiles = await sql<{ id: string; name: string }[]>`
    insert into feasible.cost_profiles (owner_id, name, is_default)
    values (${userId}, 'Base', true), (${userId}, 'Upgraded', false), (${userId}, 'Superior', false)
    returning id, name`;
  const pid: Record<string, string> = {};
  for (const p of profiles) pid[p.name] = p.id;

  for (const [category, name, unit, base, up, sup] of BASELINE) {
    const [item] = await sql<{ id: string }[]>`
      insert into feasible.cost_catalog_items (owner_id, category, name, unit)
      values (${userId}, ${category}, ${name}, ${unit}::feasible.unit_of_measure)
      returning id`;
    const rates: [string, number][] = [
      [pid.Base, base],
      [pid.Upgraded, up],
      [pid.Superior, sup],
    ];
    for (const [profileId, cost] of rates) {
      await sql`
        insert into feasible.cost_profile_rates (owner_id, cost_profile_id, catalog_item_id, unit_cost)
        values (${userId}, ${profileId}, ${item.id}, ${cost})`;
    }
  }
}

export interface CostItem {
  id: string;
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
    { item_id: string; category: string; name: string; unit: string; profile: string; unit_cost: number | null }[]
  >`
    select ci.id as item_id, ci.category, ci.name, ci.unit::text as unit, cp.name as profile, r.unit_cost
    from feasible.cost_catalog_items ci
    cross join feasible.cost_profiles cp
    left join feasible.cost_profile_rates r
      on r.catalog_item_id = ci.id and r.cost_profile_id = cp.id
    where ci.owner_id = ${userId} and cp.owner_id = ${userId}
    order by ci.category, ci.name`;

  const byItem = new Map<string, CostItem>();
  for (const r of rows) {
    let it = byItem.get(r.item_id);
    if (!it) {
      it = { id: r.item_id, category: r.category, name: r.name, unit: r.unit, rates: { Base: null, Upgraded: null, Superior: null } };
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
