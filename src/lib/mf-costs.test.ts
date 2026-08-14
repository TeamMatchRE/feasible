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
  AMENITY_PRESETS,
  amenityFromPreset,
  type CostProgram,
} from "./mf-costs";
import { underwrite, type MultiFamilyInputs, type LineDetails } from "./multifamily";

const near = (got: number, want: number, tol = 0.01) =>
  assert.ok(Math.abs(got - want) <= tol, `got ${got}, want ${want} (Δ ${got - want})`);
const sumOf = (ns: number[]) => ns.reduce((a, b) => a + b, 0);

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

// ---------------------------------------------------------------------------
// Per-unit-type cost basis — three products, three rates, three grossings
// ---------------------------------------------------------------------------

test("a mix with no per-type overrides costs exactly what it did before per-type costing", () => {
  // The backward-compatibility guarantee stated in db/migrations/0007. Asserted,
  // not assumed: every stored deal must reprice to the same dollar.
  const program: CostProgram = { ...DEFAULT_COST_PROGRAM, finishLevel: "Upgraded", circulationEfficiency: 0.85 };
  const c = buildCost({ program, mix: MIX, commercialSqft: 0 });

  // One blended line, the familiar label.
  const residential = c.hardLines.filter((l) => l.key.startsWith("residential"));
  assert.equal(residential.length, 1);
  assert.equal(residential[0].label, "Residential units");
  // 110,440 ÷ 0.85 × $285
  near(residential[0].amount, (110_440 / 0.85) * FINISH_RATES.Upgraded.residential, 0.5);
  near(c.residentialGrossSqft, 110_440 / 0.85);
  // The per-type breakdown is still populated, and still sums to the same total.
  near(sumOf(c.residentialByType.map((t) => t.amount)), residential[0].amount, 0.5);
  assert.ok(c.residentialByType.every((t) => !t.overridden));
});

test("each product type is priced at its own rate and its own grossing", () => {
  const program: CostProgram = {
    ...DEFAULT_COST_PROGRAM,
    circulationEfficiency: 0.85, // applies only to the type that doesn't override it
    softCostPct: 0,
    contingencyPct: 0,
    developerFeePct: 0,
    infrastructure: [],
    commonAreas: [],
    parking: { ...DEFAULT_COST_PROGRAM.parking, components: [] },
  };
  const c = buildCost({
    program,
    mix: [
      // Detached: quoted $/SF is the whole house, so no grossing at all.
      { label: "Single family", count: 50, sqft: 2_200, costPerSf: 205, grossFactor: 1 },
      // Attached townhome: own entry, still no interior corridor.
      { label: "Townhome", count: 55, sqft: 1_700, costPerSf: 190, grossFactor: 1 },
      // Stacked flats: corridors and elevators, so the program's 0.85 stands.
      { label: "2 Bed flat", count: 120, sqft: 1_050, costPerSf: 190 },
    ],
    commercialSqft: 0,
  });

  const sfHomes = 50 * 2_200 * 205; // 110,000 SF × $205 = $22,550,000
  const towns = 55 * 1_700 * 190; //  93,500 SF × $190 = $17,765,000
  const flats = ((120 * 1_050) / 0.85) * 190; // 126,000 ÷ 0.85 × $190 = $28,164,705.88

  near(sfHomes, 22_550_000);
  near(towns, 17_765_000);
  near(c.hardCost, sfHomes + towns + flats, 0.5);

  // One line per product, because a blended row would hide the distinction.
  assert.equal(c.hardLines.length, 3);
  assert.equal(c.hardLines[0].label, "Single family — 50 units");
  assert.equal(c.hardLines[0].detail, "110,000 SF × $205");
  assert.equal(c.hardLines[2].detail, "126,000 net SF ÷ 85% = 148,235 gross × $190");

  // Only the flats get grossed up; the houses and townhomes do not.
  near(c.residentialNetSqft, 110_000 + 93_500 + 126_000);
  near(c.residentialGrossSqft, 110_000 + 93_500 + 126_000 / 0.85);
});

