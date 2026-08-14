"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { sql } from "@/db";
import { requireUser, type SessionUser } from "@/lib/session";
import { emailAllowed } from "@/lib/workspace";
import { loadMfDeal, type MfAssumptions } from "@/lib/mf-queries";
import {
  dealRole,
  canWrite,
  requireDealOwner,
  grantAccess,
  revokeAccess,
} from "@/lib/mf-access";
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
/**
 * A JSON-parsed number that may legitimately be absent. NULL is meaningful on
 * these columns — it means "follow the program", not "zero" — so anything that
 * isn't a finite number is stored as NULL rather than coerced to 0.
 */
const nullableNum = (v: number | null | undefined): number | null =>
  v == null || !Number.isFinite(v) ? null : v;

/**
 * Confirm the caller may WRITE this deal — owner or editor.
 *
 * A deal can be shared now, so this is no longer an owner_id comparison; it asks
 * src/lib/mf-access.ts, which is the single place that knows the rules. Deleting
 * the deal and managing its sharing are owner-only and use requireDealOwner.
 */
async function canEditDeal(user: SessionUser, dealId: string): Promise<boolean> {
  return canWrite(await dealRole(user, dealId));
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
  if (!(await canEditDeal(user, dealId))) return;

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
    cost_per_sf: number | null;
    gross_factor: number | null;
    disposition: "sell" | "hold" | null;
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
    where id = ${dealId}`;

  // Replace the mix wholesale. Comp quantities don't hang off unit types, so
  // there's nothing to cascade — this is safe and keeps deletes trivial.
  await sql`delete from feasible.mf_unit_types where deal_id = ${dealId}`;
  let order = 0;
  for (const u of units) {
    if (!u.label?.trim()) continue;
    order += 1;
    await sql`
      insert into feasible.mf_unit_types
        (deal_id, tier, label, unit_count, rent_monthly, sqft, sell_price,
         cost_per_sf, gross_factor, disposition, sort_order)
      values (${dealId}, ${u.tier === "affordable" ? "affordable" : "market"}, ${u.label.trim()},
              ${Math.max(0, Math.round(u.unit_count || 0))}, ${u.rent_monthly || 0}, ${u.sqft || 0},
              ${nullableNum(u.sell_price)},
              ${nullableNum(u.cost_per_sf)}, ${nullableNum(u.gross_factor)},
              ${u.disposition === "sell" || u.disposition === "hold" ? u.disposition : null}, ${order})`;
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
  // Spends an AI call, and only an editor could apply the result — gate it.
  if (!(await canEditDeal(user, dealId))) return { error: "Not allowed to edit this deal." };
  const loaded = await loadMfDeal(user, dealId);
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
  // This action WRITES comp rows and spends an AI call, so read access is not
  // enough — a viewer must not be able to add rows to someone else's deal.
  if (!(await canEditDeal(user, dealId))) return;
  const loaded = await loadMfDeal(user, dealId);
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
    await sql`update feasible.mf_deals set notes = ${`Comp search: ${result.error}`} where id = ${dealId}`;
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
  if (!(await canEditDeal(user, dealId))) return;
  await sql`update feasible.mf_comps set confirmed = true where id = ${compId} and deal_id = ${dealId}`;
  revalidatePath(`/multifamily/${dealId}`);
}

export async function deleteComp(formData: FormData) {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  const compId = String(formData.get("compId"));
  if (!(await canEditDeal(user, dealId))) return;
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
  if (!(await canEditDeal(user, dealId))) return;

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

// ---------------------------------------------------------------------------
// SHARING — owner only.
//
// Every action here calls requireDealOwner first. A collaborator, even an
// editor, must never be able to add another collaborator, change a role, or
// remove themselves-and-others — otherwise "shared with one colleague" quietly
// becomes "shared with whoever they chose."
// ---------------------------------------------------------------------------

export type ShareState = { error?: string; ok?: string } | null;

export async function shareDeal(_prev: ShareState, formData: FormData): Promise<ShareState> {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  const email = String(formData.get("email") ?? "").trim().toLowerCase();
  const role = String(formData.get("role")) === "editor" ? "editor" : "viewer";

  try {
    await requireDealOwner(user, dealId);
  } catch {
    return { error: "Only the deal's owner can share it." };
  }

  if (!email) return { error: "Enter an email address." };
  // The Workspace gate, applied at invite time as well as at sign-in. An outside
  // address could never hold a session anyway, so accepting the grant would just
  // leave a row that looks like access and isn't.
  if (!emailAllowed(email)) {
    return { error: "Only @brookegrouprealestate.com accounts can be given access." };
  }
  if (email === user.email?.trim().toLowerCase()) {
    return { error: "You already own this deal." };
  }

  await grantAccess(dealId, email, role, user.id);
  revalidatePath(`/multifamily/${dealId}`);
  return { ok: `${email} can now ${role === "editor" ? "view and edit" : "view"} this deal.` };
}

export async function unshareDeal(formData: FormData) {
  const user = await requireUser();
  const dealId = String(formData.get("dealId"));
  const accessId = String(formData.get("accessId"));
  await requireDealOwner(user, dealId);
  await revokeAccess(dealId, accessId);
  revalidatePath(`/multifamily/${dealId}`);
}
