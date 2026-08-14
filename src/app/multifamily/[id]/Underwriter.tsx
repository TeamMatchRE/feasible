"use client";

import { useMemo, useState } from "react";
import {
  underwrite,
  type LineDetail,
  type LineDetails,
  type MultiFamilyInputs,
  type ProformaLine,
  type UnitTypeInput,
} from "@/lib/multifamily";
import { buildCost, type CostProgram } from "@/lib/mf-costs";
import { saveDeal } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { MfAssumptions } from "@/lib/mf-queries";
import CostProgramPanel from "./CostProgram";
import { LineDetailEditor, type LineContext } from "./LineDetail";

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
  /**
   * Per-product cost basis. Both null on a normal single-building deal, where
   * the cost program's one residential rate and one circulation efficiency are
   * the right answer. Set them when the deal builds more than one product —
   * detached houses, townhomes and stacked flats cost different amounts per SF
   * and only the flats have corridors to gross up for.
   */
  cost_per_sf: number | null;
  gross_factor: number | null;
  /**
   * 'sell' or 'hold' for this product. null on EVERY row keeps the deal on the
   * old model, where sellOut.shareSold prorates the whole mix. Setting it on any
   * row switches the deal to designated mode — see Disposition in
   * @/lib/multifamily.
   */
  disposition: "sell" | "hold" | null;
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
  costProgram: CostProgram;
  lineDetails: LineDetails;
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

/**
 * One proforma row, with its detail editor as an inline drawer.
 *
 * MODULE SCOPE ON PURPOSE. Defined inside Underwriter's body this is a new
 * component type on every render, so React unmounts and remounts the whole
 * subtree each keystroke — the text input loses focus after one character and
 * typing "84000" leaves you with "8". Keep it out here.
 *
 * A drawer rather than a modal so the rest of the proforma stays on screen and
 * you can watch NOI move as you type.
 */
