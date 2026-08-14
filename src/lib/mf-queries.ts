import "server-only";
import { sql } from "@/db";
import type { MultiFamilyInputs, UnitTypeInput, LineDetails } from "@/lib/multifamily";
import { DEFAULT_COST_PROGRAM, type CostProgram } from "@/lib/mf-costs";
import { dealRole, canRead, type DealRole } from "@/lib/mf-access";
import type { SessionUser } from "@/lib/session";

/**
 * Storage for multi-family deals. The engine's inputs are split three ways:
 * columns for what we list and sort by, rows for the unit mix (edited a line at a
 * time, and joined against by the comp matcher), and one JSONB blob for the
 * assumptions — read and written whole by a single editor.
 */

/**
 * jsonb comes back as a STRING, not an object.
 *
 * The client runs with `prepare: false` (Supabase's pooler can't do prepared
 * statements — see src/db/index.ts), and without prepared-statement type OIDs
 * postgres-js never applies its JSON parser. Everything reading a jsonb column
 * must go through this, or you end up spreading a string's characters.
 */
function asJson<T>(v: unknown, fallback: T): T {
  if (v == null) return fallback;
  if (typeof v === "string") {
    try {
      return JSON.parse(v) as T;
    } catch {
      return fallback;
    }
  }
  return v as T;
}

export type MfAssumptions = Pick<
  MultiFamilyInputs,
  "otherIncome" | "opex" | "vacancy" | "assetManagementFeePct" | "ozPartnershipExpenses" | "exit" | "sellOut"
>;

export type MfDeal = {
  id: string;
  name: string;
  address: string | null;
  city: string | null;
  state: string | null;
  gross_sqft: number | null;
  commercial_sqft: number | null;
  height_stories: number | null;
  garage_spaces: number | null;
  surface_spaces: number | null;
  storage_spaces: number | null;
  total_project_cost: number;
  assumptions: MfAssumptions;
  cost_program: CostProgram;
  line_details: LineDetails;
  notes: string | null;
  updated_at: string;
};

export type MfUnitType = {
  id: string;
  tier: "market" | "affordable";
  label: string;
  unit_count: number;
  rent_monthly: number;
  sqft: number;
  sell_price: number | null;
  /** Hard cost $/SF for this product. null = follow the cost program's rate. */
  cost_per_sf: number | null;
  /** Net-to-gross divisor. null = follow the program; 1 = no grossing. */
  gross_factor: number | null;
  /** 'sell' | 'hold'. null everywhere = prorate by shareSold. */
  disposition: "sell" | "hold" | null;
  sort_order: number;
};

export type MfComp = {
  id: string;
  kind: "rent" | "sale";
  property_name: string | null;
  address: string | null;
  city: string | null;
  year_built: number | null;
  units: number | null;
  distance_mi: number | null;
  detail: { label: string; count: number | null; sqft: number | null; rent: number | null; price: number | null }[];
  source: string | null;
  ai_generated: boolean;
  confirmed: boolean;
  note: string | null;
};

/**
 * The Avon deal's assumptions, used as the starting point for a new deal.
 *
 * These are a real institutional underwrite, not invented placeholders — which
 * makes them a defensible default, but they are still SOMEONE ELSE'S DEAL. Taxes
 * per unit especially are Avon-specific. Change them per deal.
 */
export const DEFAULT_ASSUMPTIONS: MfAssumptions = {
  otherIncome: {
    commercialSqft: 0,
    commercialRentPerSfYear: 25,
    garageSpaces: 0,
    garageRentMonthly: 150,
    surfaceSpaces: 0,
    surfaceRentMonthly: 0,
    storageSpaces: 0,
    storageRentMonthly: 35,
    grabAndGoPerUnitMonthly: 20,
    wifiPerUnitMonthly: 25,
    petSharePct: 0.4,
    petRentMonthly: 25,
    utilityBillbackPerUnitYear: 400,
    miscPerUnitYear: 250,
  },
  opex: {
    utilitiesPerUnit: 900,
    makeReadyPerUnit: 350,
    marketingPerUnit: 400,
    repairsPerUnit: 600,
    contractServicesPerUnit: 0,
    generalAdminPerUnit: 200,
    insurancePerUnit: 900,
    taxesPerUnit: 5010,
    reservesPerUnit: 250,
    payrollSalaries: [
      { role: "Property Manager", salary: 100000 },
      { role: "Asst. Property Manager", salary: 60000 },
      { role: "Maintenance Supervisor", salary: 75000 },
      { role: "Maintenance Tech", salary: 0 },
    ],
    payrollBurdenPct: 0.35,
    managementFeePctOfResidentialEgi: 0.03,
  },
  vacancy: { residentialPct: 0.05, commercialPct: 0.05 },
  assetManagementFeePct: 0.015,
  ozPartnershipExpenses: 0,
  exit: { capRate: 0.055, saleCostPct: 0 },
  sellOut: { saleCostPct: 0.05, shareSold: 0 },
};

export type MfDealSummary = {
  id: string;
  name: string;
  city: string | null;
  units: number;
  total_project_cost: number;
  updated_at: string;
  /** Null when you own it; the owner's name when it was shared with you. */
  shared_by: string | null;
  role: "owner" | "editor" | "viewer";
};

