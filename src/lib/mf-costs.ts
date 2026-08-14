/**
 * Multi-family DEVELOPMENT BUDGET — the cost side of the underwrite.
 *
 * `src/lib/multifamily.ts` measures three exits against ONE cost basis. Until now
 * that basis was a single number somebody typed. This builds it up instead, from
 * the things a developer actually decides:
 *
 *   units (net rentable ÷ efficiency × $/SF by finish level)
 *   + commercial shell + tenant improvements
 *   + common areas, ATTACHED (lobby, fitness) and DETACHED (pool, clubhouse)
 *   + parking, sized from the unit mix by bedroom count and priced by structure type
 *   + site infrastructure (road, utilities, drainage, landscape)
 *   + soft costs, contingency, developer fee, land
 *
 * DOUBLE-COUNTING IS THE TRAP HERE, so the boundaries are drawn explicitly:
 *   - The EFFICIENCY factor covers circulation and structure only — corridors,
 *     stairs, elevators, exterior walls, mechanical chases.
 *   - ATTACHED common areas are PROGRAMMED amenity space you list by name. They
 *     are added on top of the efficiency grossing, not inside it.
 * Put the lobby in one place or the other, never both. The UI says so too.
 *
 * RATES ARE ILLUSTRATIVE — 2026 New England wood-frame placeholders, in the same
 * spirit as src/lib/costs.ts. They are a starting point to edit, not a quote.
 */

// ---------------------------------------------------------------------------
// Finish level
// ---------------------------------------------------------------------------

export const FINISH_LEVELS = ["Base", "Upgraded", "Superior"] as const;
export type FinishLevel = (typeof FINISH_LEVELS)[number];

/** Hard cost $/SF by what gets built and how well. Illustrative. */
export const FINISH_RATES: Record<
  FinishLevel,
  { residential: number; commercialShell: number; commercialTi: number; attachedCommon: number; detachedCommon: number }
> = {
  Base: { residential: 240, commercialShell: 165, commercialTi: 55, attachedCommon: 250, detachedCommon: 280 },
  Upgraded: { residential: 285, commercialShell: 195, commercialTi: 75, attachedCommon: 300, detachedCommon: 340 },
  Superior: { residential: 340, commercialShell: 240, commercialTi: 110, attachedCommon: 375, detachedCommon: 425 },
};

// ---------------------------------------------------------------------------
// Common areas
// ---------------------------------------------------------------------------

/**
 * ATTACHED sits inside the building envelope and shares its structure, envelope
 * and systems. DETACHED is its own building on the site — it carries its own
 * foundation, roof, envelope and utility runs, which is why it prices higher per
 * SF and why the distinction is a field rather than a naming convention.
 */
export type CommonPlacement = "attached" | "detached";

export type CommonArea = {
  id: string;
  name: string;
  placement: CommonPlacement;
  sqft: number;
  /** null = follow the finish level's rate for this placement. */
  costPerSf: number | null;
  /**
   * A LUMP SUM amenity — a pool, a pickleball court, an entry gate. When set,
   * this line costs exactly this and `sqft`/`costPerSf` are ignored; it also adds
   * no enclosed building area, because a tennis court has no roof.
   *
   * Undefined (the common case, and every deal saved before amenities existed)
   * means the line is a building priced per SF, exactly as before.
   */
  lumpCost?: number | null;
};

/**
 * A new deal starts with NO amenity program.
 *
 * The old default seeded six zero-SF rows, which read as a checklist somebody
 * forgot to fill in. An amenity program is a decision — you add what this
 * community is actually getting, from the catalog below, and re-cost it.
 */
export const DEFAULT_COMMON_AREAS: CommonArea[] = [];

/**
 * The amenity catalog behind the "Add amenity" picker.
 *
 * Every figure is an ILLUSTRATIVE 2026 New England starting point meant to be
 * overwritten — the same posture as FINISH_RATES. The sizes matter as much as
 * the rates: a clubhouse at 8,000 SF is what a 200-unit community actually
 * builds, and having that on screen is the cheapest possible guard against a
 * number entered in the wrong order of magnitude.
 *
 * `lump` and `sqft` are mutually exclusive: a preset is either a building priced
 * per SF or a site amenity priced whole.
 */
