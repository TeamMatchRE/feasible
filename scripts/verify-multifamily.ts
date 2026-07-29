/**
 * Runs the real Procopio deal — 26 W. Main St., Avon CT, 130 units — through our
 * engine and diffs EVERY line against the numbers their own workbook produced.
 *
 * The inputs below are theirs. The expected values below are theirs. Nothing in
 * src/lib/multifamily.ts copies a formula out of the workbook; it re-derives each
 * line from the inputs. So a mismatch here means one of the two models is wrong,
 * and the delta says by how much — which is the point.
 *
 * Run: npx tsx scripts/verify-multifamily.ts
 */
import { underwrite, type MultiFamilyInputs } from "../src/lib/multifamily";

let failures = 0;
const money = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

/** Dollar comparison to the cent — these should reconcile exactly, not approximately. */
const eq = (label: string, got: number, want: number, tol = 0.01) => {
  const delta = got - want;
  const ok = Math.abs(delta) <= tol;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(34)} ${money(got).padStart(16)}` +
      (ok ? "" : `   want ${money(want)}   Δ ${money(delta)}`),
  );
};
const eqPct = (label: string, got: number, want: number, tol = 0.0001) => {
  const ok = Math.abs(got - want) <= tol;
  if (!ok) failures++;
  console.log(
    `  ${ok ? "✓" : "✗"} ${label.padEnd(34)} ${(got * 100).toFixed(2).padStart(15)}%` +
      (ok ? "" : `   want ${(want * 100).toFixed(2)}%`),
  );
};

// ---------------------------------------------------------------------------
// THEIR INPUTS (Assumptions + Proforma sheets)
// ---------------------------------------------------------------------------
const avon: MultiFamilyInputs = {
  marketUnits: [
    { label: "1 Bed", count: 44, rentMonthly: 2400, sqft: 700 },
    { label: "2 Bed", count: 75, rentMonthly: 3300, sqft: 1000 },
    { label: "3 Bed", count: 11, rentMonthly: 3800, sqft: 1225 },
  ],
  affordableUnits: [], // the affordable tier exists in their model but is zeroed on this deal
  otherIncome: {
    commercialSqft: 9000,
    commercialRentPerSfYear: 25,
    garageSpaces: 130,
    garageRentMonthly: 150,
    surfaceSpaces: 180,
    surfaceRentMonthly: 0,
    storageSpaces: 25,
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
  totalProjectCost: 51_582_745,
  exit: { capRate: 0.055, saleCostPct: 0 },
  sellOut: { saleCostPct: 0.05, shareSold: 0 },
};

const r = underwrite(avon);
const pf = r.proforma;

console.log("\n=== UNIT MIX (Proforma H25:O31) ===");
eq("Total units", r.totalMix.totalUnits, 130);
eq("Net rentable SF", r.totalMix.totalSqft, 119_275);
eq("Average rent", r.totalMix.avgRent, 3037.6923, 0.001);
eq("Average SF", r.totalMix.avgSqft, 917.5, 0.001);
eqPct("1 Bed share of mix", r.totalMix.rows[0].mixPct, 0.3385, 0.0001);
eq("Base rental income", r.totalMix.annualRent, 4_738_800);

console.log("\n=== INCOME (Proforma B4:C18) ===");
eq("Base Rental Income", pf.baseRentalIncome, 4_738_800);
eq("Parking", pf.parking, 234_000);
eq("Storage", pf.storage, 10_500);
eq("Pet Income", pf.petIncome, 15_600);
eq("Utility Billback", pf.utilityBillback, 52_000);
eq("Grab & Go", pf.grabAndGo, 31_200);
eq("Wifi", pf.wifi, 39_000);
eq("Misc. Income", pf.miscIncome, 32_500);
eq("Gross Income - Residential", pf.grossResidentialIncome, 5_153_600);
eq("Residential Vacancy", pf.residentialVacancy, -257_680);
eq("EGI - Residential", pf.egiResidential, 4_895_920);
eq("Commercial Income", pf.commercialIncome, 225_000);
eq("Commercial Vacancy", pf.commercialVacancy, -11_250);
eq("EGI - Commercial", pf.egiCommercial, 213_750);
eq("EGI - TOTAL", pf.egiTotal, 5_109_670);

console.log("\n=== EXPENSES (Proforma B21:C32) ===");
const ex = (label: string) => pf.expenses.find((e) => e.label === label)?.amount ?? NaN;
eq("Utilities", ex("Utilities"), 117_000);
eq("Payroll (w/ 35% burden)", ex("Payroll"), 317_250);
eq("Make Ready / Turnover", ex("Make Ready / Turnover"), 45_500);
eq("General Marketing", ex("General Marketing"), 52_000);
eq("Repairs & Maintenance", ex("Repairs & Maintenance"), 78_000);
eq("General & Administrative", ex("General & Administrative"), 26_000);
eq("Insurance", ex("Insurance"), 117_000);
eq("Management Fee (3% resi EGI)", ex("Management Fee"), 146_877.6);
eq("Taxes", ex("Taxes"), 651_300);
eq("Reserves", ex("Reserves"), 32_500);
eq("Total Expenses", pf.totalExpenses, 1_583_427.6);
// Their sheet reports 32.34%. That divides WHOLE-BUILDING expenses by RESIDENTIAL-only
// EGI, so it reconciles against their convention — while our headline ratio uses total
// EGI, which is the defensible denominator. Both are asserted so neither can drift.
eqPct("Expense Ratio (their basis)", pf.expenseRatioOnResidentialEgi, 0.3234, 0.0001);
eqPct("Expense Ratio (total EGI)", pf.expenseRatio, 0.30989, 0.0001);

console.log("\n=== RESULT (Proforma B34:C41, Investment Summary E) ===");
eq("Net Operating Income", pf.noi, 3_526_242.4);
eq("Asset Management Fee (1.5%)", pf.assetManagementFee, 76_645.05);
eq("Adjusted NOI", pf.adjustedNoi, 3_449_597.35);
eq("Untrended Sell Out Value", r.exit.btr.grossValue, 64_113_498.1818, 0.01);
eq("Sell Out Value / Unit", r.exit.btr.valuePerUnit, 493_180.7552, 0.001);
eq("Total Project Cost / Unit", r.costPerUnit, 396_790.3462, 0.001);
eqPct("Untrended ROC", r.exit.btr.returnOnCost, 0.0684, 0.0001);

console.log("\n=== EXIT ANALYSIS (our addition — the BTR vs Sell Out question) ===");
console.log(`  BTR profit                 ${money(r.exit.btr.profit)}  (margin ${(r.exit.btr.profitMargin * 100).toFixed(1)}%)`);
console.log(`  Development spread         ${r.exit.btr.developmentSpreadBps} bps over the ${(avon.exit.capRate * 100).toFixed(2)}% exit cap`);
console.log(`  Recommendation             ${r.exit.recommendation.best}`);
console.log(`  Note                       ${r.exit.recommendation.note}`);

// With no unit prices set, the sell-out exit must NOT masquerade as a real $0 answer.
console.log("\n=== GUARD: unpriced sell-out can't look like a real answer ===");
const guardOk = r.exit.sellOut.priced === false && r.exit.recommendation.best === "Build to Rent";
if (!guardOk) failures++;
console.log(`  ${guardOk ? "✓" : "✗"} unpriced sell-out flagged, BTR chosen by default`);

// Now price the units and confirm the comparison actually moves.
console.log("\n=== SELL OUT vs BTR (units priced from for-sale comps) ===");
const priced = underwrite({
  ...avon,
  marketUnits: [
    { label: "1 Bed", count: 44, rentMonthly: 2400, sqft: 700, sellPrice: 425_000 },
    { label: "2 Bed", count: 75, rentMonthly: 3300, sqft: 1000, sellPrice: 585_000 },
    { label: "3 Bed", count: 11, rentMonthly: 3800, sqft: 1225, sellPrice: 720_000 },
  ],
  sellOut: { saleCostPct: 0.05, shareSold: 0.5 },
});
const p = priced.exit;
console.log(`  Sell-out gross proceeds    ${money(p.sellOut.grossProceeds)}`);
console.log(`  Sell-out net (after 5%)    ${money(p.sellOut.netProceeds)}   profit ${money(p.sellOut.profit)}`);
console.log(`  BTR net value              ${money(p.btr.netValue)}   profit ${money(p.btr.profit)}`);
console.log(`  Blend @ 50% sold           ${money(p.blend.totalValue)}   profit ${money(p.blend.profit)}`);
console.log(`  → ${p.recommendation.best}: ${p.recommendation.note}`);

const sellGross = 44 * 425_000 + 75 * 585_000 + 11 * 720_000;
eq("sell-out gross checks by hand", p.sellOut.grossProceeds, sellGross);
eq("blend = half sell + half hold", p.blend.totalValue, p.sellOut.netProceeds * 0.5 + p.btr.netValue * 0.5, 1);

console.log(failures === 0 ? "\nAll checks passed — the engine reproduces Procopio's model exactly." : `\n${failures} CHECK(S) FAILED.`);
process.exit(failures === 0 ? 0 : 1);
