import "server-only";
import { sql } from "@/db";
import { DEFAULT_COST_PROGRAM, type CostProgram } from "@/lib/mf-costs";
import type { LineDetails } from "@/lib/multifamily";
import { DEFAULT_ASSUMPTIONS, asJson, type MfAssumptions, type MfUnitType } from "@/lib/mf-queries";

/**
 * SCENARIOS — the cases you are comparing on one deal.
 *
 * A scenario owns every input the underwriter edits: the property figures, the
 * assumptions, the cost program, the proforma line details, and the unit mix
 * (mf_unit_types.scenario_id). The deal owns what is true regardless of which
 * case you are looking at — address, comps, and who it is shared with.
 *
 * Every deal has at least one. `mf_deals.active_scenario_id` is the one the
 * editor opens, and `ensureActiveScenario` guarantees it exists rather than
 * making every caller handle a deal that somehow has none.
 */

export type ScenarioSummary = {
  id: string;
  name: string;
  note: string | null;
  sort_order: number;
  created_at: string;
  updated_at: string;
  is_active: boolean;
};

/** A scenario's full input set — everything needed to re-run the engine. */
export type ScenarioInputs = {
  id: string;
  name: string;
  note: string | null;
  gross_sqft: number;
  commercial_sqft: number;
  height_stories: number;
  garage_spaces: number;
  surface_spaces: number;
  storage_spaces: number;
  total_project_cost: number;
  assumptions: MfAssumptions;
  cost_program: CostProgram;
  line_details: LineDetails;
  units: MfUnitType[];
};

export async function listScenarios(dealId: string): Promise<ScenarioSummary[]> {
  return sql<ScenarioSummary[]>`
    select s.id, s.name, s.note, s.sort_order, s.created_at, s.updated_at,
           (d.active_scenario_id = s.id) as is_active
    from feasible.mf_scenarios s
    join feasible.mf_deals d on d.id = s.deal_id
    where s.deal_id = ${dealId}
    order by s.sort_order, s.created_at`;
}

/**
 * The active scenario's id, creating one if the deal somehow has none.
 *
 * A deal with no scenario is only reachable by deleting the last one, which the
 * UI forbids — but a null here would be an unopenable deal, so it self-heals
 * instead of throwing.
 */
export async function ensureActiveScenario(dealId: string): Promise<string> {
  const [row] = await sql<{ active_scenario_id: string | null }[]>`
    select active_scenario_id from feasible.mf_deals where id = ${dealId}`;
  if (row?.active_scenario_id) return row.active_scenario_id;

  const [existing] = await sql<{ id: string }[]>`
    select id from feasible.mf_scenarios where deal_id = ${dealId}
    order by sort_order, created_at limit 1`;
  if (existing) {
    await sql`update feasible.mf_deals set active_scenario_id = ${existing.id} where id = ${dealId}`;
    return existing.id;
  }

  const [created] = await sql<{ id: string }[]>`
    insert into feasible.mf_scenarios (deal_id, name, assumptions, cost_program)
    values (${dealId}, 'Base case',
            ${JSON.stringify(DEFAULT_ASSUMPTIONS)}::jsonb,
            ${JSON.stringify(DEFAULT_COST_PROGRAM)}::jsonb)
    returning id`;
  await sql`update feasible.mf_deals set active_scenario_id = ${created.id} where id = ${dealId}`;
  return created.id;
}

/** Hydrate one scenario's inputs, JSONB parsed and defaults merged. */
export async function loadScenario(scenarioId: string): Promise<ScenarioInputs | null> {
  const [s] = await sql<Record<string, unknown>[]>`
    select id, name, note, gross_sqft, commercial_sqft, height_stories,
           garage_spaces, surface_spaces, storage_spaces, total_project_cost,
           assumptions, cost_program, line_details
    from feasible.mf_scenarios where id = ${scenarioId}`;
  if (!s) return null;

  const units = await sql<MfUnitType[]>`
    select id, tier, label, unit_count, rent_monthly, sqft, sell_price,
           cost_per_sf, gross_factor, disposition, sort_order
    from feasible.mf_unit_types
    where scenario_id = ${scenarioId}
    order by tier, sort_order, label`;

  // Same merge loadMfDeal used to do: a scenario saved before the cost program
  // existed comes back as {} and must open with a working budget, still priced
  // off its hand-typed total rather than silently repricing to ~$0.
  const storedProgram = asJson<Partial<CostProgram>>(s.cost_program, {});
  const cost_program: CostProgram = {
    ...DEFAULT_COST_PROGRAM,
    ...storedProgram,
    parking: { ...DEFAULT_COST_PROGRAM.parking, ...(storedProgram.parking ?? {}) },
  };
  if (!Object.keys(storedProgram).length) {
    cost_program.useComputed = false;
    cost_program.overrideTotal = Number(s.total_project_cost ?? 0);
  }

  const n = (v: unknown) => Number(v ?? 0);
  return {
    id: String(s.id),
    name: String(s.name),
    note: (s.note as string | null) ?? null,
    gross_sqft: n(s.gross_sqft),
    commercial_sqft: n(s.commercial_sqft),
    height_stories: n(s.height_stories),
    garage_spaces: n(s.garage_spaces),
    surface_spaces: n(s.surface_spaces),
    storage_spaces: n(s.storage_spaces),
    total_project_cost: n(s.total_project_cost),
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...asJson<MfAssumptions>(s.assumptions, DEFAULT_ASSUMPTIONS) },
    cost_program,
    line_details: asJson<LineDetails>(s.line_details, {}),
    units,
  };
}