export type AmenityPreset = {
  id: string;
  name: string;
  group: string;
  placement: CommonPlacement;
  /** Per-SF building preset. */
  sqft?: number;
  costPerSf?: number | null;
  /** Lump-sum site preset. */
  lump?: number;
  note?: string;
};

export const AMENITY_PRESETS: AmenityPreset[] = [
  // --- Buildings, priced per SF ---------------------------------------------
  { id: "clubhouse", name: "Clubhouse", group: "Community buildings", placement: "detached", sqft: 8_000, costPerSf: 280, note: "~35 SF/unit is typical for 200–250 units" },
  { id: "leasing", name: "Leasing & sales center", group: "Community buildings", placement: "attached", sqft: 2_500, costPerSf: null },
  { id: "fitness", name: "Fitness center", group: "Community buildings", placement: "attached", sqft: 2_500, costPerSf: null },
  { id: "coworking", name: "Co-working lounge", group: "Community buildings", placement: "attached", sqft: 1_800, costPerSf: null },
  { id: "poolhouse", name: "Pool house / cabana", group: "Community buildings", placement: "detached", sqft: 1_200, costPerSf: null },
  { id: "mail", name: "Mail & package room", group: "Community buildings", placement: "attached", sqft: 600, costPerSf: null },
  { id: "maint", name: "Maintenance building", group: "Community buildings", placement: "detached", sqft: 2_000, costPerSf: null },

  // --- Recreation, priced whole ---------------------------------------------
  { id: "pool", name: "Pool & deck", group: "Recreation", placement: "detached", lump: 850_000 },
  { id: "pickleball", name: "Pickleball courts (2)", group: "Recreation", placement: "detached", lump: 180_000 },
  { id: "tennis", name: "Tennis court", group: "Recreation", placement: "detached", lump: 160_000 },
  { id: "basketball", name: "Basketball court", group: "Recreation", placement: "detached", lump: 95_000 },
  { id: "totlot", name: "Playground / tot lot", group: "Recreation", placement: "detached", lump: 120_000 },
  { id: "dogpark", name: "Dog park", group: "Recreation", placement: "detached", lump: 65_000 },

  // --- Grounds & entry, priced whole ----------------------------------------
  { id: "trails", name: "Walking trails", group: "Grounds & entry", placement: "detached", lump: 270_000 },
  { id: "pavilion", name: "Picnic pavilion & grills", group: "Grounds & entry", placement: "detached", lump: 85_000 },
  { id: "firepit", name: "Fire pit & gathering lawn", group: "Grounds & entry", placement: "detached", lump: 55_000 },
  { id: "garden", name: "Community garden", group: "Grounds & entry", placement: "detached", lump: 40_000 },
  { id: "gate", name: "Gated entry (2 stations)", group: "Grounds & entry", placement: "detached", lump: 350_000 },
  { id: "monument", name: "Entry monument & signage", group: "Grounds & entry", placement: "detached", lump: 120_000 },
];

/** Build a fresh line from a preset. `id` is uniquified by the caller. */
export function amenityFromPreset(p: AmenityPreset, id: string): CommonArea {
  return {
    id,
    name: p.name,
    placement: p.placement,
    sqft: p.sqft ?? 0,
    costPerSf: p.costPerSf ?? null,
    lumpCost: p.lump ?? null,
  };
}

// ---------------------------------------------------------------------------
// Parking
// ---------------------------------------------------------------------------

export const PARKING_TYPES = ["surface", "podium", "structured", "subterranean"] as const;
export type ParkingType = (typeof PARKING_TYPES)[number];

export const PARKING_TYPE_LABEL: Record<ParkingType, string> = {
  surface: "Surface (at grade)",
  podium: "Podium (under the building)",
  structured: "Structured deck (above grade)",
  subterranean: "Sub-terranean",
};

