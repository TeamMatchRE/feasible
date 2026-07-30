/**
 * The cost side, checked by hand.
 *
 * Same discipline as multifamily.test.ts: every expected number below is derived
 * independently — on paper, from the stated rule — not read back out of the code.
 * A mismatch means one of the two is wrong and the delta says by how much.
 *
 * Run: npm test
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildCost,
  sizeParking,
  defaultRatioFor,
  suggestRoadLf,
  DEFAULT_COST_PROGRAM,
  FINISH_RATES,
  type CostProgram,
} from "./mf-costs";
import { underwrite, type MultiFamilyInputs, type LineDetails } from "./multifamily";

const near = (got: number, want: number, tol = 0.01) =>
  assert.ok(Math.abs(got - want) <= tol, `got ${got}, want ${want} (Δ ${got - want})`);

// A mix with a bit of everything, so the ratio rules all get exercised.
const MIX = [
  { label: "Studio", count: 12, sqft: 520 },
  { label: "1 Bed", count: 58, sqft: 700 },
  { label: "2 Bed", count: 44, sqft: 1000 },
  { label: "3 Bed", count: 16, sqft: 1225 },
];

test("parking ratios follow David's rule", () => {
  assert.equal(defaultRatioFor("Studio"), 1);
  assert.equal(defaultRatioFor("1 Bed"), 1);
  assert.equal(defaultRatioFor("2 Bed"), 2);
  assert.equal(defaultRatioFor("3 Bed"), 2);
  // Case and shorthand shouldn't change the answer.
  assert.equal(defaultRatioFor("2BR"), 2);
  assert.equal(defaultRatioFor("1 br"), 1);
  // An unparseable label lands on a visible midpoint rather than guessing low.
  assert.equal(defaultRatioFor("Penthouse"), 1.5);
});

test("parking demand and geometry are the hand arithmetic", () => {
  const r = sizeParking(
    { ...DEFAULT_COST_PROGRAM.parking, components: [] },
    MIX.map((m) => ({ label: m.label, count: m.count })),
  );
  // 12×1 + 58×1 + 44×2 + 16×2 = 12 + 58 + 88 + 32 = 190
  assert.equal(r.residentSpaces, 190);
  // 130 units × 0.15 guest = 19.5
  near(r.guestSpaces, 19.5);
  // 209.5 → a fractional space isn't a space; round up.
  assert.equal(r.requiredSpaces, 210);
  // 9' × 18'
  assert.equal(r.stallSqft, 162);
});

test("a surface lot sizes to roughly the 130-spaces-per-acre rule of thumb", () => {
  const r = sizeParking(
    {
      ...DEFAULT_COST_PROGRAM.parking,
      components: [{ id: "s", type: "surface", spaces: 210, costPerSpace: null, sfFactor: null }],
    },
    MIX.map((m) => ({ label: m.label, count: m.count })),
  );
  // 162 SF stall × 2.05 = 332.1 SF gross per space
  near(r.components[0].sfPerSpace, 332.1);
  near(r.totalSqft, 210 * 332.1);
  // 69,741 SF ÷ 43,560 = 1.601 acres → 131 spaces/acre. Matches the planning rule.
  near(r.totalAcres, 1.6011, 0.001);
  near(210 / r.totalAcres, 131.16, 0.05);
  assert.equal(r.providedSpaces, 210);
  assert.equal(r.surplusSpaces, 0);
});

test("a shortfall is reported, not absorbed", () => {
  const r = sizeParking(
    {
      ...DEFAULT_COST_PROGRAM.parking,
      components: [{ id: "s", type: "surface", spaces: 180, costPerSpace: null, sfFactor: null }],
    },
    MIX.map((m) => ({ label: m.label, count: m.count })),
  );
  assert.equal(r.requiredSpaces, 210);
  assert.equal(r.providedSpaces, 180);
  assert.equal(r.surplusSpaces, -30);
});

test("structured parking only consumes site area where it sits at grade", () => {
  const r = sizeParking(
    {
      ...DEFAULT_COST_PROGRAM.parking,
      components: [
        { id: "s", type: "surface", spaces: 80, costPerSpace: null, sfFactor: null },
        { id: "p", type: "podium", spaces: 130, costPerSpace: null, sfFactor: null },
      ],
    },
    MIX.map((m) => ({ label: m.label, count: m.count })),
  );
  near(r.surfaceSqft, 80 * 332.1);
  near(r.totalSqft, 80 * 332.1 + 130 * 162 * 2.2);
  // 80 × $6,500 + 130 × $32,000
  near(r.totalCost, 520_000 + 4_160_000);
});

test("road length seeds from the parking layout", () => {
  // 210 surface spaces: 210 × 0.5 + 150 entry = 255 LF
  assert.equal(suggestRoadLf({ surfaceSpaces: 210, structuredSpaces: 0 }), 255);
  // A deck is reached by a ramp, not an aisle, so it barely moves the number.
  assert.equal(suggestRoadLf({ surfaceSpaces: 0, structuredSpaces: 210 }), 167);
});

test("the budget rolls up to a cost basis that checks by hand", () => {
  const program: CostProgram = {
    ...DEFAULT_COST_PROGRAM,
    finishLevel: "Upgraded",
    circulationEfficiency: 0.85,
    commonAreas: [
      { id: "lobby", name: "Lobby", placement: "attached", sqft: 4_000, costPerSf: null },
      { id: "pool", name: "Pool & deck", placement: "detached", sqft: 2_500, costPerSf: null },
    ],
    parking: {
      ...DEFAULT_COST_PROGRAM.parking,
      components: [{ id: "s", type: "surface", spaces: 210, costPerSpace: null, sfFactor: null }],
    },
    infrastructure: [{ id: "road", name: "Site road", basis: "per_lf", quantity: 255, rate: 450 }],
    landCost: 2_000_000,
    softCostPct: 0.18,
    contingencyPct: 0.05,
    developerFeePct: 0.04,
  };

  const c = buildCost({ program, mix: MIX, commercialSqft: 4_200 });
  const r = FINISH_RATES.Upgraded;

  // 12×520 + 58×700 + 44×1000 + 16×1225 = 6,240 + 40,600 + 44,000 + 19,600 = 110,440
  near(c.residentialNetSqft, 110_440);
  near(c.residentialGrossSqft, 110_440 / 0.85);
  near(c.buildingGrossSqft, 110_440 / 0.85 + 4_200 + 4_000);

  const residential = (110_440 / 0.85) * r.residential; // ÷0.85 × $285
  const shell = 4_200 * r.commercialShell; // × $195
  const ti = 4_200 * r.commercialTi; // × $75
  const lobby = 4_000 * r.attachedCommon; // × $300
  const pool = 2_500 * r.detachedCommon; // × $340
  const parking = 210 * 6_500;
  const road = 255 * 450;
  const hard = residential + shell + ti + lobby + pool + parking + road;
  near(c.hardCost, hard, 0.5);

  const soft = hard * 0.18 + hard * 0.05;
  near(c.softCost, soft, 0.5);

  const subtotal = 2_000_000 + hard + soft;
  near(c.subtotal, subtotal, 0.5);
  near(c.developerFee, subtotal * 0.04, 0.5);
  near(c.computedTotal, subtotal * 1.04, 0.5);

  // The basis is the computed total, and the per-unit/per-SF reads divide by it.
  assert.equal(c.usingOverride, false);
  near(c.effectiveTotal, c.computedTotal);
  near(c.costPerUnit, c.computedTotal / 130, 0.01);
  near(c.costPerNetSqft, c.computedTotal / 110_440, 0.01);
});

test("the override replaces the computed total without erasing it", () => {
  const c = buildCost({
    program: { ...DEFAULT_COST_PROGRAM, useComputed: false, overrideTotal: 45_000_000 },
    mix: MIX,
    commercialSqft: 0,
  });
  assert.equal(c.usingOverride, true);
  assert.equal(c.effectiveTotal, 45_000_000);
  // Still computed, so the delta against a hand-typed number stays visible.
  assert.ok(c.computedTotal > 0);
  near(c.costPerUnit, 45_000_000 / 130, 0.01);
});

test("a zero efficiency degrades to no grossing instead of NaN", () => {
  const c = buildCost({
    program: { ...DEFAULT_COST_PROGRAM, circulationEfficiency: 0 },
    mix: MIX,
    commercialSqft: 0,
  });
  near(c.residentialGrossSqft, 110_440);
  assert.ok(Number.isFinite(c.computedTotal));
});

// ---------------------------------------------------------------------------
// Line detail — the drill-down has to actually move NOI
// ---------------------------------------------------------------------------

const base: MultiFamilyInputs = {
  marketUnits: [{ label: "1 Bed", count: 100, rentMonthly: 2000, sqft: 700 }],
  affordableUnits: [],
  otherIncome: {
    commercialSqft: 0, commercialRentPerSfYear: 0,
    garageSpaces: 0, garageRentMonthly: 0, surfaceSpaces: 0, surfaceRentMonthly: 0,
    storageSpaces: 0, storageRentMonthly: 0,
    grabAndGoPerUnitMonthly: 0, wifiPerUnitMonthly: 0,
    petSharePct: 0, petRentMonthly: 0,
    utilityBillbackPerUnitYear: 0, miscPerUnitYear: 0,
  },
  opex: {
    utilitiesPerUnit: 0, makeReadyPerUnit: 0, marketingPerUnit: 0, repairsPerUnit: 0,
    contractServicesPerUnit: 0, generalAdminPerUnit: 0,
    insurancePerUnit: 900, taxesPerUnit: 0, reservesPerUnit: 0,
    payrollSalaries: [], payrollBurdenPct: 0, managementFeePctOfResidentialEgi: 0,
  },
  vacancy: { residentialPct: 0, commercialPct: 0 },
  assetManagementFeePct: 0,
  ozPartnershipExpenses: 0,
  totalProjectCost: 30_000_000,
  exit: { capRate: 0.055, saleCostPct: 0 },
  sellOut: { saleCostPct: 0.05, shareSold: 0 },
};

test("with no detail every line reports as an estimate", () => {
  const pf = underwrite(base).proforma;
  assert.ok(pf.lines.every((l) => l.mode === "estimate"));
  assert.ok(pf.lines.every((l) => l.amount === l.estimated));
  // 100 units × $900
  near(pf.expenses.find((e) => e.label === "Insurance")!.amount, 90_000);
});

test("an itemized line replaces the estimate and moves NOI by the difference", () => {
  const lineDetails: LineDetails = {
    Insurance: {
      mode: "itemized",
      items: [
        { label: "Property", basis: "amount", value: 84_000 },
        { label: "Umbrella", basis: "amount", value: 21_500 },
        { label: "Flood", basis: "amount", value: 6_200 },
      ],
    },
  };
  const before = underwrite(base);
  const after = underwrite({ ...base, lineDetails });

  const line = after.proforma.lines.find((l) => l.label === "Insurance")!;
  assert.equal(line.mode, "itemized");
  near(line.amount, 111_700);
  // The estimate survives alongside, so the reader can see what was displaced.
  near(line.estimated, 90_000);
  // Expense up $21,700 → NOI down exactly $21,700.
  near(before.proforma.noi - after.proforma.noi, 21_700);
});

test("every basis computes off the right denominator", () => {
  const lineDetails: LineDetails = {
    Insurance: {
      mode: "itemized",
      items: [
        { label: "flat", basis: "amount", value: 1_000 },
        { label: "per unit", basis: "per_unit", value: 10 }, // × 100 units = 1,000
        { label: "per SF", basis: "per_sf", value: 0.5 }, // × 70,000 SF = 35,000
        { label: "pct EGI", basis: "pct_egi", value: 0.01 }, // × 2,400,000 = 24,000
      ],
    },
  };
  const r = underwrite({ ...base, lineDetails });
  near(r.proforma.egiTotal, 2_400_000); // 100 × $2,000 × 12, no vacancy
  near(r.proforma.lines.find((l) => l.label === "Insurance")!.amount, 61_000);
});

test("an itemized income line flows through vacancy to EGI", () => {
  const r = underwrite({
    ...base,
    vacancy: { residentialPct: 0.05, commercialPct: 0 },
    lineDetails: {
      "Base Rental Income": { mode: "itemized", items: [{ label: "Signed rent roll", basis: "amount", value: 2_500_000 }] },
    },
  });
  near(r.proforma.baseRentalIncome, 2_500_000);
  near(r.proforma.grossResidentialIncome, 2_500_000);
  near(r.proforma.egiTotal, 2_375_000); // less 5%
});

test("an empty or estimate-mode detail falls back to the estimate", () => {
  const r = underwrite({
    ...base,
    lineDetails: {
      // Toggled back to estimate but the items were kept — the estimate must win.
      Insurance: { mode: "estimate", items: [{ label: "stale", basis: "amount", value: 999_999 }] },
      // Itemized with nothing in it is not $0, it's "no detail yet".
      Taxes: { mode: "itemized", items: [] },
    },
  });
  near(r.proforma.lines.find((l) => l.label === "Insurance")!.amount, 90_000);
  assert.equal(r.proforma.lines.find((l) => l.label === "Taxes")!.mode, "estimate");
});
