import test from "node:test";
import assert from "node:assert/strict";
import {
  raiseProgress,
  summarizeLots,
  closingSchedule,
  equityPosition,
  type InvestmentLike,
  type LotLike,
} from "./capital";

const near = (a: number, b: number, eps = 0.01) =>
  assert.ok(Math.abs(a - b) < eps, `${a} !== ${b}`);

/** The Enclave's real raise: $400,000 across three investors. */
const ENCLAVE: InvestmentLike[] = [
  { investorId: "1", investorName: "Paul Stern", committedAmount: 100_000, contributedAmount: 0, status: "committed" },
  { investorId: "2", investorName: "Ishay Stein", committedAmount: 200_000, contributedAmount: 0, status: "committed" },
  { investorId: "3", investorName: "Steven Karpf", committedAmount: 100_000, contributedAmount: 0, status: "committed" },
];

test("the raise adds up, and committed is not funded", () => {
  const r = raiseProgress(ENCLAVE, 400_000);
  near(r.committed, 400_000);
  near(r.funded, 0);
  near(r.outstanding, 400_000); // promised, not wired
  near(r.remaining, 0);
  near(r.pctCommitted, 1);
  near(r.pctFunded, 0); // the whole point: fully committed, nothing collected
});

test("a prospect is not counted as committed", () => {
  // Otherwise a pipeline reads as a closed raise.
  const withProspect = [
    ...ENCLAVE,
    { investorId: "4", investorName: "Maybe", committedAmount: 500_000, contributedAmount: 0, status: "prospect" as const },
  ];
  near(raiseProgress(withProspect, 400_000).committed, 400_000);
});

test("partial funding shows what is still owed, per investor", () => {
  const partly = ENCLAVE.map((i) =>
    i.investorName === "Ishay Stein" ? { ...i, contributedAmount: 150_000 } : i,
  );
  const r = raiseProgress(partly, 400_000);
  near(r.funded, 150_000);
  near(r.outstanding, 250_000);
  const stein = r.investors.find((i) => i.investorName === "Ishay Stein")!;
  near(stein.outstanding, 50_000);
  near(stein.shareOfRaise, 0.5); // 200k of 400k
});

test("oversubscription is reported rather than shown as negative remaining", () => {
  const r = raiseProgress(ENCLAVE, 300_000);
  near(r.remaining, 0);
  near(r.oversubscribed, 100_000);
});

test("no target set does not divide by zero", () => {
  const r = raiseProgress(ENCLAVE, 0);
  near(r.pctCommitted, 0);
  near(r.committed, 400_000);
});

// ---------------------------------------------------------------------------

const lot = (n: number, over: Partial<LotLike> = {}): LotLike => ({
  id: String(n),
  lotNumber: `Lot ${n}`,
  style: null,
  listPrice: null,
  salePrice: null,
  status: "available",
  buyerName: null,
  projectedClosing: null,
  actualClosing: null,
  buildCost: null,
  ...over,
});

test("lots separate what is banked from what is only expected", () => {
  const lots = [
    lot(1, { status: "closed", salePrice: 699_900, actualClosing: "2026-05-15" }),
    lot(2, { status: "under_contract", listPrice: 769_900, projectedClosing: "2026-09-30" }),
    lot(3, { status: "reserved", listPrice: 699_900, projectedClosing: "2026-11-01" }),
    lot(4, { status: "available", listPrice: 699_900 }),
    lot(5),
  ];
  const s = summarizeLots(lots);
  assert.equal(s.total, 5);
  assert.equal(s.closed, 1);
  near(s.closedProceeds, 699_900);
  near(s.pipelineProceeds, 769_900 + 699_900);
  near(s.unsoldValue, 699_900); // lot 5 has no price, so it adds nothing
  assert.equal(s.unpriced, 1); // and it is counted as needing one
  near(s.grossPotential, 699_900 + 769_900 + 699_900 + 699_900);
});

test("a sale price beats the list price once there is one", () => {
  const s = summarizeLots([lot(1, { status: "closed", listPrice: 699_900, salePrice: 725_000 })]);
  near(s.closedProceeds, 725_000);
});

test("the schedule buckets by month and marks which closings are forecast", () => {
  const rows = closingSchedule([
    lot(1, { status: "closed", salePrice: 699_900, actualClosing: "2026-05-15", buildCost: 400_000 }),
    lot(2, { status: "under_contract", listPrice: 769_900, projectedClosing: "2026-09-30" }),
    lot(3, { status: "under_contract", listPrice: 699_900, projectedClosing: "2026-09-02" }),
    lot(4, { status: "available", listPrice: 699_900 }), // no date — must not appear
  ]);

  assert.equal(rows.length, 2);
  assert.equal(rows[0].label, "May 2026");
  near(rows[0].proceeds, 699_900);
  near(rows[0].net, 299_900); // less the 400k build cost
  assert.equal(rows[0].lots[0].projected, false);

  assert.equal(rows[1].label, "Sep 2026");
  assert.equal(rows[1].lots.length, 2);
  assert.ok(rows[1].lots.every((l) => l.projected));
  near(rows[1].proceeds, 1_469_800);
  near(rows[1].cumulativeNet, 299_900 + 1_469_800);
});

test("a lot with no closing date stays off the calendar rather than being guessed onto it", () => {
  assert.equal(closingSchedule([lot(1, { listPrice: 699_900 })]).length, 0);
});

test("an actual closing wins over a projected one", () => {
  const rows = closingSchedule([
    lot(1, { salePrice: 700_000, projectedClosing: "2026-12-01", actualClosing: "2026-06-10" }),
  ]);
  assert.equal(rows[0].label, "Jun 2026");
  assert.equal(rows[0].lots[0].projected, false);
});

test("equity position measures against contributed cash, not commitments", () => {
  const funded = ENCLAVE.map((i) => ({ ...i, contributedAmount: i.committedAmount }));
  const lots = Array.from({ length: 8 }, (_, i) => lot(i + 1, { listPrice: 699_900 }));
  const e = equityPosition(funded, lots, 5_000_000);
  near(e.contributed, 400_000);
  near(e.grossProceeds, 5_599_200);
  near(e.netToProject, 599_200);
  near(e.multipleOnContributed!, (400_000 + 599_200) / 400_000);
});

test("no contributed capital yields no multiple rather than a divide by zero", () => {
  assert.equal(equityPosition(ENCLAVE, [], 100).multipleOnContributed, null);
});