/**
 * Every deal the caller can open — the ones they own, plus the ones shared with
 * them by email. `shared_by` is null on their own deals and names the owner on
 * the rest, so the list can label them without a second query.
 */
export async function listMfDeals(user: { id: string; email: string | null }): Promise<MfDealSummary[]> {
  const email = user.email?.trim().toLowerCase() ?? null;
  return sql<MfDealSummary[]>`
    select d.id, d.name, d.city, d.total_project_cost, d.updated_at,
           coalesce((select sum(u.unit_count) from feasible.mf_unit_types u where u.deal_id = d.id), 0)::int as units,
           case when d.owner_id = ${user.id} then null
                else coalesce(p.full_name, p.email) end as shared_by,
           case when d.owner_id = ${user.id} then 'owner' else a.role end as role
    from feasible.mf_deals d
    left join feasible.mf_deal_access a
      on a.deal_id = d.id
     and ${email}::text is not null
     and lower(a.email) = ${email}
    left join feasible.profiles p on p.id = d.owner_id
    where d.owner_id = ${user.id} or a.id is not null
    order by d.updated_at desc`;
}

export async function createMfDeal(ownerId: string, name: string, city: string | null): Promise<string> {
  const [row] = await sql<{ id: string }[]>`
    insert into feasible.mf_deals (owner_id, name, city, assumptions, cost_program)
    values (${ownerId}, ${name}, ${city},
            ${JSON.stringify(DEFAULT_ASSUMPTIONS)}::jsonb,
            ${JSON.stringify(DEFAULT_COST_PROGRAM)}::jsonb)
    returning id`;
  // A deal with no mix can't be underwritten, so seed the shape the model expects.
  await sql`
    insert into feasible.mf_unit_types (deal_id, tier, label, unit_count, rent_monthly, sqft, sort_order)
    values
      (${row.id}, 'market', '1 Bed', 0, 0, 700, 1),
      (${row.id}, 'market', '2 Bed', 0, 0, 1000, 2),
      (${row.id}, 'market', '3 Bed', 0, 0, 1225, 3)`;
  return row.id;
}

/**
 * Load a deal the caller is allowed to see.
 *
 * Access is resolved by `dealRole` (src/lib/mf-access.ts) rather than an
 * owner_id comparison here, because a deal can now be shared. The resolved role
 * comes back with the deal so the page can render read-only for a viewer — and
 * so no caller has to ask a second time and risk asking differently.
 */
export async function loadMfDeal(
  user: SessionUser,
  id: string,
): Promise<{ deal: MfDeal; units: MfUnitType[]; comps: MfComp[]; role: DealRole } | null> {
  const role = await dealRole(user, id);
  if (!canRead(role)) return null;

  const [deal] = await sql<MfDeal[]>`
    select id, name, address, city, state, gross_sqft, commercial_sqft, height_stories,
           garage_spaces, surface_spaces, storage_spaces,
           total_project_cost, assumptions, cost_program, line_details, notes, updated_at
    from feasible.mf_deals
    where id = ${id}`;
  if (!deal) return null;

  const units = await sql<MfUnitType[]>`
    select id, tier, label, unit_count, rent_monthly, sqft, sell_price,
           cost_per_sf, gross_factor, disposition, sort_order
    from feasible.mf_unit_types
    where deal_id = ${id}
    order by tier, sort_order, label`;

  const comps = await sql<MfComp[]>`
    select id, kind, property_name, address, city, year_built, units, distance_mi,
           detail, source, ai_generated, confirmed, note
    from feasible.mf_comps
    where deal_id = ${id}
    order by kind, confirmed desc, created_at desc`;

  // A deal saved before the cost program existed comes back as {} — merging over
  // the defaults means it opens with a working budget instead of a page of zeros,
  // and its underwrite is unchanged because useComputed only takes effect once
  // there is something to compute.
  const stored = asJson<Partial<CostProgram>>(deal.cost_program, {});
  const cost_program: CostProgram = {
    ...DEFAULT_COST_PROGRAM,
    ...stored,
    parking: { ...DEFAULT_COST_PROGRAM.parking, ...(stored.parking ?? {}) },
  };
  // An old deal has a hand-typed total and no budget. Keep using that number until
  // the budget is actually built up, or the deal would silently reprice to ~$0.
  if (!Object.keys(stored).length) {
    cost_program.useComputed = false;
    cost_program.overrideTotal = Number(deal.total_project_cost ?? 0);
  }

  return {
    deal: {
      ...deal,
      assumptions: asJson<MfAssumptions>(deal.assumptions, DEFAULT_ASSUMPTIONS),
      cost_program,
      line_details: asJson<LineDetails>(deal.line_details, {}),
    },
    units,
    comps: comps.map((c) => ({ ...c, detail: asJson<MfComp["detail"]>(c.detail, []) })),
    role: role as DealRole,
  };
}

/** Numerics arrive from postgres-js as strings; the engine wants numbers. */
export const toUnitInputs = (rows: MfUnitType[], tier: "market" | "affordable"): UnitTypeInput[] =>
  rows
    .filter((u) => u.tier === tier)
    .map((u) => ({
      label: u.label,
      count: Number(u.unit_count),
      rentMonthly: Number(u.rent_monthly),
      sqft: Number(u.sqft),
      sellPrice: u.sell_price != null ? Number(u.sell_price) : undefined,
      disposition: u.disposition ?? undefined,
    }));
