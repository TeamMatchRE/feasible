"use client";

import { useMemo, useState } from "react";
import { underwrite, type MultiFamilyInputs, type UnitTypeInput } from "@/lib/multifamily";
import { saveDeal } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { MfAssumptions } from "@/lib/mf-queries";

/**
 * The deal editor. Everything recomputes as you type — the whole point of the
 * exercise is watching the exit flip when a rent or a cap rate moves, and a
 * save-then-reload loop hides exactly the thing you're trying to see.
 */

type UnitRow = {
  tier: "market" | "affordable";
  label: string;
  unit_count: number;
  rent_monthly: number;
  sqft: number;
  sell_price: number | null;
};

export type DealState = {
  id: string;
  name: string;
  address: string;
  city: string;
  state: string;
  grossSqft: number;
  commercialSqft: number;
  heightStories: number;
  garageSpaces: number;
  surfaceSpaces: number;
  storageSpaces: number;
  totalProjectCost: number;
  notes: string;
  assumptions: MfAssumptions;
  units: UnitRow[];
};

const money = (n: number) =>
  `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pct = (n: number, dp = 2) => `${(n * 100).toFixed(dp)}%`;
const numOr = (s: string, fallback = 0) => {
  const n = Number(String(s).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

const inputCls = "w-full rounded border border-line px-2 py-1 text-sm";
const cellCls = "w-24 rounded border border-line px-2 py-1 text-right text-sm";

function Field({
  label, value, onChange, hint, width = "w-40",
}: { label: string; value: number; onChange: (n: number) => void; hint?: string; width?: string }) {
  return (
    <label className="text-sm">
      <span className="block text-xs uppercase tracking-wide text-muted">{label}</span>
      <input
        inputMode="decimal"
        className={`mt-1 ${width} rounded border border-line px-2 py-1 text-right text-sm`}
        value={String(value)}
        onChange={(e) => onChange(numOr(e.target.value))}
      />
      {hint && <span className="mt-0.5 block text-[11px] text-muted">{hint}</span>}
    </label>
  );
}

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h2 className="text-sm font-semibold text-ink">{title}</h2>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

export default function Underwriter({ initial }: { initial: DealState }) {
  const [d, setD] = useState<DealState>(initial);
  const set = <K extends keyof DealState>(k: K, v: DealState[K]) => setD((p) => ({ ...p, [k]: v }));
  const setA = (patch: Partial<MfAssumptions>) => setD((p) => ({ ...p, assumptions: { ...p.assumptions, ...patch } }));

  const setUnit = (i: number, patch: Partial<UnitRow>) =>
    setD((p) => ({ ...p, units: p.units.map((u, idx) => (idx === i ? { ...u, ...patch } : u)) }));
  const addUnit = (tier: "market" | "affordable") =>
    setD((p) => ({ ...p, units: [...p.units, { tier, label: "New type", unit_count: 0, rent_monthly: 0, sqft: 0, sell_price: null }] }));
  const removeUnit = (i: number) => setD((p) => ({ ...p, units: p.units.filter((_, idx) => idx !== i) }));

  const toInputs = (rows: UnitRow[], tier: "market" | "affordable"): UnitTypeInput[] =>
    rows
      .filter((u) => u.tier === tier)
      .map((u) => ({
        label: u.label,
        count: u.unit_count,
        rentMonthly: u.rent_monthly,
        sqft: u.sqft,
        sellPrice: u.sell_price ?? undefined,
      }));

  const result = useMemo(() => {
    const inputs: MultiFamilyInputs = {
      marketUnits: toInputs(d.units, "market"),
      affordableUnits: toInputs(d.units, "affordable"),
      // Commercial SF lives on the deal (it's a property fact) but the engine reads
      // it off otherIncome — keep the one on the deal authoritative.
      otherIncome: {
        ...d.assumptions.otherIncome,
        commercialSqft: d.commercialSqft,
        garageSpaces: d.garageSpaces,
        surfaceSpaces: d.surfaceSpaces,
        storageSpaces: d.storageSpaces,
      },
      opex: d.assumptions.opex,
      vacancy: d.assumptions.vacancy,
      assetManagementFeePct: d.assumptions.assetManagementFeePct,
      ozPartnershipExpenses: d.assumptions.ozPartnershipExpenses,
      totalProjectCost: d.totalProjectCost,
      exit: d.assumptions.exit,
      sellOut: d.assumptions.sellOut,
    };
    return underwrite(inputs);
  }, [d]);

  const pf = result.proforma;
  const ex = result.exit;
  const oi = d.assumptions.otherIncome;
  const op = d.assumptions.opex;

  const income: [string, number][] = [
    ["Base Rental Income", pf.baseRentalIncome],
    ["Parking", pf.parking],
    ["Storage", pf.storage],
    ["Pet Income", pf.petIncome],
    ["Utility Billback", pf.utilityBillback],
    ["Grab & Go", pf.grabAndGo],
    ["Wifi", pf.wifi],
    ["Misc. Income", pf.miscIncome],
  ];

  return (
    <div className="space-y-5">
      {/* ---------- The answer, kept at the top ---------- */}
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">Build to rent, sell out, or blend</h2>
          <span className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">{ex.recommendation.best}</span>
        </div>
        <p className="mt-1 text-xs text-muted">{ex.recommendation.note}</p>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded border border-line p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Build to rent</p>
            <p className="mt-0.5 text-xl font-semibold text-ink">{money(ex.btr.profit)}</p>
            <p className="text-xs text-muted">
              value {money(ex.btr.grossValue)} · {money(ex.btr.valuePerUnit)}/unit · margin {pct(ex.btr.profitMargin, 1)}
            </p>
            <p className="mt-1 text-xs text-muted">
              Yield on cost {pct(ex.btr.returnOnCost)} —{" "}
              <span className={ex.btr.developmentSpreadBps >= 0 ? "text-ink" : "text-red-600"}>
                {ex.btr.developmentSpreadBps} bps
              </span>{" "}
              over the exit cap
            </p>
          </div>
          <div className="rounded border border-line p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Sell out</p>
            {ex.sellOut.priced ? (
              <>
                <p className="mt-0.5 text-xl font-semibold text-ink">{money(ex.sellOut.profit)}</p>
                <p className="text-xs text-muted">
                  net {money(ex.sellOut.netProceeds)} · {money(ex.sellOut.proceedsPerUnit)}/unit · margin{" "}
                  {pct(ex.sellOut.profitMargin, 1)}
                </p>
              </>
            ) : (
              <p className="mt-0.5 text-sm text-muted">
                Not priced. Set a sale price per unit type (or pull one from a for-sale comp below).
              </p>
            )}
          </div>
          <div className="rounded border border-line p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Blend — {pct(ex.blend.shareSold, 0)} sold</p>
            <p className="mt-0.5 text-xl font-semibold text-ink">{money(ex.blend.profit)}</p>
            <p className="text-xs text-muted">
              {Math.round(ex.blend.unitsSold)} sold / {Math.round(ex.blend.unitsHeld)} held · total{" "}
              {money(ex.blend.totalValue)}
            </p>
            <label className="mt-2 block text-xs text-muted">
              Share sold
              <input
                type="range" min={0} max={1} step={0.05}
                value={d.assumptions.sellOut.shareSold}
                onChange={(e) => setA({ sellOut: { ...d.assumptions.sellOut, shareSold: Number(e.target.value) } })}
                className="mt-1 w-full"
              />
            </label>
          </div>
        </div>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ---------- Property + cost ---------- */}
        <Section title="Property & cost basis" hint="One cost basis; all three exits are measured against it.">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted">Name</span>
              <input className={`mt-1 ${inputCls}`} value={d.name} onChange={(e) => set("name", e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted">Address</span>
              <input className={`mt-1 ${inputCls}`} value={d.address} onChange={(e) => set("address", e.target.value)} />
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted">City</span>
              <input className={`mt-1 ${inputCls}`} value={d.city} onChange={(e) => set("city", e.target.value)} />
            </label>
            <Field label="Total project cost" value={d.totalProjectCost} onChange={(n) => set("totalProjectCost", n)} width="w-full" hint={`${money(result.costPerUnit)} / unit`} />
            <Field label="Gross SF" value={d.grossSqft} onChange={(n) => set("grossSqft", n)} width="w-full" />
            <Field label="Commercial SF" value={d.commercialSqft} onChange={(n) => set("commercialSqft", n)} width="w-full" />
            <Field label="Stories" value={d.heightStories} onChange={(n) => set("heightStories", n)} width="w-full" />
            <Field label="Garage spaces" value={d.garageSpaces} onChange={(n) => set("garageSpaces", n)} width="w-full" />
            <Field label="Surface spaces" value={d.surfaceSpaces} onChange={(n) => set("surfaceSpaces", n)} width="w-full" />
            <Field label="Storage spaces" value={d.storageSpaces} onChange={(n) => set("storageSpaces", n)} width="w-full" />
          </div>
        </Section>

        {/* ---------- Proforma ---------- */}
        <Section title="Stabilized proforma" hint="Income and expenses at stabilization, to NOI.">
          <table className="w-full text-sm">
            <tbody>
              {income.map(([label, v]) => (
                <tr key={label} className="border-b border-line/50">
                  <td className="py-1 text-muted">{label}</td>
                  <td className="py-1 text-right text-ink">{money(v)}</td>
                </tr>
              ))}
              <tr className="border-b border-line font-medium">
                <td className="py-1">Gross Income — Residential</td>
                <td className="py-1 text-right">{money(pf.grossResidentialIncome)}</td>
              </tr>
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Residential Vacancy</td>
                <td className="py-1 text-right text-ink">{money(pf.residentialVacancy)}</td>
              </tr>
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Commercial (less vacancy)</td>
                <td className="py-1 text-right text-ink">{money(pf.egiCommercial)}</td>
              </tr>
              <tr className="border-b border-line font-medium">
                <td className="py-1">EGI — Total</td>
                <td className="py-1 text-right">{money(pf.egiTotal)}</td>
              </tr>
              {pf.expenses.map((e) => (
                <tr key={e.label} className="border-b border-line/50">
                  <td className="py-1 text-muted">{e.label}</td>
                  <td className="py-1 text-right text-ink">{money(-e.amount)}</td>
                </tr>
              ))}
              <tr className="border-b border-line font-medium">
                <td className="py-1">
                  Total Expenses
                  <span className="ml-2 text-xs font-normal text-muted">
                    {pct(pf.expenseRatio)} of total EGI
                  </span>
                </td>
                <td className="py-1 text-right">{money(-pf.totalExpenses)}</td>
              </tr>
              <tr className="border-b border-line text-base font-semibold">
                <td className="py-1.5">Net Operating Income</td>
                <td className="py-1.5 text-right">{money(pf.noi)}</td>
              </tr>
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Asset Management Fee</td>
                <td className="py-1 text-right text-ink">{money(-pf.assetManagementFee)}</td>
              </tr>
              <tr className="font-medium">
                <td className="py-1">Adjusted NOI</td>
                <td className="py-1 text-right">{money(pf.adjustedNoi)}</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            Expense ratio on residential EGI only (the Procopio convention) is{" "}
            {pct(pf.expenseRatioOnResidentialEgi)} — higher, because whole-building costs divide by
            residential-only revenue. Reported for reconciliation; don&rsquo;t drive expenses off it.
          </p>
        </Section>
      </div>

      {/* ---------- Unit mix ---------- */}
      <Section title="Unit mix" hint="Market-rate and affordable tiers price the same bedroom count differently, so they're separate rows.">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[720px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 font-medium">Tier</th>
                <th className="py-1 font-medium">Type</th>
                <th className="py-1 text-right font-medium">Units</th>
                <th className="py-1 text-right font-medium">Rent /mo</th>
                <th className="py-1 text-right font-medium">SF</th>
                <th className="py-1 text-right font-medium">$/SF</th>
                <th className="py-1 text-right font-medium">Sale price</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {d.units.map((u, i) => (
                <tr key={i} className="border-b border-line/50">
                  <td className="py-1 pr-2">
                    <select
                      className="rounded border border-line px-1 py-1 text-xs"
                      value={u.tier}
                      onChange={(e) => setUnit(i, { tier: e.target.value as "market" | "affordable" })}
                    >
                      <option value="market">Market</option>
                      <option value="affordable">Affordable</option>
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input className="w-32 rounded border border-line px-2 py-1 text-sm" value={u.label} onChange={(e) => setUnit(i, { label: e.target.value })} />
                  </td>
                  <td className="py-1 text-right">
                    <input className={cellCls} inputMode="numeric" value={String(u.unit_count)} onChange={(e) => setUnit(i, { unit_count: numOr(e.target.value) })} />
                  </td>
                  <td className="py-1 text-right">
                    <input className={cellCls} inputMode="numeric" value={String(u.rent_monthly)} onChange={(e) => setUnit(i, { rent_monthly: numOr(e.target.value) })} />
                  </td>
                  <td className="py-1 text-right">
                    <input className={cellCls} inputMode="numeric" value={String(u.sqft)} onChange={(e) => setUnit(i, { sqft: numOr(e.target.value) })} />
                  </td>
                  <td className="py-1 text-right text-muted">{u.sqft > 0 ? (u.rent_monthly / u.sqft).toFixed(2) : "—"}</td>
                  <td className="py-1 text-right">
                    <input
                      className={cellCls}
                      inputMode="numeric"
                      placeholder="—"
                      value={u.sell_price == null ? "" : String(u.sell_price)}
                      onChange={(e) => setUnit(i, { sell_price: e.target.value.trim() === "" ? null : numOr(e.target.value) })}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <button type="button" onClick={() => removeUnit(i)} className="text-xs text-muted hover:text-ink">
                      Remove
                    </button>
                  </td>
                </tr>
              ))}
              <tr className="font-medium">
                <td className="py-1.5" colSpan={2}>
                  Total / weighted average
                </td>
                <td className="py-1.5 text-right">{result.totalMix.totalUnits}</td>
                <td className="py-1.5 text-right">{money(result.totalMix.avgRent)}</td>
                <td className="py-1.5 text-right">{Math.round(result.totalMix.avgSqft).toLocaleString()}</td>
                <td className="py-1.5 text-right">{result.totalMix.avgRentPerSf.toFixed(2)}</td>
                <td colSpan={2} className="py-1.5 text-right text-xs font-normal text-muted">
                  {Math.round(result.totalMix.totalSqft).toLocaleString()} net rentable SF
                </td>
              </tr>
            </tbody>
          </table>
        </div>
        <div className="mt-2 flex gap-2">
          <button type="button" onClick={() => addUnit("market")} className="rounded border border-line px-2 py-1 text-xs hover:bg-black/[0.03]">
            + Market type
          </button>
          <button type="button" onClick={() => addUnit("affordable")} className="rounded border border-line px-2 py-1 text-xs hover:bg-black/[0.03]">
            + Affordable type
          </button>
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        <Section title="Other income" hint="Commercial is annual $/SF; everything else is monthly.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Commercial $/SF/yr" value={oi.commercialRentPerSfYear} onChange={(n) => setA({ otherIncome: { ...oi, commercialRentPerSfYear: n } })} width="w-full" />
            <Field label="Garage $/mo" value={oi.garageRentMonthly} onChange={(n) => setA({ otherIncome: { ...oi, garageRentMonthly: n } })} width="w-full" />
            <Field label="Surface $/mo" value={oi.surfaceRentMonthly} onChange={(n) => setA({ otherIncome: { ...oi, surfaceRentMonthly: n } })} width="w-full" />
            <Field label="Storage $/mo" value={oi.storageRentMonthly} onChange={(n) => setA({ otherIncome: { ...oi, storageRentMonthly: n } })} width="w-full" />
            <Field label="Grab & Go $/unit/mo" value={oi.grabAndGoPerUnitMonthly} onChange={(n) => setA({ otherIncome: { ...oi, grabAndGoPerUnitMonthly: n } })} width="w-full" />
            <Field label="Wifi $/unit/mo" value={oi.wifiPerUnitMonthly} onChange={(n) => setA({ otherIncome: { ...oi, wifiPerUnitMonthly: n } })} width="w-full" />
            <Field label="Pet share" value={oi.petSharePct} onChange={(n) => setA({ otherIncome: { ...oi, petSharePct: n } })} width="w-full" hint="0.4 = 40% of units" />
            <Field label="Pet $/mo" value={oi.petRentMonthly} onChange={(n) => setA({ otherIncome: { ...oi, petRentMonthly: n } })} width="w-full" />
            <Field label="Utility billback $/unit/yr" value={oi.utilityBillbackPerUnitYear} onChange={(n) => setA({ otherIncome: { ...oi, utilityBillbackPerUnitYear: n } })} width="w-full" />
            <Field label="Misc $/unit/yr" value={oi.miscPerUnitYear} onChange={(n) => setA({ otherIncome: { ...oi, miscPerUnitYear: n } })} width="w-full" />
          </div>
        </Section>

        <Section title="Operating expenses" hint="Annual per unit, except payroll and the management fee.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Utilities" value={op.utilitiesPerUnit} onChange={(n) => setA({ opex: { ...op, utilitiesPerUnit: n } })} width="w-full" />
            <Field label="Make ready" value={op.makeReadyPerUnit} onChange={(n) => setA({ opex: { ...op, makeReadyPerUnit: n } })} width="w-full" />
            <Field label="Marketing" value={op.marketingPerUnit} onChange={(n) => setA({ opex: { ...op, marketingPerUnit: n } })} width="w-full" />
            <Field label="Repairs" value={op.repairsPerUnit} onChange={(n) => setA({ opex: { ...op, repairsPerUnit: n } })} width="w-full" />
            <Field label="Contract services" value={op.contractServicesPerUnit} onChange={(n) => setA({ opex: { ...op, contractServicesPerUnit: n } })} width="w-full" />
            <Field label="G&A" value={op.generalAdminPerUnit} onChange={(n) => setA({ opex: { ...op, generalAdminPerUnit: n } })} width="w-full" />
            <Field label="Insurance" value={op.insurancePerUnit} onChange={(n) => setA({ opex: { ...op, insurancePerUnit: n } })} width="w-full" />
            <Field label="Taxes" value={op.taxesPerUnit} onChange={(n) => setA({ opex: { ...op, taxesPerUnit: n } })} width="w-full" hint="Per unit — deal specific" />
            <Field label="Reserves" value={op.reservesPerUnit} onChange={(n) => setA({ opex: { ...op, reservesPerUnit: n } })} width="w-full" />
            <Field label="Payroll burden" value={op.payrollBurdenPct} onChange={(n) => setA({ opex: { ...op, payrollBurdenPct: n } })} width="w-full" hint="0.35 = 35% load" />
            <Field label="Mgmt fee (resi EGI)" value={op.managementFeePctOfResidentialEgi} onChange={(n) => setA({ opex: { ...op, managementFeePctOfResidentialEgi: n } })} width="w-full" hint="0.03 = 3%" />
          </div>
          <div className="mt-3">
            <p className="text-xs uppercase tracking-wide text-muted">Payroll salaries</p>
            {op.payrollSalaries.map((p, i) => (
              <div key={i} className="mt-1 flex items-center gap-2">
                <input
                  className="flex-1 rounded border border-line px-2 py-1 text-sm"
                  value={p.role}
                  onChange={(e) => {
                    const next = op.payrollSalaries.map((x, idx) => (idx === i ? { ...x, role: e.target.value } : x));
                    setA({ opex: { ...op, payrollSalaries: next } });
                  }}
                />
                <input
                  className={cellCls}
                  inputMode="numeric"
                  value={String(p.salary)}
                  onChange={(e) => {
                    const next = op.payrollSalaries.map((x, idx) => (idx === i ? { ...x, salary: numOr(e.target.value) } : x));
                    setA({ opex: { ...op, payrollSalaries: next } });
                  }}
                />
              </div>
            ))}
          </div>
        </Section>

        <Section title="Vacancy & exit" hint="What the deal is worth on the way out.">
          <div className="grid grid-cols-2 gap-3">
            <Field label="Resi vacancy" value={d.assumptions.vacancy.residentialPct} onChange={(n) => setA({ vacancy: { ...d.assumptions.vacancy, residentialPct: n } })} width="w-full" hint="0.05 = 5%" />
            <Field label="Commercial vacancy" value={d.assumptions.vacancy.commercialPct} onChange={(n) => setA({ vacancy: { ...d.assumptions.vacancy, commercialPct: n } })} width="w-full" />
            <Field label="Asset mgmt fee" value={d.assumptions.assetManagementFeePct} onChange={(n) => setA({ assetManagementFeePct: n })} width="w-full" hint="0.015 = 1.5% of EGI" />
            <Field label="OZ partnership exp." value={d.assumptions.ozPartnershipExpenses} onChange={(n) => setA({ ozPartnershipExpenses: n })} width="w-full" />
            <Field label="Exit cap rate" value={d.assumptions.exit.capRate} onChange={(n) => setA({ exit: { ...d.assumptions.exit, capRate: n } })} width="w-full" hint="0.055 = 5.50%" />
            <Field label="Asset sale costs" value={d.assumptions.exit.saleCostPct} onChange={(n) => setA({ exit: { ...d.assumptions.exit, saleCostPct: n } })} width="w-full" hint="% of value" />
            <Field label="Unit selling costs" value={d.assumptions.sellOut.saleCostPct} onChange={(n) => setA({ sellOut: { ...d.assumptions.sellOut, saleCostPct: n } })} width="w-full" hint="0.05 = 5% per unit" />
          </div>
        </Section>
      </div>

      {/* ---------- Save ---------- */}
      <form action={saveDeal} className="flex flex-wrap items-center gap-3 rounded-lg border border-line bg-white p-4">
        <input type="hidden" name="dealId" value={d.id} />
        <input type="hidden" name="name" value={d.name} />
        <input type="hidden" name="address" value={d.address} />
        <input type="hidden" name="city" value={d.city} />
        <input type="hidden" name="state" value={d.state} />
        <input type="hidden" name="gross_sqft" value={d.grossSqft} />
        <input type="hidden" name="commercial_sqft" value={d.commercialSqft} />
        <input type="hidden" name="height_stories" value={d.heightStories} />
        <input type="hidden" name="garage_spaces" value={d.garageSpaces} />
        <input type="hidden" name="surface_spaces" value={d.surfaceSpaces} />
        <input type="hidden" name="storage_spaces" value={d.storageSpaces} />
        <input type="hidden" name="total_project_cost" value={d.totalProjectCost} />
        <input type="hidden" name="notes" value={d.notes} />
        <input type="hidden" name="assumptions" value={JSON.stringify(d.assumptions)} />
        <input type="hidden" name="units" value={JSON.stringify(d.units)} />
        <SubmitButton className="rounded bg-ink px-4 py-2 text-sm text-white hover:bg-ink/90">Save deal</SubmitButton>
        <span className="text-xs text-muted">
          Everything above recomputes as you type — saving persists it and lets the comp tools read the mix.
        </span>
      </form>
    </div>
  );
}
