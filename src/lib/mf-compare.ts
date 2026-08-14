import "server-only";
import { underwrite } from "@/lib/multifamily";
import { buildCost } from "@/lib/mf-costs";
import { toUnitInputs } from "@/lib/mf-queries";
import type { ScenarioInputs } from "@/lib/mf-scenarios";

/**
 * COMPARING SCENARIOS.
 *
 * Metrics are RECOMPUTED from each scenario's stored inputs rather than cached
 * on the row. Two reasons: a cached number goes stale the moment the engine
 * changes, and a comparison built from stale figures is worse than no comparison
 * — it looks authoritative and disagrees with the deal page. The engine is pure
 * and takes about a millisecond, so there is nothing to save by caching.
 */

export type ScenarioMetrics = {
  id: string;
  name: string;
  note: string | null;

  // The bottom line
  profit: number;
  profitMargin: number;
  totalValue: number;
  designated: boolean;
  unitsSold: number;
  unitsHeld: number;
  soldNet: number;
  heldValue: number;
  /** What the deal page calls it: "Blend", "Build to Rent", "Sell Out". */
  best: string;

  // Cost basis
  totalCost: number;
  costPerUnit: number;
  costPerNetSqft: number;
  hardCost: number;

  // Income & yield
  noi: number;
  egi: number;
  expenseRatio: number;
  yieldOnCost: number;
  developmentSpreadBps: number;

  // Scale, for context
  totalUnits: number;
  netSqft: number;
};

export function scenarioMetrics(s: ScenarioInputs): ScenarioMetrics {
  const marketUnits = toUnitInputs(s.units, "market");
  const affordableUnits = toUnitInputs(s.units, "affordable");
  const allUnits = [...marketUnits, ...affordableUnits];

  const build = buildCost({
    program: s.cost_program,
    mix: s.units.map((u) => ({
      label: u.label,
      count: Number(u.unit_count),
      sqft: Number(u.sqft),
      costPerSf: u.cost_per_sf != null ? Number(u.cost_per_sf) : null,
      grossFactor: u.gross_factor != null ? Number(u.gross_factor) : null,
    })),
    commercialSqft: s.commercial_sqft,
  });

  const r = underwrite({
    marketUnits,
    affordableUnits,
    otherIncome: { ...s.assumptions.otherIncome, commercialSqft: s.commercial_sqft },
    opex: s.assumptions.opex,
    vacancy: s.assumptions.vacancy,
    assetManagementFeePct: s.assumptions.assetManagementFeePct,
    ozPartnershipExpenses: s.assumptions.ozPartnershipExpenses,
    exit: s.assumptions.exit,
    sellOut: s.assumptions.sellOut,
    totalProjectCost: build.effectiveTotal,
    lineDetails: s.line_details,
  });

  const ex = r.exit;
  const totalUnits = allUnits.reduce((a, u) => a + u.count, 0);

  return {
    id: s.id,
    name: s.name,
    note: s.note,

    profit: ex.recommendation.profit,
    profitMargin: ex.designated ? ex.blend.profitMargin : bestMargin(ex),
    totalValue: ex.designated ? ex.blend.totalValue : bestValue(ex),
    designated: !!ex.designated,
    unitsSold: ex.portions?.sold.units ?? 0,
    unitsHeld: ex.portions?.held.units ?? 0,
    soldNet: ex.portions?.sold.netProceeds ?? 0,
    heldValue: ex.portions?.held.netValue ?? 0,
    best: ex.recommendation.best,

    totalCost: build.effectiveTotal,
    costPerUnit: build.costPerUnit,
    costPerNetSqft: build.costPerNetSqft,
    hardCost: build.hardCost,

    noi: r.proforma.noi,
    egi: r.proforma.egiTotal,
    expenseRatio: r.proforma.expenseRatio,
    yieldOnCost: ex.btr.returnOnCost,
    developmentSpreadBps: ex.btr.developmentSpreadBps,

    totalUnits,
    netSqft: allUnits.reduce((a, u) => a + u.count * u.sqft, 0),
  };
}

const bestMargin = (ex: ReturnType<typeof underwrite>["exit"]): number =>
  ex.recommendation.best === "Sell Out"
    ? ex.sellOut.profitMargin
    : ex.recommendation.best === "Blend"
      ? ex.blend.profitMargin
      : ex.btr.profitMargin;

const bestValue = (ex: ReturnType<typeof underwrite>["exit"]): number =>
  ex.recommendation.best === "Sell Out"
    ? ex.sellOut.netProceeds
    : ex.recommendation.best === "Blend"
      ? ex.blend.totalValue
      : ex.btr.netValue;

// ---------------------------------------------------------------------------
// What actually differs
// ---------------------------------------------------------------------------

export type DiffRow = {
  label: string;
  /** One entry per scenario, in the same order they were passed. */
  values: (string | number | null)[];
  /** Formatting hint for the cell. */
  kind: "money" | "pct" | "number" | "text";
};

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * The rows where the scenarios DISAGREE — the answer to "why are these numbers
 * different", rather than "that they are".
 *
 * Rows that are identical everywhere are dropped, because a diff that lists
 * ninety unchanged assumptions hides the three that moved. With only one
 * scenario there is nothing to differ from, so the result is empty.
 */