/**
 * Gross SF per space and $ per space by structure type.
 *
 * `sfFactor` multiplies the bare stall area to cover what the stall alone doesn't:
 * drive aisles for a surface lot; aisles plus columns, ramps and stair/elevator
 * cores for a structure. A 9×18 stall is 162 SF; at 2.05 a surface space works out
 * to ~332 SF gross, which is the ~130 spaces/acre planners use as a rule of thumb.
 */
export const PARKING_DEFAULTS: Record<ParkingType, { sfFactor: number; costPerSpace: number }> = {
  surface: { sfFactor: 2.05, costPerSpace: 6_500 },
  podium: { sfFactor: 2.2, costPerSpace: 32_000 },
  structured: { sfFactor: 2.15, costPerSpace: 28_000 },
  subterranean: { sfFactor: 2.35, costPerSpace: 55_000 },
};

export type ParkingComponent = {
  id: string;
  type: ParkingType;
  spaces: number;
  /** null = follow PARKING_DEFAULTS for the type. */
  costPerSpace: number | null;
  sfFactor: number | null;
};

/** How many spaces one unit of a given type demands. Keyed by the unit's label. */
export type ParkingRatio = { label: string; spacesPerUnit: number };

export type ParkingProgram = {
  /** Per-unit-type ratios. Missing labels fall back to `defaultRatioFor`. */
  ratios: ParkingRatio[];
  /** Guest / visitor spaces per unit, on top of the resident demand. */
  guestPerUnit: number;
  /** Stall geometry, in feet. */
  stallWidthFt: number;
  stallDepthFt: number;
  /** What actually gets built. Compared against demand, never silently equal to it. */
  components: ParkingComponent[];
};

/**
 * David's rule: a 1-bed needs one space, a 2- or 3-bed needs two. Studios follow
 * the 1-bed. Anything larger holds at 2 rather than extrapolating a number nobody
 * asked for — the row is editable when a 4-bed mix shows up.
 */
export function defaultRatioFor(label: string): number {
  const l = label.toLowerCase();
  if (/studio|efficiency|\b0\s*(bed|br)\b/.test(l)) return 1;
  const m = l.match(/(\d+)\s*(bed|br|bd)/);
  const beds = m ? Number(m[1]) : null;
  if (beds == null) return 1.5; // an unparseable label gets the midpoint, visibly editable
  if (beds <= 1) return 1;
  return 2;
}

export const DEFAULT_PARKING: ParkingProgram = {
  ratios: [],
  guestPerUnit: 0.15,
  stallWidthFt: 9,
  stallDepthFt: 18,
  components: [{ id: "surface", type: "surface", spaces: 0, costPerSpace: null, sfFactor: null }],
};

// ---------------------------------------------------------------------------
// Infrastructure
// ---------------------------------------------------------------------------

export const INFRA_BASES = ["lump", "per_lf", "per_sf", "per_unit", "per_space"] as const;
export type InfraBasis = (typeof INFRA_BASES)[number];

export const INFRA_BASIS_LABEL: Record<InfraBasis, string> = {
  lump: "Lump sum",
  per_lf: "$ / LF",
  per_sf: "$ / SF",
  per_unit: "$ / unit",
  per_space: "$ / space",
};

export type InfraLine = {
  id: string;
  name: string;
  basis: InfraBasis;
  quantity: number;
  rate: number;
};

/**
 * Site work that isn't the building and isn't the parking deck. Road length seeds
 * from the parking layout (see `suggestRoadLf`) but stays an editable quantity —
 * the site plan, not the spreadsheet, decides it.
 */
export const DEFAULT_INFRA: InfraLine[] = [
  { id: "road", name: "Site road & drive aisles", basis: "per_lf", quantity: 0, rate: 450 },
  { id: "walks", name: "Sidewalks & curbing", basis: "per_lf", quantity: 0, rate: 95 },
  { id: "watersewer", name: "Water & sewer mains", basis: "per_lf", quantity: 0, rate: 260 },
  { id: "storm", name: "Storm drainage & detention", basis: "lump", quantity: 1, rate: 0 },
  { id: "elec", name: "Site electric & telecom", basis: "per_lf", quantity: 0, rate: 120 },
  { id: "lighting", name: "Site lighting", basis: "per_space", quantity: 0, rate: 950 },
  { id: "landscape", name: "Landscaping & buffers", basis: "lump", quantity: 1, rate: 0 },
  { id: "erosion", name: "Erosion control & permits", basis: "lump", quantity: 1, rate: 0 },
];

