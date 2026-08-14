"use client";

import { useActionState } from "react";
import {
  FINISH_LEVELS,
  FINISH_RATES,
  PARKING_TYPES,
  PARKING_TYPE_LABEL,
  PARKING_DEFAULTS,
  INFRA_BASES,
  INFRA_BASIS_LABEL,
  defaultRatioFor,
  suggestRoadLf,
  type CostProgram,
  type CostBuildResult,
  type CommonArea,
  type CommonPlacement,
  type InfraLine,
  type ParkingType,
  type FinishLevel,
  AMENITY_PRESETS,
  amenityFromPreset,
} from "@/lib/mf-costs";
import { refineParkingAction, type RefineState } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * MULTI-FAMILY COSTS — the development budget that produces the cost basis.
 *
 * Laid out in the order a developer decides things: how well it's finished, what
 * amenity space gets built and whether it's attached or its own building, how much
 * parking the mix demands and how it's structured, what the site work costs, then
 * the loads on top. The rolled-up total feeds the underwrite directly, so a change
 * anywhere here moves the exit comparison at the top of the page.
 */

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const sf = (n: number) => Math.round(n).toLocaleString("en-US");
const numOr = (s: string, fallback = 0) => {
  const n = Number(String(s).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

const cell = "w-24 rounded border border-line px-2 py-1 text-right text-sm";
const cellSm = "w-20 rounded border border-line px-2 py-1 text-right text-sm";

function Section({ title, hint, children }: { title: string; hint?: string; children: React.ReactNode }) {
  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <h3 className="text-sm font-semibold text-ink">{title}</h3>
      {hint && <p className="mt-0.5 text-xs text-muted">{hint}</p>}
      <div className="mt-3">{children}</div>
    </section>
  );
}

/** An input that shows a computed default in grey until you type your own. */
function RateInput({
  value, fallback, onChange, className = cell,
}: { value: number | null; fallback: number; onChange: (n: number | null) => void; className?: string }) {
  return (
    <input
      className={`${className} ${value == null ? "text-muted" : ""}`}
      inputMode="decimal"
      placeholder={String(Math.round(fallback))}
      value={value == null ? "" : String(value)}
      onChange={(e) => onChange(e.target.value.trim() === "" ? null : numOr(e.target.value))}
    />
  );
}

export default function CostProgramPanel({
  dealId, program, build, unitLabels, onChange,
}: {
  dealId: string;
  program: CostProgram;
  build: CostBuildResult;
  /** Labels present in the mix, so the ratio table matches the deal. */
  unitLabels: { label: string; count: number }[];
  onChange: (next: CostProgram) => void;
}) {
  const p = program;
  const set = (patch: Partial<CostProgram>) => onChange({ ...p, ...patch });
  const rates = FINISH_RATES[p.finishLevel];
  const pk = build.parking;

  const [refine, refineAction] = useActionState<RefineState, FormData>(refineParkingAction, null);

  // ---- common areas -------------------------------------------------------
  const setCommon = (id: string, patch: Partial<CommonArea>) =>
    set({ commonAreas: p.commonAreas.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  /**
   * Add from the catalog, or a blank line. Either way the row is fully editable
   * afterwards — a preset is a starting point with a defensible size on it, not
   * a fixed product.
   */
  const addPreset = (presetId: string) => {
    if (!presetId) return;
    const uid = `c${Date.now().toString(36)}${Math.floor(Math.random() * 1e4).toString(36)}`;
    if (presetId === "__blank") {
      set({ commonAreas: [...p.commonAreas, { id: uid, name: "", placement: "detached", sqft: 0, costPerSf: null, lumpCost: null }] });
      return;
    }
    if (presetId === "__blank_lump") {
      set({ commonAreas: [...p.commonAreas, { id: uid, name: "", placement: "detached", sqft: 0, costPerSf: null, lumpCost: 0 }] });
      return;
    }
    const preset = AMENITY_PRESETS.find((a) => a.id === presetId);
    if (preset) set({ commonAreas: [...p.commonAreas, amenityFromPreset(preset, uid)] });
  };

  const removeCommon = (id: string) => set({ commonAreas: p.commonAreas.filter((c) => c.id !== id) });

  // ---- parking ------------------------------------------------------------
  const setParking = (patch: Partial<CostProgram["parking"]>) => set({ parking: { ...p.parking, ...patch } });
  const setRatio = (label: string, spacesPerUnit: number) => {
    const others = p.parking.ratios.filter((r) => r.label !== label);
    setParking({ ratios: [...others, { label, spacesPerUnit }] });
  };
  const setComponent = (id: string, patch: Partial<CostProgram["parking"]["components"][number]>) =>
    setParking({ components: p.parking.components.map((c) => (c.id === id ? { ...c, ...patch } : c)) });
  const addComponent = (type: ParkingType) =>
    setParking({
      components: [
        ...p.parking.components,
        { id: `p${Date.now()}`, type, spaces: 0, costPerSpace: null, sfFactor: null },
      ],
    });
  const removeComponent = (id: string) =>
    setParking({ components: p.parking.components.filter((c) => c.id !== id) });

  /** Push the shortfall (or pull the surplus) into the first component. */
  const matchRequired = () => {
    const first = p.parking.components[0];
    if (!first) {
      addComponent("surface");
      return;
    }
    setComponent(first.id, { spaces: Math.max(0, first.spaces + (pk.requiredSpaces - pk.providedSpaces)) });
  };

  // ---- infrastructure -----------------------------------------------------
  const setInfra = (id: string, patch: Partial<InfraLine>) =>
    set({ infrastructure: p.infrastructure.map((l) => (l.id === id ? { ...l, ...patch } : l)) });
  const addInfra = () =>
    set({
      infrastructure: [
        ...p.infrastructure,
        { id: `i${Date.now()}`, name: "", basis: "lump", quantity: 1, rate: 0 },
      ],
    });
  const removeInfra = (id: string) => set({ infrastructure: p.infrastructure.filter((l) => l.id !== id) });

  const suggestedRoad = suggestRoadLf({
    surfaceSpaces: pk.components.filter((c) => c.type === "surface").reduce((s, c) => s + c.spaces, 0),
    structuredSpaces: pk.components.filter((c) => c.type !== "surface").reduce((s, c) => s + c.spaces, 0),
  });
  const roadLine = p.infrastructure.find((l) => l.id === "road");

  /** Apply an AI refinement to the program. Explicit — nothing lands on its own. */
  const applyRefinement = () => {
    const r = refine?.refinement;
    if (!r) return;
    const next = { ...p.parking };
    if (r.ratios) {
      const byLabel = new Map(next.ratios.map((x) => [x.label, x]));
      for (const x of r.ratios) byLabel.set(x.label, x);
      next.ratios = [...byLabel.values()];
    }
    if (r.guestPerUnit != null) next.guestPerUnit = r.guestPerUnit;
    if (r.stallWidthFt != null) next.stallWidthFt = r.stallWidthFt;
    if (r.stallDepthFt != null) next.stallDepthFt = r.stallDepthFt;
    if (r.aisleFactor != null) {
      next.components = next.components.map((c) =>
        c.type === "surface" ? { ...c, sfFactor: r.aisleFactor } : c,
      );
    }
    const infra =
      r.roadLf != null
        ? p.infrastructure.map((l) => (l.id === "road" ? { ...l, quantity: r.roadLf as number } : l))
        : p.infrastructure;
    onChange({ ...p, parking: next, infrastructure: infra });
  };

  return (
    <div className="space-y-5">
      {/* ================= COST BASIS — the answer this section produces ========= */}
      <section className="rounded-lg border border-line bg-white p-4">
        <div className="flex flex-wrap items-baseline justify-between gap-3">
          <h2 className="text-sm font-semibold text-ink">Cost basis</h2>
          <div className="flex flex-wrap gap-4 text-xs">
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={p.useComputed} onChange={() => set({ useComputed: true })} />
              <span>Built up from the budget</span>
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" checked={!p.useComputed} onChange={() => set({ useComputed: false })} />
              <span>Override</span>
            </label>
          </div>
        </div>

        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <div className="rounded border border-line p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Total development cost</p>
            <p className="mt-0.5 text-2xl font-semibold text-ink">{money(build.effectiveTotal)}</p>
            <p className="text-xs text-muted">
              {money(build.costPerUnit)} / unit · {money(build.costPerNetSqft)} / net SF
            </p>
          </div>
          <div className="rounded border border-line p-3">
            <p className="text-xs uppercase tracking-wide text-muted">Built area</p>
            <p className="mt-0.5 text-sm text-ink">{sf(build.buildingGrossSqft)} SF enclosed</p>
            <p className="text-xs text-muted">
              {sf(build.residentialNetSqft)} net rentable · {sf(build.residentialGrossSqft)} residential gross
              {build.attachedCommonSqft > 0 && <> · {sf(build.attachedCommonSqft)} attached common</>}
              {build.detachedCommonSqft > 0 && <> · {sf(build.detachedCommonSqft)} detached</>}
            </p>
            <p className="mt-1 text-xs text-muted">{money(build.costPerGrossSqft)} / gross SF</p>
          </div>
          <div className="rounded border border-line p-3">
            {p.useComputed ? (
              <>
                <p className="text-xs uppercase tracking-wide text-muted">Override</p>
                <p className="mt-0.5 text-sm text-muted">
                  Not in use. The budget below drives all three exits.
                </p>
              </>
            ) : (
              <>
                <p className="text-xs uppercase tracking-wide text-muted">Override in use</p>
                <input
                  className="mt-1 w-full rounded border border-line px-2 py-1 text-right text-sm"
                  inputMode="numeric"
                  value={String(p.overrideTotal)}
                  onChange={(e) => set({ overrideTotal: numOr(e.target.value) })}
                />
                <p className="mt-1 text-xs text-muted">
                  Budget says {money(build.computedTotal)} —{" "}
                  <span className={build.computedTotal > p.overrideTotal ? "text-red-600" : "text-ink"}>
                    {money(build.computedTotal - p.overrideTotal)}
                  </span>{" "}
                  {build.computedTotal >= p.overrideTotal ? "above" : "below"} your number
                </p>
              </>
            )}
          </div>
        </div>

        {/* The roll-up, in the order it's built. */}
        <table className="mt-4 w-full text-sm">
          <tbody>
            {build.hardLines.map((l) => (
              <tr key={l.key} className="border-b border-line/50">
                <td className="py-1 text-muted">
                  {l.label}
                  <span className="ml-2 text-[11px] text-muted/70">{l.detail}</span>
                </td>
                <td className="py-1 text-right text-ink">{money(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-b border-line font-medium">
              <td className="py-1">Hard cost</td>
              <td className="py-1 text-right">{money(build.hardCost)}</td>
            </tr>
            {build.landCost > 0 && (
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Land</td>
                <td className="py-1 text-right text-ink">{money(build.landCost)}</td>
              </tr>
            )}
            {build.softLines.map((l) => (
              <tr key={l.key} className="border-b border-line/50">
                <td className="py-1 text-muted">
                  {l.label}
                  <span className="ml-2 text-[11px] text-muted/70">{l.detail}</span>
                </td>
                <td className="py-1 text-right text-ink">{money(l.amount)}</td>
              </tr>
            ))}
            <tr className="border-b border-line/50">
              <td className="py-1 text-muted">
                Developer fee
                <span className="ml-2 text-[11px] text-muted/70">
                  {(p.developerFeePct * 100).toFixed(1)}% of land + hard + soft
                </span>
              </td>
              <td className="py-1 text-right text-ink">{money(build.developerFee)}</td>
            </tr>
            <tr className="text-base font-semibold">
              <td className="py-1.5">Total development cost</td>
              <td className="py-1.5 text-right">{money(build.computedTotal)}</td>
            </tr>
          </tbody>
        </table>
        <p className="mt-2 text-[11px] text-muted">
          Unit costs are ILLUSTRATIVE 2026 New England wood-frame placeholders, like the rest of the
          Costs catalog. Edit any rate — a typed rate overrides the finish level for that line only.
        </p>
      </section>

      <div className="grid gap-5 lg:grid-cols-2">
        {/* ================= FINISH LEVEL ===================================== */}
        <Section
          title="Finish level"
          hint="Sets the $/SF for every building line at once. Type over any rate to break from it."
        >
          <div className="flex flex-wrap gap-2">
            {FINISH_LEVELS.map((f) => (
              <button
                key={f}
                type="button"
                onClick={() => set({ finishLevel: f as FinishLevel })}
                className={`rounded border px-3 py-1.5 text-sm ${
                  p.finishLevel === f ? "border-ink bg-ink text-white" : "border-line hover:bg-black/[0.03]"
                }`}
              >
                {f}
              </button>
            ))}
          </div>

          <table className="mt-3 w-full text-sm">
            <tbody>
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Residential $/SF</td>
                <td className="py-1 text-right">
                  <RateInput
                    value={p.residentialCostPerSf}
                    fallback={rates.residential}
                    onChange={(n) => set({ residentialCostPerSf: n })}
                  />
                </td>
              </tr>
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Commercial shell $/SF</td>
                <td className="py-1 text-right">
                  <RateInput
                    value={p.commercialShellCostPerSf}
                    fallback={rates.commercialShell}
                    onChange={(n) => set({ commercialShellCostPerSf: n })}
                  />
                </td>
              </tr>
              <tr className="border-b border-line/50">
                <td className="py-1 text-muted">Commercial TI $/SF</td>
                <td className="py-1 text-right">
                  <RateInput
                    value={p.commercialTiCostPerSf}
                    fallback={rates.commercialTi}
                    onChange={(n) => set({ commercialTiCostPerSf: n })}
                  />
                </td>
              </tr>
              <tr>
                <td className="py-1 text-muted">
                  Circulation efficiency
                  <span className="ml-1 text-[11px] text-muted/70">0.85 = 85%</span>
                </td>
                <td className="py-1 text-right">
                  <input
                    className={cell}
                    inputMode="decimal"
                    value={String(p.circulationEfficiency)}
                    onChange={(e) => set({ circulationEfficiency: numOr(e.target.value) })}
                  />
                </td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            Efficiency covers <em>circulation and structure only</em> — corridors, stairs, elevators, walls,
            chases. Programmed amenity space belongs in Common areas below. Putting the lobby in both
            double-counts it.
          </p>
        </Section>

        {/* ================= COMMON AREAS ===================================== */}
        <Section
          title="Common areas"
          hint="Attached shares the building's structure and envelope. Detached is its own building on the site, so it prices higher."
        >
          <div className="overflow-x-auto">
            <table className="w-full min-w-[420px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1 font-medium">Space</th>
                  <th className="py-1 font-medium">Placement</th>
                  <th className="py-1 text-right font-medium">SF</th>
                  <th className="py-1 text-right font-medium">$/SF</th>
                  <th className="py-1 text-right font-medium">Cost</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {p.commonAreas.length === 0 && (
                  <tr>
                    <td colSpan={6} className="py-3 text-xs text-muted">
                      No amenity program yet. Add what this community is actually getting from
                      the picker below, then re-cost each line.
                    </td>
                  </tr>
                )}
                {p.commonAreas.map((c) => {
                  // A lump line is a pool or a gate: it costs money, encloses no
                  // building, and has no SF or $/SF to show.
                  const lump = c.lumpCost != null;
                  const rate = c.costPerSf ?? (c.placement === "attached" ? rates.attachedCommon : rates.detachedCommon);
                  return (
                    <tr key={c.id} className="border-b border-line/50">
                      <td className="py-1 pr-2">
                        <input
                          className="w-full min-w-[7rem] rounded border border-line px-2 py-1 text-sm"
                          placeholder={lump ? "e.g. Dog park" : "e.g. Lobby"}
                          value={c.name}
                          onChange={(e) => setCommon(c.id, { name: e.target.value })}
                        />
                      </td>
                      <td className="py-1 pr-2">
                        {lump ? (
                          <span className="text-xs text-muted">Lump sum</span>
                        ) : (
                          <select
                            className="rounded border border-line px-1 py-1 text-xs"
                            value={c.placement}
                            onChange={(e) => setCommon(c.id, { placement: e.target.value as CommonPlacement })}
                          >
                            <option value="attached">Attached</option>
                            <option value="detached">Detached</option>
                          </select>
                        )}
                      </td>
                      <td className="py-1 text-right">
                        {lump ? (
                          <span className="text-xs text-muted">—</span>
                        ) : (
                          <input
                            className={cellSm}
                            inputMode="numeric"
                            value={String(c.sqft)}
                            onChange={(e) => setCommon(c.id, { sqft: numOr(e.target.value) })}
                          />
                        )}
                      </td>
                      <td className="py-1 text-right">
                        {lump ? (
                          <input
                            className={cellSm}
                            inputMode="numeric"
                            value={String(c.lumpCost ?? 0)}
                            onChange={(e) => setCommon(c.id, { lumpCost: numOr(e.target.value) })}
                          />
                        ) : (
                          <RateInput
                            value={c.costPerSf}
                            fallback={c.placement === "attached" ? rates.attachedCommon : rates.detachedCommon}
                            onChange={(n) => setCommon(c.id, { costPerSf: n })}
                            className={cellSm}
                          />
                        )}
                      </td>
                      <td className="py-1 text-right text-muted">
                        {lump ? money(c.lumpCost ?? 0) : c.sqft > 0 ? money(c.sqft * rate) : "—"}
                      </td>
                      <td className="py-1 pl-2 text-right">
                        <button
                          type="button"
                          onClick={() => removeCommon(c.id)}
                          className="text-xs text-muted hover:text-ink"
                        >
                          ×
                        </button>
                      </td>
                    </tr>
                  );
                })}
                <tr className="font-medium">
                  <td className="py-1.5" colSpan={2}>
                    Total
                  </td>
                  <td className="py-1.5 text-right">
                    {sf(build.attachedCommonSqft + build.detachedCommonSqft)}
                  </td>
                  <td colSpan={3} className="py-1.5 text-right text-xs font-normal text-muted">
                    {sf(build.attachedCommonSqft)} attached · {sf(build.detachedCommonSqft)} detached
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <label className="text-xs text-muted" htmlFor="amenity-picker">
              Add amenity
            </label>
            <select
              id="amenity-picker"
              className="rounded border border-line px-2 py-1 text-xs"
              value=""
              onChange={(e) => {
                addPreset(e.target.value);
                e.currentTarget.value = "";
              }}
            >
              <option value="">Choose a feature…</option>
              {[...new Set(AMENITY_PRESETS.map((a) => a.group))].map((group) => (
                <optgroup key={group} label={group}>
                  {AMENITY_PRESETS.filter((a) => a.group === group).map((a) => (
                    <option key={a.id} value={a.id}>
                      {a.name}
                      {a.sqft ? ` — ${a.sqft.toLocaleString()} SF` : a.lump ? ` — ${money(a.lump)}` : ""}
                    </option>
                  ))}
                </optgroup>
              ))}
              <optgroup label="Custom">
                <option value="__blank">Blank building (per SF)</option>
                <option value="__blank_lump">Blank amenity (lump sum)</option>
              </optgroup>
            </select>
            <span className="text-[11px] text-muted">
              Sizes and costs are illustrative starting points — edit every line.
            </span>
          </div>
        </Section>
      </div>

      {/* ================= PARKING ============================================ */}
      <Section
        title="Parking"
        hint="Demand is sized off the unit mix by bedroom count, then priced by how it's structured."
      >
        <div className="grid gap-5 lg:grid-cols-3">
          {/* --- demand --- */}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Demand</p>
            <table className="mt-2 w-full text-sm">
              <tbody>
                {pk.demand.map((row) => (
                  <tr key={row.label} className="border-b border-line/50">
                    <td className="py-1 text-muted">{row.label}</td>
                    <td className="py-1 text-right text-xs text-muted">{row.units} ×</td>
                    <td className="py-1 pl-2 text-right">
                      <input
                        className="w-14 rounded border border-line px-1 py-0.5 text-right text-sm"
                        inputMode="decimal"
                        value={String(row.spacesPerUnit)}
                        onChange={(e) => setRatio(row.label, numOr(e.target.value))}
                      />
                    </td>
                    <td className="py-1 text-right text-ink">{row.spaces.toLocaleString()}</td>
                  </tr>
                ))}
                <tr className="border-b border-line/50">
                  <td className="py-1 text-muted">Guest</td>
                  <td className="py-1 text-right text-xs text-muted">
                    {unitLabels.reduce((s, u) => s + u.count, 0)} ×
                  </td>
                  <td className="py-1 pl-2 text-right">
                    <input
                      className="w-14 rounded border border-line px-1 py-0.5 text-right text-sm"
                      inputMode="decimal"
                      value={String(p.parking.guestPerUnit)}
                      onChange={(e) => setParking({ guestPerUnit: numOr(e.target.value) })}
                    />
                  </td>
                  <td className="py-1 text-right text-ink">{pk.guestSpaces.toLocaleString()}</td>
                </tr>
                <tr className="font-semibold">
                  <td className="py-1.5" colSpan={3}>
                    Required
                  </td>
                  <td className="py-1.5 text-right">{pk.requiredSpaces.toLocaleString()}</td>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">
              Defaults follow your rule — 1 bed = 1 space, 2 and 3 bed = 2 — plus guest parking. Edit any row.
              A fractional total rounds up.
            </p>
          </div>

          {/* --- geometry --- */}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">Stall geometry</p>
            <table className="mt-2 w-full text-sm">
              <tbody>
                <tr className="border-b border-line/50">
                  <td className="py-1 text-muted">Stall width (ft)</td>
                  <td className="py-1 text-right">
                    <input
                      className={cellSm}
                      inputMode="decimal"
                      value={String(p.parking.stallWidthFt)}
                      onChange={(e) => setParking({ stallWidthFt: numOr(e.target.value) })}
                    />
                  </td>
                </tr>
                <tr className="border-b border-line/50">
                  <td className="py-1 text-muted">Stall depth (ft)</td>
                  <td className="py-1 text-right">
                    <input
                      className={cellSm}
                      inputMode="decimal"
                      value={String(p.parking.stallDepthFt)}
                      onChange={(e) => setParking({ stallDepthFt: numOr(e.target.value) })}
                    />
                  </td>
                </tr>
                <tr className="border-b border-line/50">
                  <td className="py-1 text-muted">Bare stall</td>
                  <td className="py-1 text-right text-ink">{sf(pk.stallSqft)} SF</td>
                </tr>
                <tr className="border-b border-line/50">
                  <td className="py-1 text-muted">Total parking area</td>
                  <td className="py-1 text-right text-ink">{sf(pk.totalSqft)} SF</td>
                </tr>
                <tr>
                  <td className="py-1 text-muted">At grade (site area)</td>
                  <td className="py-1 text-right text-ink">
                    {sf(pk.surfaceSqft)} SF · {(pk.surfaceSqft / 43_560).toFixed(2)} ac
                  </td>
                </tr>
              </tbody>
            </table>
            <p className="mt-1 text-[11px] text-muted">
              The SF factor on each row below multiplies the bare stall to cover drive aisles — and for a
              structure, columns, ramps and cores. Only at-grade parking consumes site area; a deck stacks.
            </p>
          </div>

          {/* --- AI refine --- */}
          <div>
            <p className="text-xs uppercase tracking-wide text-muted">This site&rsquo;s zoning</p>
            <form action={refineAction} className="mt-2">
              <input type="hidden" name="dealId" value={dealId} />
              <SubmitButton className="w-full rounded border border-line px-3 py-2 text-sm hover:bg-black/[0.03]">
                Refine for this site with AI
              </SubmitButton>
            </form>
            <p className="mt-1 text-[11px] text-muted">
              Looks up what the town actually requires. It proposes — you apply.
            </p>

            {refine?.error && <p className="mt-2 text-xs text-red-600">{refine.error}</p>}

            {refine?.refinement && (
              // Capped and scrollable — the caveat list runs long on a town whose
              // ordinance the model couldn't fully retrieve, and that's the case
              // where you most want to read it, not the case where it should shove
              // the rest of the page off screen.
              <div className="mt-2 max-h-96 overflow-y-auto rounded border border-ink/25 bg-black/[0.02] p-2 text-xs">
                {refine.refinement.summary && <p className="text-ink">{refine.refinement.summary}</p>}
                <ul className="mt-1.5 space-y-0.5 text-muted">
                  {refine.refinement.ratios?.map((r) => (
                    <li key={r.label}>
                      {r.label}: {r.spacesPerUnit} / unit{" "}
                      <span className="text-muted/60">(now {defaultRatioFor(r.label)})</span>
                    </li>
                  ))}
                  {refine.refinement.guestPerUnit != null && <li>Guest: {refine.refinement.guestPerUnit} / unit</li>}
                  {refine.refinement.stallWidthFt != null && <li>Stall width: {refine.refinement.stallWidthFt} ft</li>}
                  {refine.refinement.stallDepthFt != null && <li>Stall depth: {refine.refinement.stallDepthFt} ft</li>}
                  {refine.refinement.aisleFactor != null && <li>Aisle factor: {refine.refinement.aisleFactor}×</li>}
                  {refine.refinement.roadLf != null && <li>Road: {refine.refinement.roadLf} LF</li>}
                </ul>
                {refine.refinement.caveats.length > 0 && (
                  <ul className="mt-1.5 list-disc space-y-0.5 pl-4 text-red-700">
                    {refine.refinement.caveats.map((c, i) => (
                      <li key={i}>{c}</li>
                    ))}
                  </ul>
                )}
                {refine.refinement.citations.length > 0 && (
                  <p className="mt-1.5 text-muted/70">{refine.refinement.citations.join(" · ")}</p>
                )}
              </div>
            )}
            {/* Outside the scroll box on purpose — the action must stay reachable
                however long the caveats run. */}
            {refine?.refinement && (
              <button
                type="button"
                onClick={applyRefinement}
                className="mt-2 rounded bg-ink px-2 py-1 text-xs text-white hover:bg-ink/90"
              >
                Apply what it found
              </button>
            )}
          </div>
        </div>

        {/* --- what gets built --- */}
        <div className="mt-5 overflow-x-auto">
          <table className="w-full min-w-[620px] text-sm">
            <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="py-1 font-medium">Structure</th>
                <th className="py-1 text-right font-medium">Spaces</th>
                <th className="py-1 text-right font-medium">SF factor</th>
                <th className="py-1 text-right font-medium">SF / space</th>
                <th className="py-1 text-right font-medium">Total SF</th>
                <th className="py-1 text-right font-medium">$/space</th>
                <th className="py-1 text-right font-medium">Cost</th>
                <th className="py-1" />
              </tr>
            </thead>
            <tbody>
              {p.parking.components.map((c) => {
                const computed = pk.components.find((x) => x.id === c.id);
                const d = PARKING_DEFAULTS[c.type];
                return (
                  <tr key={c.id} className="border-b border-line/50">
                    <td className="py-1 pr-2">
                      <select
                        className="rounded border border-line px-1 py-1 text-xs"
                        value={c.type}
                        onChange={(e) => setComponent(c.id, { type: e.target.value as ParkingType })}
                      >
                        {PARKING_TYPES.map((t) => (
                          <option key={t} value={t}>
                            {PARKING_TYPE_LABEL[t]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 text-right">
                      <input
                        className={cellSm}
                        inputMode="numeric"
                        value={String(c.spaces)}
                        onChange={(e) => setComponent(c.id, { spaces: numOr(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <RateInput
                        value={c.sfFactor}
                        fallback={d.sfFactor}
                        onChange={(n) => setComponent(c.id, { sfFactor: n })}
                        className="w-16 rounded border border-line px-2 py-1 text-right text-sm"
                      />
                    </td>
                    <td className="py-1 text-right text-muted">{sf(computed?.sfPerSpace ?? 0)}</td>
                    <td className="py-1 text-right text-muted">{sf(computed?.sqft ?? 0)}</td>
                    <td className="py-1 text-right">
                      <RateInput
                        value={c.costPerSpace}
                        fallback={d.costPerSpace}
                        onChange={(n) => setComponent(c.id, { costPerSpace: n })}
                      />
                    </td>
                    <td className="py-1 text-right text-ink">{money(computed?.cost ?? 0)}</td>
                    <td className="py-1 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeComponent(c.id)}
                        className="text-xs text-muted hover:text-ink"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
              <tr className="font-medium">
                <td className="py-1.5">Provided</td>
                <td className="py-1.5 text-right">{pk.providedSpaces.toLocaleString()}</td>
                <td colSpan={2} />
                <td className="py-1.5 text-right">{sf(pk.totalSqft)}</td>
                <td className="py-1.5 text-right text-xs font-normal text-muted">
                  {money(pk.costPerSpace)} avg
                </td>
                <td className="py-1.5 text-right">{money(pk.totalCost)}</td>
                <td />
              </tr>
            </tbody>
          </table>
        </div>

        <div className="mt-2 flex flex-wrap items-center gap-2">
          <select
            className="rounded border border-line px-2 py-1 text-xs"
            value=""
            onChange={(e) => e.target.value && addComponent(e.target.value as ParkingType)}
          >
            <option value="">+ Add parking…</option>
            {PARKING_TYPES.map((t) => (
              <option key={t} value={t}>
                {PARKING_TYPE_LABEL[t]}
              </option>
            ))}
          </select>
          {pk.surplusSpaces !== 0 && (
            <>
              <span className={`text-xs ${pk.surplusSpaces < 0 ? "text-red-600" : "text-muted"}`}>
                {pk.surplusSpaces < 0
                  ? `${Math.abs(pk.surplusSpaces)} spaces short of the ${pk.requiredSpaces} required`
                  : `${pk.surplusSpaces} spaces over the ${pk.requiredSpaces} required`}
              </span>
              <button
                type="button"
                onClick={matchRequired}
                className="rounded border border-line px-2 py-1 text-xs hover:bg-black/[0.03]"
              >
                Match required
              </button>
            </>
          )}
        </div>
      </Section>

      <div className="grid gap-5 lg:grid-cols-3">
        {/* Infrastructure is the widest table here — it gets two of the three
            columns so the rate and cost stay on screen while you edit. */}
        <div className="lg:col-span-2">
        {/* ================= INFRASTRUCTURE ================================== */}
        <Section title="Site infrastructure" hint="Road, utilities, drainage, landscape — the site, not the building.">
          <div className="overflow-x-auto">
            <table className="w-full min-w-[480px] text-sm">
              <thead className="border-b border-line text-left text-xs uppercase tracking-wide text-muted">
                <tr>
                  <th className="py-1 font-medium">Item</th>
                  <th className="py-1 font-medium">Basis</th>
                  <th className="py-1 text-right font-medium">Qty</th>
                  <th className="py-1 text-right font-medium">Rate</th>
                  <th className="py-1 text-right font-medium">Cost</th>
                  <th className="py-1" />
                </tr>
              </thead>
              <tbody>
                {p.infrastructure.map((l) => (
                  <tr key={l.id} className="border-b border-line/50">
                    <td className="py-1 pr-2">
                      <input
                        className="w-full min-w-[7rem] rounded border border-line px-2 py-1 text-sm"
                        value={l.name}
                        onChange={(e) => setInfra(l.id, { name: e.target.value })}
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        className="rounded border border-line px-1 py-1 text-xs"
                        value={l.basis}
                        onChange={(e) => setInfra(l.id, { basis: e.target.value as InfraLine["basis"] })}
                      >
                        {INFRA_BASES.map((b) => (
                          <option key={b} value={b}>
                            {INFRA_BASIS_LABEL[b]}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 text-right">
                      <input
                        className="w-16 rounded border border-line px-2 py-1 text-right text-sm"
                        inputMode="decimal"
                        disabled={l.basis === "lump"}
                        value={String(l.quantity)}
                        onChange={(e) => setInfra(l.id, { quantity: numOr(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 text-right">
                      <input
                        className={cellSm}
                        inputMode="decimal"
                        value={String(l.rate)}
                        onChange={(e) => setInfra(l.id, { rate: numOr(e.target.value) })}
                      />
                    </td>
                    <td className="py-1 text-right text-muted">
                      {money(l.basis === "lump" ? l.rate * (l.quantity || 1) : l.quantity * l.rate)}
                    </td>
                    <td className="py-1 pl-2 text-right">
                      <button
                        type="button"
                        onClick={() => removeInfra(l.id)}
                        className="text-xs text-muted hover:text-ink"
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div className="mt-2 flex flex-wrap items-center gap-2">
            <button
              type="button"
              onClick={addInfra}
              className="rounded border border-line px-2 py-1 text-xs hover:bg-black/[0.03]"
            >
              + Add item
            </button>
            {roadLine && roadLine.quantity !== suggestedRoad && (
              <button
                type="button"
                onClick={() => setInfra("road", { quantity: suggestedRoad })}
                className="text-xs text-muted underline hover:text-ink"
              >
                Estimate road at {suggestedRoad.toLocaleString()} LF from the parking layout
              </button>
            )}
          </div>
        </Section>
        </div>

        <div className="space-y-5">
        {/* ================= LOADS =========================================== */}
        <Section title="Land & loads" hint="What sits on top of hard cost.">
          <div className="grid grid-cols-2 gap-3">
            <label className="col-span-2 text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted">Land cost</span>
              <input
                className="mt-1 w-full rounded border border-line px-2 py-1 text-right text-sm"
                inputMode="numeric"
                value={String(p.landCost)}
                onChange={(e) => set({ landCost: numOr(e.target.value) })}
              />
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted">Soft costs</span>
              <input
                className="mt-1 w-full rounded border border-line px-2 py-1 text-right text-sm"
                inputMode="decimal"
                value={String(p.softCostPct)}
                onChange={(e) => set({ softCostPct: numOr(e.target.value) })}
              />
              <span className="mt-0.5 block text-[11px] text-muted">0.18 = 18% of hard</span>
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted">Contingency</span>
              <input
                className="mt-1 w-full rounded border border-line px-2 py-1 text-right text-sm"
                inputMode="decimal"
                value={String(p.contingencyPct)}
                onChange={(e) => set({ contingencyPct: numOr(e.target.value) })}
              />
              <span className="mt-0.5 block text-[11px] text-muted">0.05 = 5% of hard</span>
            </label>
            <label className="text-sm">
              <span className="block text-xs uppercase tracking-wide text-muted">Developer fee</span>
              <input
                className="mt-1 w-full rounded border border-line px-2 py-1 text-right text-sm"
                inputMode="decimal"
                value={String(p.developerFeePct)}
                onChange={(e) => set({ developerFeePct: numOr(e.target.value) })}
              />
              <span className="mt-0.5 block text-[11px] text-muted">0.04 = 4% of subtotal</span>
            </label>
          </div>
        </Section>

        {/* ================= WHERE THE MONEY GOES ============================ */}
        <Section title="Where the money goes" hint="Share of total development cost.">
          <table className="w-full text-sm">
            <tbody>
              {[
                ["Building", build.hardLines.filter((l) => !l.key.startsWith("parking_") && !l.key.startsWith("infra_")).reduce((s, l) => s + l.amount, 0)],
                ["Parking", pk.totalCost],
                ["Site infrastructure", build.hardLines.filter((l) => l.key.startsWith("infra_")).reduce((s, l) => s + l.amount, 0)],
                ["Land", build.landCost],
                ["Soft + contingency", build.softCost],
                ["Developer fee", build.developerFee],
              ].map(([label, amount]) => {
                const a = amount as number;
                const share = build.computedTotal > 0 ? a / build.computedTotal : 0;
                return (
                  <tr key={label as string} className="border-b border-line/50">
                    <td className="py-1 text-muted">{label}</td>
                    <td className="py-1 text-right text-ink">{money(a)}</td>
                    <td className="w-14 py-1 text-right text-xs text-muted">{(share * 100).toFixed(1)}%</td>
                  </tr>
                );
              })}
              <tr className="font-medium">
                <td className="py-1.5">Total</td>
                <td className="py-1.5 text-right">{money(build.computedTotal)}</td>
                <td className="py-1.5 text-right text-xs text-muted">100%</td>
              </tr>
            </tbody>
          </table>
          <p className="mt-2 text-[11px] text-muted">
            {pk.providedSpaces > 0 && (
              <>
                Parking is {((pk.totalCost / (build.computedTotal || 1)) * 100).toFixed(1)}% of the deal at{" "}
                {money(pk.costPerSpace)} a space — the line most worth restructuring when a deal is short.
              </>
            )}
          </p>
        </Section>
        </div>
      </div>
    </div>
  );
}
