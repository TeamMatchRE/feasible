/**
 * Large multi-family underwriting.
 *
 * The structure follows the Procopio Companies model David's partners use in Boston
 * (26 W. Main St., Avon CT — 130 units), reverse-engineered from their workbook and
 * then RE-DERIVED here rather than ported. `scripts/verify-multifamily.ts` runs the
 * Avon deal through this engine and diffs every line against their own cached
 * outputs, so a drift shows up as a dollar delta instead of a silent disagreement.
 *
 * Vocabulary is theirs on purpose — an underwriter reading Feasible next to the
 * workbook should see the same words in the same order.
 *
 * WHAT THIS ANSWERS: build-to-rent (hold the stabilized asset), sell out (sell the
 * finished units), or a blend. Those are three different exits off ONE cost basis
 * and ONE unit mix, which is why they're computed together instead of in isolation.
 */

// ---------------------------------------------------------------------------
// Inputs
// ---------------------------------------------------------------------------

/** One line of the unit mix. Market-rate and affordable tiers use the same shape. */
export type UnitTypeInput = {
  /** "1 Bed", "2 Bed", "Studio", "3 Bed"… free text so an odd mix isn't forced into a taxonomy. */
  label: string;
  count: number;
  /** Monthly asking rent per unit. */
  rentMonthly: number;
  /** Average net square feet of the unit. */
  sqft: number;
  /** For-sale price per unit, when this type is sold rather than held. */
  sellPrice?: number;
};

export type OtherIncomeInput = {
  /** Commercial is quoted ANNUAL $/SF (the one annual figure in the model). */
  commercialSqft: number;
  commercialRentPerSfYear: number;
  /** Everything below is quoted MONTHLY. */
  garageSpaces: number;
  garageRentMonthly: number;
  surfaceSpaces: number;
  surfaceRentMonthly: number;
  storageSpaces: number;
  storageRentMonthly: number;
  /** Per-unit amenity income, monthly. */
  grabAndGoPerUnitMonthly: number;
  wifiPerUnitMonthly: number;
  /** Pet income: share of units with a pet × monthly pet rent. */
  petSharePct: number;
  petRentMonthly: number;
  /** Per-unit, ANNUAL. */
  utilityBillbackPerUnitYear: number;
  miscPerUnitYear: number;
};

export type OpexInput = {
  /** Per-unit annual figures — how the model actually budgets these. */
  utilitiesPerUnit: number;
  makeReadyPerUnit: number;
  marketingPerUnit: number;
  repairsPerUnit: number;
  contractServicesPerUnit: number;
  generalAdminPerUnit: number;
  insurancePerUnit: number;
  taxesPerUnit: number;
  reservesPerUnit: number;
  /** Payroll is built from salaries + a burden load, not a per-unit guess. */
  payrollSalaries: { role: string; salary: number }[];
  payrollBurdenPct: number;
  /** Management fee is a % of RESIDENTIAL EGI (not total EGI). */
  managementFeePctOfResidentialEgi: number;
};

export type MultiFamilyInputs = {
  marketUnits: UnitTypeInput[];
  affordableUnits: UnitTypeInput[];
  otherIncome: OtherIncomeInput;
  opex: OpexInput;
  vacancy: { residentialPct: number; commercialPct: number };
  /** Off NOI, before the capitalized value. */
  assetManagementFeePct: number;
  ozPartnershipExpenses: number;
  /** Total development cost. Either a single number or the summed budget. */
  totalProjectCost: number;
  exit: {
    /** Merchant-build / stabilized sale cap rate. */
    capRate: number;
    /** Cost of selling the stabilized asset (broker, legal, transfer) as % of value. */
    saleCostPct: number;
  };
  /** Sell-out (condo) assumptions, used by the sell-out and blended exits. */
  sellOut: {
    /** Selling costs per unit as % of price — commission, transfer, legal, marketing. */
    saleCostPct: number;
    /** Share of units sold rather than held, 0–1. 0 = pure BTR, 1 = pure sell out. */
    shareSold: number;
  };
};

// ---------------------------------------------------------------------------
// Outputs
// ---------------------------------------------------------------------------

export type UnitMixSummary = {
  rows: (UnitTypeInput & { mixPct: number; annualRent: number; totalSqft: number; rentPerSf: number })[];
  totalUnits: number;
  totalSqft: number;
  avgRent: number;
  avgSqft: number;
  avgRentPerSf: number;
  annualRent: number;
};