test("grossing a detached house would invent 17.6% of hard cost", () => {
  // The specific error the per-type basis exists to prevent, stated as a number.
  const program: CostProgram = {
    ...DEFAULT_COST_PROGRAM,
    circulationEfficiency: 0.85,
    residentialCostPerSf: 205,
    softCostPct: 0, contingencyPct: 0, developerFeePct: 0,
    infrastructure: [], commonAreas: [],
    parking: { ...DEFAULT_COST_PROGRAM.parking, components: [] },
  };
  const mix = [{ label: "Single family", count: 50, sqft: 2_200 }];

  const grossed = buildCost({ program, mix, commercialSqft: 0 });
  const honest = buildCost({ program, mix: [{ ...mix[0], grossFactor: 1 }], commercialSqft: 0 });

  near(honest.hardCost, 110_000 * 205, 0.5); // $22,550,000
  near(grossed.hardCost, (110_000 / 0.85) * 205, 0.5); // $26,529,411.76
  // 1/0.85 − 1 = 17.647%
  near((grossed.hardCost - honest.hardCost) / honest.hardCost, 0.17647, 0.0001);
});

test("a per-type rate of 0 is honoured, but a missing one falls back to the program", () => {
  const program: CostProgram = {
    ...DEFAULT_COST_PROGRAM,
    residentialCostPerSf: 300,
    circulationEfficiency: 1,
    softCostPct: 0, contingencyPct: 0, developerFeePct: 0,
    infrastructure: [], commonAreas: [],
    parking: { ...DEFAULT_COST_PROGRAM.parking, components: [] },
  };
  const c = buildCost({
    program,
    mix: [
      { label: "Donated", count: 10, sqft: 1_000, costPerSf: 0 }, // explicit 0 ≠ "unset"
      { label: "Normal", count: 10, sqft: 1_000 },
    ],
    commercialSqft: 0,
  });
  near(c.residentialByType[0].amount, 0);
  near(c.residentialByType[1].amount, 10_000 * 300);
  near(c.hardCost, 3_000_000, 0.5);
});

test("a lump-sum amenity costs its lump and encloses no building area", () => {
  const program: CostProgram = {
    ...DEFAULT_COST_PROGRAM,
    softCostPct: 0, contingencyPct: 0, developerFeePct: 0,
    infrastructure: [],
    parking: { ...DEFAULT_COST_PROGRAM.parking, components: [] },
    commonAreas: [
      { id: "club", name: "Clubhouse", placement: "detached", sqft: 8_000, costPerSf: 280 },
      // A pool has no roof: it costs $850k and adds zero SF to the building.
      { id: "pool", name: "Pool & deck", placement: "detached", sqft: 0, costPerSf: null, lumpCost: 850_000 },
      { id: "gate", name: "Gated entry", placement: "detached", sqft: 0, costPerSf: null, lumpCost: 350_000 },
    ],
  };
  const c = buildCost({ program, mix: MIX, commercialSqft: 0 });

  // 8,000 × $280 clubhouse + the two lumps, on top of the residential.
  const residential = (110_440 / 0.85) * FINISH_RATES.Upgraded.residential;
  near(c.hardCost, residential + 8_000 * 280 + 850_000 + 350_000, 0.5);

  // Only the clubhouse is enclosed area; the lumps must not inflate it.
  near(c.detachedCommonSqft, 8_000);
  near(c.buildingGrossSqft, 110_440 / 0.85);

  const labels = c.hardLines.map((l) => l.label);
  assert.ok(labels.includes("Pool & deck"));
  assert.equal(c.hardLines.find((l) => l.label === "Pool & deck")!.detail, "Lump sum");
});