/**
 * A first guess at drive length from the parking count.
 *
 * A double-loaded 24' aisle serves two rows of 9' stalls, so one linear foot of
 * aisle serves about two spaces — call it 0.5 LF per surface space — plus an
 * allowance for the entry drive off the public road. Structured parking is reached
 * by a ramp, not an aisle, so it contributes far less.
 */
export function suggestRoadLf(p: { surfaceSpaces: number; structuredSpaces: number }): number {
  return Math.round(p.surfaceSpaces * 0.5 + p.structuredSpaces * 0.08 + 150);
}

// ---------------------------------------------------------------------------
// The whole program
// ---------------------------------------------------------------------------

export type CostProgram = {
  /** false = the deal uses `overrideTotal` instead of the built-up budget. */
  useComputed: boolean;
  overrideTotal: number;

  finishLevel: FinishLevel;
  /** null on any rate = follow the finish level. Set to break from it on one line. */
  residentialCostPerSf: number | null;
  commercialShellCostPerSf: number | null;
  commercialTiCostPerSf: number | null;

  /**
   * Net rentable ÷ this = the residential gross the contractor builds. Covers
   * corridors, stairs, elevators, walls and chases — NOT programmed amenity space,
   * which is listed under common areas.
   */
  circulationEfficiency: number;

  commonAreas: CommonArea[];
  parking: ParkingProgram;
  infrastructure: InfraLine[];

  landCost: number;
  softCostPct: number;
  contingencyPct: number;
  developerFeePct: number;
};

export const DEFAULT_COST_PROGRAM: CostProgram = {
  useComputed: true,
  overrideTotal: 0,
  finishLevel: "Upgraded",
  residentialCostPerSf: null,
  commercialShellCostPerSf: null,
  commercialTiCostPerSf: null,
  circulationEfficiency: 0.85,
  commonAreas: DEFAULT_COMMON_AREAS,
  parking: DEFAULT_PARKING,
  infrastructure: DEFAULT_INFRA,
  landCost: 0,
  softCostPct: 0.18,
  contingencyPct: 0.05,
  developerFeePct: 0.04,
};

// ---------------------------------------------------------------------------
// Engine
// ---------------------------------------------------------------------------

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

export type ParkingDemandRow = {
  label: string;
  units: number;
  spacesPerUnit: number;
  spaces: number;
};

export type ParkingResult = {
  demand: ParkingDemandRow[];
  residentSpaces: number;
  guestSpaces: number;
  requiredSpaces: number;
  providedSpaces: number;
  /** provided − required. Negative is a shortfall the UI has to show, not hide. */
  surplusSpaces: number;
  stallSqft: number;
  components: {
    id: string;
    type: ParkingType;
    label: string;
    spaces: number;
    sfPerSpace: number;
    sqft: number;
    costPerSpace: number;
    cost: number;
  }[];
  totalSqft: number;
  totalAcres: number;
  /** Only the at-grade lot consumes site area; a deck stacks. Sized separately. */
  surfaceSqft: number;
  totalCost: number;
  costPerSpace: number;
};