function ProformaRow({
  line: l, detail, ctx, open, onToggle, onChange, negate = false, bold = false, allowPctEgi = true,
}: {
  line: ProformaLine;
  detail: LineDetail | undefined;
  ctx: LineContext;
  open: boolean;
  onToggle: () => void;
  onChange: (next: LineDetail | undefined) => void;
  negate?: boolean;
  bold?: boolean;
  allowPctEgi?: boolean;
}) {
  const sign = negate ? -1 : 1;
  return (
    <>
      <tr className={`border-b border-line/50 ${bold ? "font-medium" : ""}`}>
        <td className="py-1">
          <button
            type="button"
            onClick={onToggle}
            className={`flex items-center gap-1.5 text-left ${bold ? "text-ink" : "text-muted"} hover:text-ink`}
          >
            <span className={`text-[10px] transition-transform ${open ? "rotate-90" : ""}`}>▸</span>
            <span className="underline decoration-dotted underline-offset-2">{l.label}</span>
            {l.mode === "itemized" && (
              <span className="rounded-full bg-ink/10 px-1.5 py-0.5 text-[10px] font-medium text-ink">
                detailed
              </span>
            )}
          </button>
        </td>
        <td className={`py-1 text-right ${bold ? "" : "text-ink"}`}>
          {money(sign * l.amount)}
          {l.mode === "itemized" && l.amount !== l.estimated && (
            <span className="ml-2 text-[11px] font-normal text-muted line-through">
              {money(sign * l.estimated)}
            </span>
          )}
        </td>
      </tr>
      {open && (
        <tr>
          <td colSpan={2} className="pb-3 pt-1">
            <LineDetailEditor
              line={l}
              detail={detail}
              ctx={ctx}
              negate={negate}
              allowPctEgi={allowPctEgi}
              onChange={onChange}
              onClose={onToggle}
            />
          </td>
        </tr>
      )}
    </>
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
  const [tab, setTab] = useState<"underwriting" | "costs">("underwriting");
  const [openLine, setOpenLine] = useState<string | null>(null);
  const set = <K extends keyof DealState>(k: K, v: DealState[K]) => setD((p) => ({ ...p, [k]: v }));
  const setA = (patch: Partial<MfAssumptions>) => setD((p) => ({ ...p, assumptions: { ...p.assumptions, ...patch } }));

  /** Undefined removes the key entirely, so a cleared line leaves no residue behind. */
  const setLineDetail = (label: string, next: LineDetail | undefined) =>
    setD((p) => {
      const ld = { ...p.lineDetails };
      if (next) ld[label] = next;
      else delete ld[label];
      return { ...p, lineDetails: ld };
    });

  const setUnit = (i: number, patch: Partial<UnitRow>) =>
    setD((p) => ({ ...p, units: p.units.map((u, idx) => (idx === i ? { ...u, ...patch } : u)) }));
  const addUnit = (tier: "market" | "affordable") =>
    setD((p) => ({
      ...p,
      units: [...p.units, { tier, label: "New type", unit_count: 0, rent_monthly: 0, sqft: 0, sell_price: null, cost_per_sf: null, gross_factor: null, disposition: null }],
    }));
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
        disposition: u.disposition ?? undefined,
      }));

  /**
   * The budget runs FIRST, because its total is the cost basis every exit is
   * measured against. Both recompute on every keystroke, so raising the finish
   * level or adding a parking deck moves the recommendation at the top of the page
   * immediately — which is the whole reason to build it up rather than type it.
   */
  const build = useMemo(
    () =>
      buildCost({
        program: d.costProgram,
        mix: d.units.map((u) => ({
          label: u.label,
          count: u.unit_count,
          sqft: u.sqft,
          costPerSf: u.cost_per_sf,
          grossFactor: u.gross_factor,
        })),
        commercialSqft: d.commercialSqft,
      }),
    [d.costProgram, d.units, d.commercialSqft],
  );

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
      totalProjectCost: build.effectiveTotal,
      lineDetails: d.lineDetails,
      exit: d.assumptions.exit,
      sellOut: d.assumptions.sellOut,
    };
    return underwrite(inputs);
  }, [d, build.effectiveTotal]);

  const pf = result.proforma;
  const ex = result.exit;
  const oi = d.assumptions.otherIncome;
  const op = d.assumptions.opex;

  const line = (label: string): ProformaLine =>
    pf.lines.find((l) => l.label === label) ?? { label, estimated: 0, amount: 0, mode: "estimate", items: [] };

  const lineCtx: LineContext = {
    units: result.totalMix.totalUnits,
    netSqft: result.totalMix.totalSqft,
    egiTotal: pf.egiTotal,
  };

  const INCOME_LABELS = [
    "Base Rental Income", "Parking", "Storage", "Pet Income",
    "Utility Billback", "Grab & Go", "Wifi", "Misc. Income",
  ];

  /** Bind the module-level row to this deal's state. */
  const row = (label: string, opts: { negate?: boolean; allowPctEgi?: boolean } = {}) => (
    <ProformaRow
      key={label}
      line={line(label)}
      detail={d.lineDetails[label]}
      ctx={lineCtx}
      open={openLine === label}
      onToggle={() => setOpenLine(openLine === label ? null : label)}
      onChange={(next) => setLineDetail(label, next)}
      {...opts}
    />
  );

  return (
    <div className="space-y-5">
      {/* ---------- The answer, kept at the top ---------- */}
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-2">
          <h2 className="text-sm font-semibold text-ink">
            {ex.designated ? "The program as designated" : "Build to rent, sell out, or blend"}
          </h2>
          <span className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white">
            {ex.designated ? "Designated" : ex.recommendation.best}
          </span>
        </div>
        <p className="mt-1 text-xs text-muted">{ex.recommendation.note}</p>

        {/*
          A designated program has no exit to choose, so the three-way comparison is
          replaced by the plan's two halves plus its total. Build-to-rent and sell-out
          are NOT shown here: with the mix designated they measure one portion's
          revenue against the whole project's cost, which reads as a huge loss that
          isn't real. See the warnings in analyzeExits.
        */}
        {ex.designated && ex.portions ? (
          <div className="mt-3 grid gap-3 sm:grid-cols-3">
            <div className="rounded border border-line p-3">
              <p className="text-xs uppercase tracking-wide text-muted">
                Sold portion — {ex.portions.sold.units.toLocaleString()} units
              </p>
              {ex.portions.sold.priced ? (
                <>
                  <p className="mt-0.5 text-xl font-semibold text-ink">{money(ex.portions.sold.netProceeds)}</p>
                  <p className="text-xs text-muted">
                    net of {money(ex.portions.sold.saleCosts)} selling costs ·{" "}
                    {money(ex.portions.sold.proceedsPerUnit)}/unit
                  </p>
                  <p className="mt-1 text-xs text-muted">gross {money(ex.portions.sold.grossProceeds)}</p>
                </>
              ) : (
                <p className="mt-0.5 text-sm text-muted">
                  Not priced. Set a sale price on the types marked Sell (or pull one from a for-sale
                  comp below).
                </p>
              )}
            </div>
            <div className="rounded border border-line p-3">
              <p className="text-xs uppercase tracking-wide text-muted">
                Held portion — {ex.portions.held.units.toLocaleString()} units
              </p>
              <p className="mt-0.5 text-xl font-semibold text-ink">{money(ex.portions.held.netValue)}</p>
              <p className="text-xs text-muted">
                NOI {money(ex.portions.held.noi)} ÷ {pct(ex.portions.held.capRate)} ={" "}
                {money(ex.portions.held.grossValue)} · {money(ex.portions.held.valuePerUnit)}/unit
              </p>
              <p className="mt-1 text-xs text-muted">net of {money(ex.portions.held.saleCosts)} sale costs</p>
            </div>
            <div className="rounded border border-line p-3">
              <p className="text-xs uppercase tracking-wide text-muted">The plan</p>
              <p
                className={`mt-0.5 text-xl font-semibold ${ex.blend.profit < 0 ? "text-red-600" : "text-ink"}`}
              >
                {money(ex.blend.profit)}
              </p>
              <p className="text-xs text-muted">
                total value {money(ex.blend.totalValue)} · margin {pct(ex.blend.profitMargin, 1)}
              </p>
              <p className="mt-1 text-xs text-muted">
                Cost is not split between the two halves — one site serves both, so profit belongs to
                the plan as a whole.
              </p>
            </div>
          </div>
        ) : (
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
        )}
      </section>

      {/* ---------- The answer stays above the tabs; the inputs split below ------- */}
      <div className="flex gap-1 border-b border-line">
        {([
          ["underwriting", "Underwriting"],
          ["costs", "Multi-family costs"],
        ] as const).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setTab(key)}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              tab === key ? "border-ink font-medium text-ink" : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {label}
            {key === "costs" && (
              <span className="ml-2 text-xs text-muted">{money(build.effectiveTotal)}</span>
            )}
          </button>
        ))}
      </div>

      {tab === "costs" && (
        <CostProgramPanel
          dealId={d.id}
          program={d.costProgram}
          build={build}
          unitLabels={d.units.map((u) => ({ label: u.label, count: u.unit_count }))}
          onChange={(next) => set("costProgram", next)}
        />
      )}

      {tab === "underwriting" && (
      <>
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
            <div className="col-span-2 rounded border border-line bg-black/[0.02] p-2">
              <p className="text-xs uppercase tracking-wide text-muted">Total project cost</p>
              <p className="text-lg font-semibold text-ink">{money(build.effectiveTotal)}</p>
              <p className="text-xs text-muted">
                {money(result.costPerUnit)} / unit ·{" "}
                {build.usingOverride ? "hand-entered override" : "built up from the budget"} —{" "}
                <button
                  type="button"
                  onClick={() => setTab("costs")}
                  className="underline decoration-dotted underline-offset-2 hover:text-ink"
                >
                  edit in Costs
                </button>
              </p>
            </div>
            <Field label="Gross SF" value={d.grossSqft} onChange={(n) => set("grossSqft", n)} width="w-full" hint={`budget builds ${Math.round(build.buildingGrossSqft).toLocaleString()}`} />
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
              {/* Income resolves before EGI exists, so % of EGI isn't offered here. */}
              {INCOME_LABELS.map((label) => row(label, { allowPctEgi: false }))}
              <tr className="border-b border-line font-medium">
                <td className="py-1">Gross Income — Residential</td>
                <td className="py-1 text-right">{money(pf.grossResidentialIncome)}</td>
              </tr>
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Residential Vacancy</td>
                <td className="py-1 text-right text-ink">{money(pf.residentialVacancy)}</td>
              </tr>
              {row("Commercial Income", { allowPctEgi: false })}
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Commercial Vacancy</td>
                <td className="py-1 text-right text-ink">{money(pf.commercialVacancy)}</td>
              </tr>
              <tr className="border-b border-line font-medium">
                <td className="py-1">EGI — Total</td>
                <td className="py-1 text-right">{money(pf.egiTotal)}</td>
              </tr>
              {pf.expenses.map((e) => row(e.label, { negate: true }))}
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
            Click any line to itemize it — the sub-lines replace the standardized estimate and the
            estimate stays visible beside it. Expense ratio on residential EGI only (the Procopio
            convention) is {pct(pf.expenseRatioOnResidentialEgi)} — higher, because whole-building costs
            divide by residential-only revenue. Reported for reconciliation; don&rsquo;t drive expenses
            off it.
          </p>
        </Section>
      </div>

      {/* ---------- Unit mix ---------- */}
      <Section
        title="Unit mix"
        hint="Market-rate and affordable tiers price the same bedroom count differently, so they're separate rows. Leave Cost $/SF and Gross blank to follow the cost program; set them per row when the deal builds more than one product type."
      >
        <div className="overflow-x-auto">
          <table className="w-full min-w-[1020px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 font-medium">Tier</th>
                <th className="py-1 font-medium">Type</th>
                <th className="py-1 text-right font-medium">Units</th>
                <th className="py-1 text-right font-medium">Rent /mo</th>
                <th className="py-1 text-right font-medium">SF</th>
                <th className="py-1 text-right font-medium">$/SF</th>
                <th className="py-1 text-right font-medium" title="Hard cost per SF for this product. Blank = follow the cost program.">Cost $/SF</th>
                <th className="py-1 text-right font-medium" title="Net-to-gross divisor. Blank = follow the program's circulation efficiency. 1 = no grossing (detached house, townhome).">Gross</th>
                <th className="py-1 text-right font-medium">Sale price</th>
                <th className="py-1 font-medium" title="Sell this product or hold it. Leave on Prorate everywhere to split the whole deal by the sell-out share instead.">Exit</th>
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
                      placeholder="prog."
                      value={u.cost_per_sf == null ? "" : String(u.cost_per_sf)}
                      onChange={(e) => setUnit(i, { cost_per_sf: e.target.value.trim() === "" ? null : numOr(e.target.value) })}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <input
                      className={cellCls}
                      inputMode="decimal"
                      placeholder="prog."
                      value={u.gross_factor == null ? "" : String(u.gross_factor)}
                      onChange={(e) => setUnit(i, { gross_factor: e.target.value.trim() === "" ? null : numOr(e.target.value) })}
                    />
                  </td>
                  <td className="py-1 text-right">
                    <input
                      className={cellCls}
                      inputMode="numeric"
                      placeholder="—"
                      value={u.sell_price == null ? "" : String(u.sell_price)}
                      onChange={(e) => setUnit(i, { sell_price: e.target.value.trim() === "" ? null : numOr(e.target.value) })}
                    />
                  </td>
                  <td className="py-1 pl-2">
                    <select
                      className="rounded border border-line px-1 py-1 text-xs"
                      value={u.disposition ?? ""}
                      onChange={(e) => setUnit(i, { disposition: e.target.value === "" ? null : (e.target.value as "sell" | "hold") })}
                    >
                      <option value="">Prorate</option>
                      <option value="sell">Sell</option>
                      <option value="hold">Hold</option>
                    </select>
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
                <td colSpan={5} className="py-1.5 text-right text-xs font-normal text-muted">
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
      </>
      )}

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
        {/* The column keeps the number the underwrite actually used, so the deals
            list and any reader outside this editor see the same figure. */}
        <input type="hidden" name="total_project_cost" value={build.effectiveTotal} />
        <input type="hidden" name="notes" value={d.notes} />
        <input type="hidden" name="assumptions" value={JSON.stringify(d.assumptions)} />
        <input type="hidden" name="cost_program" value={JSON.stringify(d.costProgram)} />
        <input type="hidden" name="line_details" value={JSON.stringify(d.lineDetails)} />
        <input type="hidden" name="units" value={JSON.stringify(d.units)} />
        <SubmitButton className="rounded bg-ink px-4 py-2 text-sm text-white hover:bg-ink/90">Save deal</SubmitButton>
        <span className="text-xs text-muted">
          Everything above recomputes as you type — saving persists it and lets the comp tools read the mix.
        </span>
      </form>
    </div>
  );
}
