"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireUser } from "@/lib/session";
import { loadMfDeal, type MfAssumptions } from "@/lib/mf-queries";
import { findComps, type CompKind } from "@/lib/mf-comps-ai";
import { refineParking, type ParkingRefinement } from "@/lib/mf-parking-ai";
import type { LineDetails } from "@/lib/multifamily";
import type { CostProgram } from "@/lib/mf-costs";

const num = (v: FormDataEntryValue | null, fallback = 0): number => {
  if (v == null) return fallback;
  const n = Number(String(v).replace(/[$,%\s]/g, "").trim());
  return Number.isFinite(n) ? n : fallback;
};
const str = (v: FormDataEntryValue | null): string | null => {
  const s = String(v ?? "").trim();
  return s === "" ? null : s;
};

/** Confirm the deal belongs to the caller before any write. */
async function ownDeal(ownerId: string, dealId: string): Promise<boolean> {
  const rows = await sql<{ id: string }[]>`
    select id from feasible.mf_deals where id = ${dealId} and owner_id = ${ownerId}`;
  return rows.length > 0;
}

export async function createDeal(formData: FormData) {
  const user = await requireUser();
  const name = str(formData.get("name")) ?? "Untitled deal";
  const city = str(formData.get("city"));
  const { createMfDeal } = await import("@/lib/mf-queries");
  const id = await createMfDeal(user.id, name, city);
  redirect(`/multifamily/${id}`);
}

export async function deleteDeal(formData: FormData) {
  const user = await requireUser();
  const id = String(formData.get("dealId"));
  await sql`delete from feasible.mf_deals where id = ${id} and owner_id = ${user.id}`;
  revalidatePath("/multifamily");
  redirect("/multifamily");
}

/**
 * Save the whole deal: identity, cost basis, the unit mix, and the assumptions
 * blob. The editor posts everything it holds, so this is a full replace rather
 * than a patch — simpler to reason about than a dozen partial writes, and the
 * client always has the complete state.
 */
export async function saveDeal(formData: FormData) {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  if (!(await ownDeal(user.id, dealId))) return;

  const assumptions = JSON.parse(String(formData.get("assumptions") ?? "{}")) as MfAssumptions;
  const costProgram = JSON.parse(String(formData.get("cost_program") ?? "{}")) as CostProgram;
  const lineDetails = JSON.parse(String(formData.get("line_details") ?? "{}")) as LineDetails;
  const units = JSON.parse(String(formData.get("units") ?? "[]")) as {
    id?: string;
    tier: "market" | "affordable";
    label: string;
    unit_count: number;
    rent_monthly: number;
    sqft: number;
    sell_price: number | null;
  }[];

  await sql`
    update feasible.mf_deals set
      name = ${str(formData.get("name")) ?? "Untitled deal"},
      address = ${str(formData.get("address"))},
      city = ${str(formData.get("city"))},
      state = ${str(formData.get("state")) ?? "CT"},
      gross_sqft = ${num(formData.get("gross_sqft"))},
      commercial_sqft = ${num(formData.get("commercial_sqft"))},
      height_stories = ${num(formData.get("height_stories"))},
      garage_spaces = ${num(formData.get("garage_spaces"))},
      surface_spaces = ${num(formData.get("surface_spaces"))},
      storage_spaces = ${num(formData.get("storage_spaces"))},
      total_project_cost = ${num(formData.get("total_project_cost"))},
      assumptions = ${JSON.stringify(assumptions)}::jsonb,
      cost_program = ${JSON.stringify(costProgram)}::jsonb,
      line_details = ${JSON.stringify(lineDetails)}::jsonb,
      notes = ${str(formData.get("notes"))},
      updated_at = now()
    where id = ${dealId} and owner_id = ${user.id}`;

  // Replace the mix wholesale. Comp quantities don't hang off unit types, so
  // there's nothing to cascade — this is safe and keeps deletes trivial.
  await sql`delete from feasible.mf_unit_types where deal_id = ${dealId}`;
  let order = 0;
  for (const u of units) {
    if (!u.label?.trim()) continue;
    order += 1;
    await sql`
      insert into feasible.mf_unit_types
        (deal_id, tier, label, unit_count, rent_monthly, sqft, sell_price, sort_order)
      values (${dealId}, ${u.tier === "affordable" ? "affordable" : "market"}, ${u.label.trim()},
              ${Math.max(0, Math.round(u.unit_count || 0))}, ${u.rent_monthly || 0}, ${u.sqft || 0},
              ${u.sell_price == null || Number.isNaN(u.sell_price) ? null : u.sell_price}, ${order})`;
  }

  revalidatePath(`/multifamily/${dealId}`);
}

export type RefineState = { refinement?: ParkingRefinement; error?: string } | null;