export function sizeParking(
  program: ParkingProgram,
  mix: { label: string; count: number }[],
): ParkingResult {
  const ratioFor = (label: string) =>
    program.ratios.find((r) => r.label === label)?.spacesPerUnit ?? defaultRatioFor(label);

  // Same label can appear in both tiers (market + affordable "2 Bed"); a resident
  // parks a car either way, so demand is rolled up by label.
  const byLabel = new Map<string, number>();
  for (const m of mix) byLabel.set(m.label, (byLabel.get(m.label) ?? 0) + m.count);

  const demand: ParkingDemandRow[] = [...byLabel.entries()].map(([label, units]) => {
    const spacesPerUnit = ratioFor(label);
    return { label, units, spacesPerUnit, spaces: units * spacesPerUnit };
  });

  const totalUnits = sum(demand.map((d) => d.units));
  const residentSpaces = sum(demand.map((d) => d.spaces));
  const guestSpaces = totalUnits * program.guestPerUnit;
  // Half a parking space doesn't exist — a fractional demand rounds UP, because the
  // resident it belongs to still owns a whole car.
  const requiredSpaces = Math.ceil(residentSpaces + guestSpaces);

  const stallSqft = program.stallWidthFt * program.stallDepthFt;

  const components = program.components.map((c) => {
    const d = PARKING_DEFAULTS[c.type];
    const sfPerSpace = (c.sfFactor ?? d.sfFactor) * stallSqft;
    const costPerSpace = c.costPerSpace ?? d.costPerSpace;
    return {
      id: c.id,
      type: c.type,
      label: PARKING_TYPE_LABEL[c.type],
      spaces: c.spaces,
      sfPerSpace,
      sqft: c.spaces * sfPerSpace,
      costPerSpace,
      cost: c.spaces * costPerSpace,
    };
  });

  const providedSpaces = sum(components.map((c) => c.spaces));
  const totalSqft = sum(components.map((c) => c.sqft));
  const surfaceSqft = sum(components.filter((c) => c.type === "surface").map((c) => c.sqft));
  const totalCost = sum(components.map((c) => c.cost));

  return {
    demand,
    residentSpaces,
    guestSpaces,
    requiredSpaces,
    providedSpaces,
    surplusSpaces: providedSpaces - requiredSpaces,
    stallSqft,
    components,
    totalSqft,
    totalAcres: totalSqft / 43_560,
    surfaceSqft,
    totalCost,
    costPerSpace: safeDiv(totalCost, providedSpaces),
  };
}

export type BudgetLine = {
  key: string;
  label: string;
  /** "1,240 SF × $300" — the arithmetic, spelled out, so nothing is a mystery number. */
  detail: string;
  amount: number;
};

/** What one product type contributed to the residential hard cost. */
export type ResidentialTypeCost = {
  label: string;
  units: number;
  netSqft: number;
  grossSqft: number;
  efficiency: number;
  costPerSf: number;
  amount: number;
  overridden: boolean;
};

export type CostBuildResult = {
  /** SF the contractor actually builds, by piece. */
  residentialNetSqft: number;
  residentialGrossSqft: number;
  /** Residential hard cost split by product type — always populated, even when
   * the budget renders as one blended line. */
  residentialByType: ResidentialTypeCost[];
  attachedCommonSqft: number;
  detachedCommonSqft: number;
  commercialSqft: number;
  /** Enclosed building area: residential gross + commercial + attached common. */
  buildingGrossSqft: number;

  parking: ParkingResult;

  hardLines: BudgetLine[];
  hardCost: number;
  softLines: BudgetLine[];
  softCost: number;

  landCost: number;
  subtotal: number;
  developerFee: number;

  /** What the built-up budget says the deal costs. */
  computedTotal: number;
  /** What the underwrite actually uses — computed, or the override. */
  effectiveTotal: number;
  usingOverride: boolean;

  costPerUnit: number;
  /** Total ÷ net rentable SF. The number developers compare deals on. */
  costPerNetSqft: number;
  costPerGrossSqft: number;
};

/**
 * One product type in the cost build.
 *
 * `costPerSf` and `grossFactor` are the escape hatch from a single-building
 * assumption. A deal that builds detached houses, attached townhomes and stacked
 * flats has three unit costs and three different amounts of shared circulation to
 * pay for; a deal that builds one apartment building leaves both null and gets
 * the program's rate and efficiency, exactly as before.
 */
export type CostMixRow = {
  label: string;
  count: number;
  sqft: number;
  /** null = follow the program's residentialCostPerSf / finish level. */
  costPerSf?: number | null;
  /**
   * Net-to-gross divisor for THIS product. null = follow the program's
   * circulationEfficiency. Use 1 for a detached house or a townhome, where the
   * quoted $/SF already covers the whole building and there is no corridor,
   * elevator or shared lobby to gross up for.
   */
  grossFactor?: number | null;
};