export type Proforma = {
  /** Income */
  baseRentalIncome: number;
  parking: number;
  storage: number;
  petIncome: number;
  utilityBillback: number;
  grabAndGo: number;
  wifi: number;
  miscIncome: number;
  grossResidentialIncome: number;
  residentialVacancy: number;
  egiResidential: number;
  commercialIncome: number;
  commercialVacancy: number;
  egiCommercial: number;
  egiTotal: number;
  /** Expenses */
  expenses: { label: string; amount: number }[];
  totalExpenses: number;
  /**
   * Total expenses ÷ TOTAL EGI. The defensible one: the numerator pays for the whole
   * building — taxes, insurance, payroll all cover the commercial space too — so the
   * denominator has to include the commercial income those dollars help earn.
   */
  expenseRatio: number;
  /**
   * Total expenses ÷ RESIDENTIAL EGI — the Procopio workbook's convention, kept so the
   * two models reconcile line for line.
   *
   * It runs HIGH on any deal with commercial income (32.34% vs 30.99% on Avon) because
   * whole-building costs are divided by residential-only revenue. Harmless as a
   * reported statistic; NOT safe as a driver — applying 32.34% to total EGI to forecast
   * expenses overstates them by ~$69k/yr on this deal, which is ~$1.26M of value at a
   * 5.5% cap. Report it, don't underwrite off it.
   */
  expenseRatioOnResidentialEgi: number;
  /** Result */
  noi: number;
  assetManagementFee: number;
  ozPartnershipExpenses: number;
  adjustedNoi: number;
};

export type ExitAnalysis = {
  /** BUILD TO RENT — capitalize the stabilized NOI. */
  btr: {
    grossValue: number;
    saleCosts: number;
    netValue: number;
    valuePerUnit: number;
    profit: number;
    /** Return on cost (yield on cost): NOI ÷ total project cost. */
    returnOnCost: number;
    /** Spread between yield-on-cost and the exit cap — the developer's margin. */
    developmentSpreadBps: number;
    profitMargin: number;
  };
  /** SELL OUT — sell the finished units individually. */
  sellOut: {
    grossProceeds: number;
    saleCosts: number;
    netProceeds: number;
    proceedsPerUnit: number;
    profit: number;
    profitMargin: number;
    /** True when no unit has a sale price set — the number is meaningless, not zero. */
    priced: boolean;
  };
  /** BLEND — sell a share, hold the rest. */
  blend: {
    shareSold: number;
    unitsSold: number;
    unitsHeld: number;
    sellOutNetProceeds: number;
    heldNoi: number;
    heldNetValue: number;
    totalValue: number;
    profit: number;
    profitMargin: number;
  };
  /** Which exit wins on profit, and by how much. */
  recommendation: {
    best: "Build to Rent" | "Sell Out" | "Blend";
    profit: number;
    /** Margin over the runner-up. A thin margin means the decision isn't really made by the model. */
    overRunnerUp: number;
    note: string;
  };
};