/**
 * Ask the model what this town requires for parking.
 *
 * Deliberately does NOT write. It hands the proposal back to the editor, which
 * shows every figure next to the default it would displace and lets the
 * underwriter apply them — the same propose→verify discipline the comp finder
 * uses. A zoning table the model half-remembered should not resize a parking deck
 * on its own.
 */
export async function refineParkingAction(_prev: RefineState, formData: FormData): Promise<RefineState> {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  const loaded = await loadMfDeal(user.id, dealId);
  if (!loaded) return { error: "Deal not found." };

  const { deal, units } = loaded;
  const result = await refineParking({
    address: deal.address,
    city: deal.city,
    state: deal.state ?? "CT",
    unitTypes: units.map((u) => ({ label: u.label, count: Number(u.unit_count) })),
    totalUnits: units.reduce((s, u) => s + Number(u.unit_count), 0),
  });

  return result.ok ? { refinement: result.refinement } : { error: result.error };
}

/**
 * Ask the model for comps. Everything it returns is stored unconfirmed — the
 * underwriter promotes them. See src/lib/mf-comps-ai.ts for why.
 */
export async function searchComps(formData: FormData) {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  const kind = (String(formData.get("kind")) === "sale" ? "sale" : "rent") as CompKind;
  const loaded = await loadMfDeal(user.id, dealId);
  if (!loaded) return;

  const { deal, units } = loaded;
  const result = await findComps({
    kind,
    address: deal.address,
    city: deal.city,
    state: deal.state ?? "CT",
    unitTypes: units
      .filter((u) => u.tier === "market")
      .map((u) => ({ label: u.label, count: Number(u.unit_count), sqft: Number(u.sqft) })),
    totalUnits: units.reduce((s, u) => s + Number(u.unit_count), 0),
  });

  if (!result.ok) {
    await sql`update feasible.mf_deals set notes = ${`Comp search: ${result.error}`} where id = ${dealId} and owner_id = ${user.id}`;
    revalidatePath(`/multifamily/${dealId}`);
    return;
  }

  for (const c of result.comps) {
    await sql`
      insert into feasible.mf_comps
        (deal_id, kind, property_name, address, city, year_built, units, distance_mi, detail, source, ai_generated, confirmed, note)
      values (${dealId}, ${kind}, ${c.propertyName}, ${c.address}, ${c.city}, ${c.yearBuilt},
              ${c.units}, ${c.distanceMi}, ${JSON.stringify(c.units_detail)}::jsonb,
              ${c.source ?? "AI"}, true, false, ${c.note})`;
  }
  revalidatePath(`/multifamily/${dealId}`);
}

export async function confirmComp(formData: FormData) {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  const compId = String(formData.get("compId"));
  if (!(await ownDeal(user.id, dealId))) return;
  await sql`update feasible.mf_comps set confirmed = true where id = ${compId} and deal_id = ${dealId}`;
  revalidatePath(`/multifamily/${dealId}`);
}

export async function deleteComp(formData: FormData) {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  const compId = String(formData.get("compId"));
  if (!(await ownDeal(user.id, dealId))) return;
  await sql`delete from feasible.mf_comps where id = ${compId} and deal_id = ${dealId}`;
  revalidatePath(`/multifamily/${dealId}`);
}

/**
 * Pull a confirmed comp's figures onto the subject's mix — rent comps set rents,
 * sale comps set unit sale prices. Matched by bedroom label, which is why the
 * prompt asks the model to reuse the subject's labels.
 */
export async function applyCompToMix(formData: FormData) {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  const compId = String(formData.get("compId"));
  if (!(await ownDeal(user.id, dealId))) return;

  const [comp] = await sql<{ kind: "rent" | "sale"; detail: unknown }[]>`
    select kind, detail from feasible.mf_comps where id = ${compId} and deal_id = ${dealId}`;
  if (!comp) return;

  // jsonb arrives as a string under `prepare: false` — see asJson in mf-queries.
  type Line = { label: string; rent: number | null; price: number | null };
  let detail: Line[] = [];
  try {
    detail = (typeof comp.detail === "string" ? JSON.parse(comp.detail) : comp.detail) as Line[];
  } catch {
    detail = [];
  }
  if (!Array.isArray(detail)) return;

  const norm = (s: string) => s.trim().toLowerCase();
  for (const line of detail) {
    const value = comp.kind === "rent" ? line.rent : line.price;
    if (value == null) continue; // a null means "not found" — never write it as 0
    if (comp.kind === "rent") {
      await sql`update feasible.mf_unit_types set rent_monthly = ${value}
                where deal_id = ${dealId} and tier = 'market' and lower(trim(label)) = ${norm(line.label)}`;
    } else {
      await sql`update feasible.mf_unit_types set sell_price = ${value}
                where deal_id = ${dealId} and tier = 'market' and lower(trim(label)) = ${norm(line.label)}`;
    }
  }
  revalidatePath(`/multifamily/${dealId}`);
}