/** Every scenario on a deal, hydrated — the comparison reads this. */
export async function loadAllScenarios(dealId: string): Promise<ScenarioInputs[]> {
  const rows = await listScenarios(dealId);
  const out: ScenarioInputs[] = [];
  for (const r of rows) {
    const s = await loadScenario(r.id);
    if (s) out.push(s);
  }
  return out;
}

/**
 * Fork a scenario, unit mix and all.
 *
 * Copying is the point: a new case starts from the one you were just looking at,
 * so you change the two things you meant to change instead of re-entering forty
 * numbers. A blank scenario would be a worse default and is not offered.
 */
export async function duplicateScenario(
  dealId: string,
  sourceId: string,
  name: string,
): Promise<string> {
  const [next] = await sql<{ n: number }[]>`
    select coalesce(max(sort_order), 0) + 1 as n from feasible.mf_scenarios where deal_id = ${dealId}`;

  const [copy] = await sql<{ id: string }[]>`
    insert into feasible.mf_scenarios (
      deal_id, name, note, gross_sqft, commercial_sqft, height_stories,
      garage_spaces, surface_spaces, storage_spaces, total_project_cost,
      assumptions, cost_program, line_details, sort_order)
    select deal_id, ${name}, note, gross_sqft, commercial_sqft, height_stories,
           garage_spaces, surface_spaces, storage_spaces, total_project_cost,
           assumptions, cost_program, line_details, ${next?.n ?? 1}
    from feasible.mf_scenarios
    where id = ${sourceId} and deal_id = ${dealId}
    returning id`;
  if (!copy) throw new Error("Scenario not found on this deal.");

  await sql`
    insert into feasible.mf_unit_types
      (scenario_id, tier, label, unit_count, rent_monthly, sqft, sell_price,
       cost_per_sf, gross_factor, disposition, sort_order)
    select ${copy.id}, tier, label, unit_count, rent_monthly, sqft, sell_price,
           cost_per_sf, gross_factor, disposition, sort_order
    from feasible.mf_unit_types
    where scenario_id = ${sourceId}`;

  return copy.id;
}

export async function renameScenario(dealId: string, scenarioId: string, name: string, note: string | null) {
  await sql`
    update feasible.mf_scenarios
       set name = ${name}, note = ${note}, updated_at = now()
     where id = ${scenarioId} and deal_id = ${dealId}`;
}

export async function setActiveScenario(dealId: string, scenarioId: string) {
  // Scoped to the deal so a scenario id from another deal can't be activated.
  await sql`
    update feasible.mf_deals d
       set active_scenario_id = ${scenarioId}
     where d.id = ${dealId}
       and exists (select 1 from feasible.mf_scenarios s
                    where s.id = ${scenarioId} and s.deal_id = ${dealId})`;
}

/**
 * Delete a scenario. Refuses the last one — a deal with no scenario has no
 * inputs and cannot be opened. If the deleted scenario was active, the oldest
 * survivor takes over so the editor always has somewhere to land.
 */
export async function deleteScenario(dealId: string, scenarioId: string): Promise<{ error?: string }> {
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from feasible.mf_scenarios where deal_id = ${dealId}`;
  if (n <= 1) return { error: "A deal needs at least one scenario." };

  await sql`delete from feasible.mf_scenarios where id = ${scenarioId} and deal_id = ${dealId}`;
  // active_scenario_id is ON DELETE SET NULL, so this repoints it when needed.
  await ensureActiveScenario(dealId);
  return {};
}
