"use server";

import { revalidatePath } from "next/cache";
import { requireUser } from "@/lib/session";
import { sql } from "@/db";

/** Set a component's unit cost for one tier (today's effective rate). */
export async function saveRate(itemId: string, profileId: string, cost: number | null): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireUser();
    // Ownership: both the item and profile must belong to the caller.
    const [ok] = await sql`
      select 1 from feasible.cost_catalog_items ci, feasible.cost_profiles cp
      where ci.id = ${itemId} and ci.owner_id = ${user.id}
        and cp.id = ${profileId} and cp.owner_id = ${user.id}`;
    if (!ok) return { ok: false, error: "Not found." };
    if (cost == null || !Number.isFinite(cost)) {
      await sql`delete from feasible.cost_profile_rates
        where catalog_item_id = ${itemId} and cost_profile_id = ${profileId} and effective_date = current_date`;
    } else {
      await sql`
        insert into feasible.cost_profile_rates (owner_id, cost_profile_id, catalog_item_id, unit_cost, effective_date)
        values (${user.id}, ${profileId}, ${itemId}, ${cost}, current_date)
        on conflict (cost_profile_id, catalog_item_id, effective_date)
        do update set unit_cost = excluded.unit_cost`;
    }
    revalidatePath("/costs");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Save failed." };
  }
}

/** Add a component (with its Base/Upgraded/Superior rates). */
export async function addComponent(
  input: { section: string; category: string; name: string; unit: string; base: number | null; upgraded: number | null; superior: number | null },
): Promise<{ ok: boolean; error?: string }> {
  try {
    const user = await requireUser();
    if (!input.name.trim()) return { ok: false, error: "Name required." };
    const section = input.section === "Infrastructure" ? "Infrastructure" : "Building Components";
    const [item] = await sql<{ id: string }[]>`
      insert into feasible.cost_catalog_items (owner_id, section, category, name, unit)
      values (${user.id}, ${section}, ${input.category.trim() || "Other"}, ${input.name.trim()}, ${input.unit}::feasible.unit_of_measure)
      returning id`;
    const profiles = await sql<{ id: string; name: string }[]>`
      select id, name from feasible.cost_profiles where owner_id = ${user.id}`;
    const val: Record<string, number | null> = { Base: input.base, Upgraded: input.upgraded, Superior: input.superior };
    for (const p of profiles) {
      const c = val[p.name];
      if (c != null && Number.isFinite(c)) {
        await sql`insert into feasible.cost_profile_rates (owner_id, cost_profile_id, catalog_item_id, unit_cost)
          values (${user.id}, ${p.id}, ${item.id}, ${c})`;
      }
    }
    revalidatePath("/costs");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Add failed." };
  }
}

/** Remove a component (cascades its rates). */
export async function removeComponent(itemId: string): Promise<{ ok: boolean }> {
  const user = await requireUser();
  await sql`delete from feasible.cost_catalog_items where id = ${itemId} and owner_id = ${user.id}`;
  revalidatePath("/costs");
  return { ok: true };
}