export function assumptionDiff(scenarios: ScenarioInputs[]): DiffRow[] {
  if (scenarios.length < 2) return [];

  const rows: DiffRow[] = [];
  const push = (label: string, kind: DiffRow["kind"], pick: (s: ScenarioInputs) => string | number | null) => {
    const values = scenarios.map(pick);
    const first = JSON.stringify(values[0]);
    if (values.every((v) => JSON.stringify(v) === first)) return; // identical everywhere
    rows.push({ label, values, kind });
  };

  // --- Exit and sell-out ---------------------------------------------------
  push("Exit cap rate", "pct", (s) => s.assumptions.exit.capRate);
  push("Asset sale costs", "pct", (s) => s.assumptions.exit.saleCostPct);
  push("Unit selling costs", "pct", (s) => s.assumptions.sellOut.saleCostPct);
  push("Share sold (prorated deals)", "pct", (s) => s.assumptions.sellOut.shareSold);

  // --- Vacancy and fees ----------------------------------------------------
  push("Residential vacancy", "pct", (s) => s.assumptions.vacancy.residentialPct);
  push("Commercial vacancy", "pct", (s) => s.assumptions.vacancy.commercialPct);
  push("Asset management fee", "pct", (s) => s.assumptions.assetManagementFeePct);

  // --- Operating expenses, per unit ---------------------------------------
  const opex: [string, keyof ScenarioInputs["assumptions"]["opex"]][] = [
    ["Utilities / unit", "utilitiesPerUnit"],
    ["Make ready / unit", "makeReadyPerUnit"],
    ["Marketing / unit", "marketingPerUnit"],
    ["Repairs / unit", "repairsPerUnit"],
    ["Contract services / unit", "contractServicesPerUnit"],
    ["G&A / unit", "generalAdminPerUnit"],
    ["Insurance / unit", "insurancePerUnit"],
    ["Taxes / unit", "taxesPerUnit"],
    ["Reserves / unit", "reservesPerUnit"],
  ];
  for (const [label, key] of opex) {
    push(label, "money", (s) => Number(s.assumptions.opex[key] ?? 0));
  }
  push("Payroll burden", "pct", (s) => s.assumptions.opex.payrollBurdenPct);
  push("Management fee (resi EGI)", "pct", (s) => s.assumptions.opex.managementFeePctOfResidentialEgi);
  push("Payroll salaries", "money", (s) =>
    s.assumptions.opex.payrollSalaries.reduce((a, x) => a + Number(x.salary || 0), 0),
  );

  // --- Cost program --------------------------------------------------------
  push("Finish level", "text", (s) => s.cost_program.finishLevel ?? null);
  push("Residential $/SF", "money", (s) => s.cost_program.residentialCostPerSf ?? null);
  push("Circulation efficiency", "pct", (s) => s.cost_program.circulationEfficiency ?? null);
  push("Soft costs", "pct", (s) => s.cost_program.softCostPct ?? null);
  push("Contingency", "pct", (s) => s.cost_program.contingencyPct ?? null);
  push("Developer fee", "pct", (s) => s.cost_program.developerFeePct ?? null);
  push("Land cost", "money", (s) => s.cost_program.landCost ?? null);
  push("Commercial SF", "number", (s) => s.commercial_sqft);

  // --- The mix, line by line ----------------------------------------------
  // Union of every label across every scenario, so a type that exists in only
  // one case still shows up (as "—" in the others) rather than vanishing.
  const labels: string[] = [];
  for (const s of scenarios) {
    for (const u of s.units) if (!labels.includes(u.label)) labels.push(u.label);
  }
  for (const label of labels) {
    const find = (s: ScenarioInputs) => s.units.find((u) => u.label === label);
    push(`${label} — units`, "number", (s) => (find(s) ? Number(find(s)!.unit_count) : null));
    push(`${label} — rent/mo`, "money", (s) => (find(s) ? Number(find(s)!.rent_monthly) : null));
    push(`${label} — SF`, "number", (s) => (find(s) ? Number(find(s)!.sqft) : null));
    push(`${label} — sale price`, "money", (s) => {
      const u = find(s);
      return u?.sell_price != null ? Number(u.sell_price) : null;
    });
    push(`${label} — cost $/SF`, "money", (s) => {
      const u = find(s);
      return u?.cost_per_sf != null ? Number(u.cost_per_sf) : null;
    });
    push(`${label} — exit`, "text", (s) => find(s)?.disposition ?? "prorate");
  }

  return rows;
}

export const fmt = (v: string | number | null, kind: DiffRow["kind"]): string => {
  if (v == null) return "—";
  if (typeof v === "string") return v;
  if (kind === "money") return money(v);
  if (kind === "pct") return `${(v * 100).toFixed(2)}%`;
  return Math.round(v).toLocaleString("en-US");
};