export type MultiFamilyResult = {
  marketMix: UnitMixSummary;
  affordableMix: UnitMixSummary;
  totalMix: UnitMixSummary;
  proforma: Proforma;
  totalProjectCost: number;
  costPerUnit: number;
  exit: ExitAnalysis;
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const MONTHS = 12;
const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

export function summarizeMix(units: UnitTypeInput[]): UnitMixSummary {
  const totalUnits = sum(units.map((u) => u.count));
  const totalSqft = sum(units.map((u) => u.count * u.sqft));
  const annualRent = sum(units.map((u) => u.count * u.rentMonthly * MONTHS));
  const rows = units.map((u) => ({
    ...u,
    mixPct: safeDiv(u.count, totalUnits),
    annualRent: u.count * u.rentMonthly * MONTHS,
    totalSqft: u.count * u.sqft,
    rentPerSf: safeDiv(u.rentMonthly, u.sqft),
  }));
  // Weighted by unit count — a simple average of the type rows would misprice a lopsided mix.
  const avgRent = safeDiv(sum(units.map((u) => u.count * u.rentMonthly)), totalUnits);
  const avgSqft = safeDiv(totalSqft, totalUnits);
  return {
    rows,
    totalUnits,
    totalSqft,
    avgRent,
    avgSqft,
    avgRentPerSf: safeDiv(avgRent, avgSqft),
    annualRent,
  };
}

export function buildProforma(i: MultiFamilyInputs): Proforma {
  const market = summarizeMix(i.marketUnits);
  const affordable = summarizeMix(i.affordableUnits);
  const units = market.totalUnits + affordable.totalUnits;
  const oi = i.otherIncome;

  const baseRentalIncome = market.annualRent + affordable.annualRent;
  const parking = (oi.garageSpaces * oi.garageRentMonthly + oi.surfaceSpaces * oi.surfaceRentMonthly) * MONTHS;
  const storage = oi.storageSpaces * oi.storageRentMonthly * MONTHS;
  const petIncome = units * oi.petSharePct * oi.petRentMonthly * MONTHS;
  const utilityBillback = units * oi.utilityBillbackPerUnitYear;
  const grabAndGo = units * oi.grabAndGoPerUnitMonthly * MONTHS;
  const wifi = units * oi.wifiPerUnitMonthly * MONTHS;
  const miscIncome = units * oi.miscPerUnitYear;

  const grossResidentialIncome =
    baseRentalIncome + parking + storage + petIncome + utilityBillback + grabAndGo + wifi + miscIncome;
  const residentialVacancy = -grossResidentialIncome * i.vacancy.residentialPct;
  const egiResidential = grossResidentialIncome + residentialVacancy;

  // Commercial is the one annual-quoted line, and it carries its own vacancy factor —
  // a retail bay goes dark differently than an apartment does.
  const commercialIncome = oi.commercialSqft * oi.commercialRentPerSfYear;
  const commercialVacancy = -commercialIncome * i.vacancy.commercialPct;
  const egiCommercial = commercialIncome + commercialVacancy;

  const egiTotal = egiResidential + egiCommercial;

  const o = i.opex;
  const payroll = sum(o.payrollSalaries.map((p) => p.salary)) * (1 + o.payrollBurdenPct);
  const managementFee = egiResidential * o.managementFeePctOfResidentialEgi;

  const expenses: { label: string; amount: number }[] = [
    { label: "Utilities", amount: units * o.utilitiesPerUnit },
    { label: "Payroll", amount: payroll },
    { label: "Make Ready / Turnover", amount: units * o.makeReadyPerUnit },
    { label: "General Marketing", amount: units * o.marketingPerUnit },
    { label: "Repairs & Maintenance", amount: units * o.repairsPerUnit },
    { label: "Contract Services", amount: units * o.contractServicesPerUnit },
    { label: "General & Administrative", amount: units * o.generalAdminPerUnit },
    { label: "Insurance", amount: units * o.insurancePerUnit },
    { label: "Management Fee", amount: managementFee },
    { label: "Taxes", amount: units * o.taxesPerUnit },
    { label: "Reserves", amount: units * o.reservesPerUnit },
  ];
  const totalExpenses = sum(expenses.map((e) => e.amount));

  const noi = egiTotal - totalExpenses;
  const assetManagementFee = egiTotal * i.assetManagementFeePct;
  const adjustedNoi = noi - assetManagementFee - i.ozPartnershipExpenses;

  return {
    baseRentalIncome, parking, storage, petIncome, utilityBillback, grabAndGo, wifi, miscIncome,
    grossResidentialIncome, residentialVacancy, egiResidential,
    commercialIncome, commercialVacancy, egiCommercial, egiTotal,
    expenses, totalExpenses,
    expenseRatio: safeDiv(totalExpenses, egiTotal),
    expenseRatioOnResidentialEgi: safeDiv(totalExpenses, egiResidential),
    noi, assetManagementFee, ozPartnershipExpenses: i.ozPartnershipExpenses, adjustedNoi,
  };
}

/**
 * The three exits, off one cost basis.
 *
 * The model capitalizes NOI (not Adjusted NOI) for the untrended sell-out value — the
 * asset-management fee is a partnership expense, not a property expense, so a buyer
 * wouldn't underwrite it. Kept faithful to that.
 */
export function analyzeExits(i: MultiFamilyInputs, pf: Proforma, allUnits: UnitTypeInput[]): ExitAnalysis {
  const cost = i.totalProjectCost;
  const totalUnits = sum(allUnits.map((u) => u.count));

  // --- Build to rent -------------------------------------------------------
  const grossValue = safeDiv(pf.noi, i.exit.capRate);
  const btrSaleCosts = grossValue * i.exit.saleCostPct;
  const btrNet = grossValue - btrSaleCosts;
  const returnOnCost = safeDiv(pf.noi, cost);
  const btr = {
    grossValue,
    saleCosts: btrSaleCosts,
    netValue: btrNet,
    valuePerUnit: safeDiv(grossValue, totalUnits),
    profit: btrNet - cost,
    returnOnCost,
    // The spread is the whole game in merchant building: build at a yield above the
    // cap rate you exit at, and the difference is the profit.
    developmentSpreadBps: Math.round((returnOnCost - i.exit.capRate) * 10_000),
    profitMargin: safeDiv(btrNet - cost, cost),
  };

  // --- Sell out ------------------------------------------------------------
  // A unit with no sale price contributes nothing; if NOTHING is priced we say so
  // rather than reporting a confident $0.
  const priced = allUnits.some((u) => (u.sellPrice ?? 0) > 0);
  const grossProceeds = sum(allUnits.map((u) => u.count * (u.sellPrice ?? 0)));
  const sellCosts = grossProceeds * i.sellOut.saleCostPct;
  const netProceeds = grossProceeds - sellCosts;
  const sellOut = {
    grossProceeds,
    saleCosts: sellCosts,
    netProceeds,
    proceedsPerUnit: safeDiv(grossProceeds, totalUnits),
    profit: netProceeds - cost,
    profitMargin: safeDiv(netProceeds - cost, cost),
    priced,
  };

  // --- Blend ---------------------------------------------------------------
  // Sell a share of the units, hold the rest. The held portion keeps its share of NOI
  // and is capitalized; the sold portion returns cash at the unit prices. Cost is NOT
  // split — the whole project has to be paid for either way.
  const share = Math.min(Math.max(i.sellOut.shareSold, 0), 1);
  const unitsSold = totalUnits * share;
  const heldNoi = pf.noi * (1 - share);
  const heldGross = safeDiv(heldNoi, i.exit.capRate);
  const heldNet = heldGross - heldGross * i.exit.saleCostPct;
  const blendSellNet = netProceeds * share;
  const blendTotal = blendSellNet + heldNet;
  const blend = {
    shareSold: share,
    unitsSold,
    unitsHeld: totalUnits - unitsSold,
    sellOutNetProceeds: blendSellNet,
    heldNoi,
    heldNetValue: heldNet,
    totalValue: blendTotal,
    profit: blendTotal - cost,
    profitMargin: safeDiv(blendTotal - cost, cost),
  };

  // --- Which one -----------------------------------------------------------
  const options: { best: ExitAnalysis["recommendation"]["best"]; profit: number }[] = [
    { best: "Build to Rent", profit: btr.profit },
    ...(priced ? [{ best: "Sell Out" as const, profit: sellOut.profit }] : []),
    ...(priced && share > 0 && share < 1 ? [{ best: "Blend" as const, profit: blend.profit }] : []),
  ];
  options.sort((a, b) => b.profit - a.profit);
  const winner = options[0];
  const runnerUp = options[1];
  const overRunnerUp = runnerUp ? winner.profit - runnerUp.profit : 0;

  let note: string;
  if (!priced) {
    note = "No unit sale prices set — only the build-to-rent exit is priced. Add for-sale comps to compare.";
  } else if (runnerUp && Math.abs(overRunnerUp) < Math.abs(winner.profit) * 0.05) {
    // Inside 5% the ranking is noise against assumptions this soft.
    note = `${winner.best} leads by less than 5% — too close to call on the numbers alone. Decide on risk, timing and capital instead.`;
  } else {
    note = `${winner.best} produces the most profit on these assumptions.`;
  }

  return { btr, sellOut, blend, recommendation: { best: winner.best, profit: winner.profit, overRunnerUp, note } };
}

export function underwrite(i: MultiFamilyInputs): MultiFamilyResult {
  const marketMix = summarizeMix(i.marketUnits);
  const affordableMix = summarizeMix(i.affordableUnits);
  const allUnits = [...i.marketUnits, ...i.affordableUnits];
  const totalMix = summarizeMix(allUnits);
  const proforma = buildProforma(i);
  return {
    marketMix,
    affordableMix,
    totalMix,
    proforma,
    totalProjectCost: i.totalProjectCost,
    costPerUnit: safeDiv(i.totalProjectCost, totalMix.totalUnits),
    exit: analyzeExits(i, proforma, allUnits),
  };
}