test("an amenity preset lands as an editable line, and a zero lump is dropped", () => {
  const club = AMENITY_PRESETS.find((a) => a.id === "clubhouse")!;
  const line = amenityFromPreset(club, "x1");
  // The catalog's clubhouse is a defensible 8,000 SF, not a five-figure guess.
  assert.equal(line.sqft, 8_000);
  assert.equal(line.costPerSf, 280);
  assert.equal(line.lumpCost, null); // per-SF preset, so no lump

  const pool = amenityFromPreset(AMENITY_PRESETS.find((a) => a.id === "pool")!, "x2");
  assert.equal(pool.lumpCost, 850_000);
  assert.equal(pool.sqft, 0);

  // A lump of 0 is "not costed yet" and shouldn't print a $0 budget line.
  const c = buildCost({
    program: {
      ...DEFAULT_COST_PROGRAM,
      infrastructure: [],
      parking: { ...DEFAULT_COST_PROGRAM.parking, components: [] },
      commonAreas: [{ id: "z", name: "Dog park", placement: "detached", sqft: 0, costPerSf: null, lumpCost: 0 }],
    },
    mix: MIX,
    commercialSqft: 0,
  });
  assert.ok(!c.hardLines.some((l) => l.label === "Dog park"));
});

test("a new deal starts with no amenity program at all", () => {
  assert.equal(DEFAULT_COST_PROGRAM.commonAreas.length, 0);
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

// ---------------------------------------------------------------------------
// Designated disposition — "sell the houses, hold the apartments"
// ---------------------------------------------------------------------------

/** 10 houses built to sell, 100 flats built to hold. Opex is $1,000/unit flat. */
const designatedBase: MultiFamilyInputs = {
  ...base,
  marketUnits: [
    { label: "House", count: 10, rentMonthly: 0, sqft: 2_000, sellPrice: 500_000, disposition: "sell" },
    { label: "1 Bed", count: 100, rentMonthly: 2_000, sqft: 700, disposition: "hold" },
  ],
  opex: { ...base.opex, insurancePerUnit: 1_000 },
  totalProjectCost: 30_000_000,
  sellOut: { saleCostPct: 0.05, shareSold: 0.5 }, // deliberately set, and must be IGNORED
};

test("designated mode charges opex only against the units actually held", () => {
  const r = underwrite(designatedBase);
  // 100 held units × $1,000 — NOT 110. The 10 sold houses send no tax or
  // insurance bill to an owner who no longer owns them.
  near(r.proforma.expenses.find((e) => e.label === "Insurance")!.amount, 100_000);
  // Income is the held units' rent only.
  near(r.proforma.egiTotal, 100 * 2_000 * 12);
  near(r.proforma.noi, 2_400_000 - 100_000);
});

test("designated mode sells the sell types whole and holds the hold types whole", () => {
  const r = underwrite(designatedBase);
  const e = r.exit;

  // 10 houses × $500,000 — the flats are not in the sell-out at any share.
  near(e.sellOut.grossProceeds, 5_000_000);
  near(e.sellOut.netProceeds, 5_000_000 * 0.95);

  // shareSold of 0.5 is ignored; the mix already said 10 of 110.
  near(e.blend.shareSold, 10 / 110, 0.0001);
  assert.equal(e.blend.unitsSold, 10);
  assert.equal(e.blend.unitsHeld, 100);

  // Held NOI is the full held-only NOI, not prorated again.
  near(e.blend.heldNoi, 2_300_000);
  near(e.blend.heldNetValue, 2_300_000 / 0.055);
  near(e.blend.totalValue, 4_750_000 + 2_300_000 / 0.055);
  near(e.blend.profit, 4_750_000 + 2_300_000 / 0.055 - 30_000_000);
});

test("designated mode reports the plan rather than picking a winner", () => {
  const r = underwrite(designatedBase);
  assert.equal(r.exit.recommendation.best, "Blend");
  assert.equal(r.exit.recommendation.overRunnerUp, 0);
  assert.match(r.exit.recommendation.note, /10 units sold, 100 held/);
  near(r.exit.recommendation.profit, r.exit.blend.profit);
});

test("per-unit figures divide by the units they came from, not the whole deal", () => {
  // Found in prod on Shuly's Place: the sell-out card read $265,556/unit because
  // $59.75M of proceeds from 105 sold units was divided by all 225 units in the
  // deal. The designated filter had been applied to the numerators and not the
  // denominators.
  const e = underwrite(designatedBase).exit;

  // $5,000,000 from TEN houses is $500,000 each — not $45,454 (÷110).
  near(e.sellOut.proceedsPerUnit, 500_000);
  // The held value came from 100 flats, so it is spread over 100.
  near(e.btr.valuePerUnit, 2_300_000 / 0.055 / 100);
});

test("a designated plan reports its two halves, and they sum to the plan", () => {
  const e = underwrite(designatedBase).exit;
  assert.equal(e.designated, true);
  const p = e.portions!;

  assert.equal(p.sold.units, 10);
  assert.equal(p.held.units, 100);
  near(p.sold.netProceeds, 4_750_000);
  near(p.held.netValue, 2_300_000 / 0.055);

  // The whole point: the halves are the plan, so they must add up to it.
  near(p.sold.netProceeds + p.held.netValue, e.blend.totalValue);
  near(p.sold.netProceeds + p.held.netValue - 30_000_000, e.blend.profit);
});

test("build-to-rent and sell-out are not offered as exits once a program is designated", () => {
  // They stay computed for the non-designated path, but each measures ONE
  // portion's revenue against the WHOLE project's cost, so neither is a real
  // scenario. `designated` is the flag that tells the UI to hide them; this test
  // exists so nobody re-reads them as a comparison later.
  const e = underwrite(designatedBase).exit;
  assert.equal(e.designated, true);
  assert.equal(e.recommendation.best, "Blend");

  // Demonstrating the incoherence rather than describing it: BTR "profit" charges
  // the full $30M cost against only the held units' capitalized value.
  near(e.btr.profit, 2_300_000 / 0.055 - 30_000_000);
  assert.ok(e.btr.profit < e.blend.profit, "the partial-revenue figure is worse than the real plan");
});

test("a non-designated deal still divides per-unit by every unit", () => {
  const e = underwrite({ ...base, sellOut: { saleCostPct: 0.05, shareSold: 0.5 } }).exit;
  assert.notEqual(e.designated, true);
  assert.equal(e.portions, undefined);
  // Sell-out means sell EVERYTHING here, so the whole mix is the denominator.
  const units = base.marketUnits.reduce((s, u) => s + u.count, 0);
  near(e.sellOut.proceedsPerUnit, e.sellOut.grossProceeds / units);
  near(e.btr.valuePerUnit, e.btr.grossValue / units);
});

test("an undeclared type in a designated mix is held, not silently sold", () => {
  const r = underwrite({
    ...designatedBase,
    marketUnits: [
      { label: "House", count: 10, rentMonthly: 0, sqft: 2_000, sellPrice: 500_000, disposition: "sell" },
      // No disposition, and it HAS a sell price — the conservative read is hold.
      { label: "1 Bed", count: 100, rentMonthly: 2_000, sqft: 700, sellPrice: 300_000 },
    ],
  });
  near(r.exit.sellOut.grossProceeds, 5_000_000);
  assert.equal(r.exit.blend.unitsHeld, 100);
});

test("with no disposition anywhere, the proration model is untouched", () => {
  // The guarantee that every stored deal keeps its number.
  const prorated = underwrite({ ...base, sellOut: { saleCostPct: 0.05, shareSold: 0.5 } });
  near(prorated.exit.blend.shareSold, 0.5);
  near(prorated.exit.blend.unitsSold, 50);
  // Half the NOI is capitalized, exactly as before.
  near(prorated.exit.blend.heldNoi, prorated.proforma.noi * 0.5);
  // 100 units × $900 insurance — the whole mix, since nothing was designated.
  near(prorated.proforma.expenses.find((e) => e.label === "Insurance")!.amount, 90_000);
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