export type CostBuildInput = {
  program: CostProgram;
  /** The full mix, both tiers. */
  mix: CostMixRow[];
  commercialSqft: number;
};

export function buildCost(input: CostBuildInput): CostBuildResult {
  const p = input.program;
  const rates = FINISH_RATES[p.finishLevel];

  const totalUnits = sum(input.mix.map((u) => u.count));

  const resRateDefault = p.residentialCostPerSf ?? rates.residential;

  /**
   * Price each product type on its own terms, then decide how to present it.
   *
   * A type with no overrides resolves to the program's rate and efficiency, so a
   * one-building deal lands on precisely the arithmetic this function did before
   * per-type costing existed.
   */
  const byType = input.mix.map((u) => {
    const netSqft = u.count * u.sqft;
    const eff = u.grossFactor ?? p.circulationEfficiency;
    // A zero divisor would produce NaN; treat it as "no grossing", same as the
    // program-level rule.
    const grossSqft = eff > 0 ? netSqft / eff : netSqft;
    const rate = u.costPerSf ?? resRateDefault;
    return {
      label: u.label,
      units: u.count,
      netSqft,
      grossSqft,
      efficiency: eff,
      costPerSf: rate,
      amount: grossSqft * rate,
      /** True when this row broke from the program on rate or on grossing. */
      overridden: u.costPerSf != null || u.grossFactor != null,
    };
  });

  const residentialNetSqft = sum(byType.map((t) => t.netSqft));
  const residentialGrossSqft = sum(byType.map((t) => t.grossSqft));

  // A lump-sum amenity (pool, dog park, entry gate) costs money but encloses no
  // building area, so it is kept out of the SF rollups that feed grossing and
  // the building-area reads.
  const isLump = (c: CommonArea) => c.lumpCost != null;
  const lumpAmenities = p.commonAreas.filter(isLump);
  const attached = p.commonAreas.filter((c) => !isLump(c) && c.placement === "attached");
  const detached = p.commonAreas.filter((c) => !isLump(c) && c.placement === "detached");
  const attachedCommonSqft = sum(attached.map((c) => c.sqft));
  const detachedCommonSqft = sum(detached.map((c) => c.sqft));

  const parking = sizeParking(p.parking, input.mix);

  const shellRate = p.commercialShellCostPerSf ?? rates.commercialShell;
  const tiRate = p.commercialTiCostPerSf ?? rates.commercialTi;

  const sf = (n: number) => Math.round(n).toLocaleString("en-US");
  const rate = (n: number) => `$${n.toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

  /**
   * One line when every type follows the program — the familiar single
   * "Residential units" row. One line PER type as soon as any type breaks from
   * it, because at that point a blended row would hide the very distinction the
   * override was made to draw.
   */
  const anyOverridden = byType.some((t) => t.overridden);
  const describe = (netSqft: number, eff: number, grossSqft: number, r: number) =>
    eff === 1
      ? `${sf(netSqft)} SF × ${rate(r)}`
      : `${sf(netSqft)} net SF ÷ ${(eff * 100).toFixed(0)}% = ${sf(grossSqft)} gross × ${rate(r)}`;

  const hardLines: BudgetLine[] = anyOverridden
    ? byType
        .filter((t) => t.netSqft > 0)
        .map((t) => ({
          key: `residential_${t.label.toLowerCase().replace(/[^a-z0-9]+/g, "_")}`,
          label: `${t.label} — ${t.units.toLocaleString()} units`,
          detail: describe(t.netSqft, t.efficiency, t.grossSqft, t.costPerSf),
          amount: t.amount,
        }))
    : [
        {
          key: "residential",
          label: "Residential units",
          detail: describe(residentialNetSqft, p.circulationEfficiency, residentialGrossSqft, resRateDefault),
          amount: residentialGrossSqft * resRateDefault,
        },
      ];

  if (input.commercialSqft > 0) {
    hardLines.push({
      key: "commercial_shell",
      label: "Commercial shell",
      detail: `${sf(input.commercialSqft)} SF × ${rate(shellRate)}`,
      amount: input.commercialSqft * shellRate,
    });
    hardLines.push({
      key: "commercial_ti",
      label: "Commercial tenant improvements",
      detail: `${sf(input.commercialSqft)} SF × ${rate(tiRate)}`,
      amount: input.commercialSqft * tiRate,
    });
  }

  for (const c of attached) {
    if (c.sqft <= 0) continue;
    const r = c.costPerSf ?? rates.attachedCommon;
    hardLines.push({
      key: `common_${c.id}`,
      label: `${c.name} — attached`,
      detail: `${sf(c.sqft)} SF × ${rate(r)}`,
      amount: c.sqft * r,
    });
  }
  for (const c of detached) {
    if (c.sqft <= 0) continue;
    const r = c.costPerSf ?? rates.detachedCommon;
    hardLines.push({
      key: `common_${c.id}`,
      label: `${c.name} — detached`,
      detail: `${sf(c.sqft)} SF × ${rate(r)}`,
      amount: c.sqft * r,
    });
  }
  for (const c of lumpAmenities) {
    const amount = c.lumpCost ?? 0;
    if (amount === 0) continue;
    hardLines.push({
      key: `common_${c.id}`,
      label: c.name,
      detail: "Lump sum",
      amount,
    });
  }

  for (const c of parking.components) {
    if (c.spaces <= 0) continue;
    hardLines.push({
      key: `parking_${c.id}`,
      label: `Parking — ${c.label}`,
      detail: `${c.spaces.toLocaleString()} spaces × ${rate(c.costPerSpace)} · ${sf(c.sqft)} SF`,
      amount: c.cost,
    });
  }

  for (const l of p.infrastructure) {
    const amount = l.basis === "lump" ? l.rate * (l.quantity || 1) : l.quantity * l.rate;
    if (amount === 0) continue;
    hardLines.push({
      key: `infra_${l.id}`,
      label: l.name,
      detail:
        l.basis === "lump"
          ? "Lump sum"
          : `${l.quantity.toLocaleString()} × ${rate(l.rate)} ${INFRA_BASIS_LABEL[l.basis]}`,
      amount,
    });
  }

  const hardCost = sum(hardLines.map((l) => l.amount));

  const softLines: BudgetLine[] = [
    {
      key: "soft",
      label: "Soft costs",
      detail: `${(p.softCostPct * 100).toFixed(1)}% of hard cost — design, permits, legal, financing, lease-up`,
      amount: hardCost * p.softCostPct,
    },
    {
      key: "contingency",
      label: "Contingency",
      detail: `${(p.contingencyPct * 100).toFixed(1)}% of hard cost`,
      amount: hardCost * p.contingencyPct,
    },
  ];
  const softCost = sum(softLines.map((l) => l.amount));

  const subtotal = p.landCost + hardCost + softCost;
  // Charged on everything the developer put together, land included — the usual
  // convention, and the one that doesn't reward moving cost between buckets.
  const developerFee = subtotal * p.developerFeePct;
  const computedTotal = subtotal + developerFee;

  const usingOverride = !p.useComputed;
  const effectiveTotal = usingOverride ? p.overrideTotal : computedTotal;
  const buildingGrossSqft = residentialGrossSqft + input.commercialSqft + attachedCommonSqft;

  return {
    residentialNetSqft,
    residentialGrossSqft,
    residentialByType: byType,
    attachedCommonSqft,
    detachedCommonSqft,
    commercialSqft: input.commercialSqft,
    buildingGrossSqft,
    parking,
    hardLines,
    hardCost,
    softLines,
    softCost,
    landCost: p.landCost,
    subtotal,
    developerFee,
    computedTotal,
    effectiveTotal,
    usingOverride,
    costPerUnit: safeDiv(effectiveTotal, totalUnits),
    costPerNetSqft: safeDiv(effectiveTotal, residentialNetSqft),
    costPerGrossSqft: safeDiv(effectiveTotal, buildingGrossSqft),
  };
}
