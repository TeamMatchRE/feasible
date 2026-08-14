/**
 * THE CAPITAL STACK AND THE REVENUE SCHEDULE.
 *
 * Pure functions, no database — same posture as multifamily.ts and mf-costs.ts,
 * so the numbers can be tested against hand arithmetic rather than trusted.
 *
 * Two ideas run through all of it:
 *
 *   COMMITTED IS NOT FUNDED. A signed commitment is a promise; cash in the
 *   account is cash in the account. Every figure here keeps them apart, because
 *   a raise that adds them together cannot tell you whether it has closed.
 *
 *   PROJECTED IS NOT SOLD. A lot with a projected closing date is a forecast; a
 *   lot that has actually closed is history. They are reported separately and
 *   never summed into one "revenue" number.
 */

export type InvestmentLike = {
  investorId: string;
  investorName: string;
  committedAmount: number;
  contributedAmount: number;
  status: "prospect" | "soft_circle" | "committed" | "funded" | "closed";
};

export type RaiseProgress = {
  target: number;
  /** Everything anyone has promised, at any confidence. */
  committed: number;
  /** Only the money actually received. */
  funded: number;
  /** Promised but not yet wired — the number that tells you what to chase. */
  outstanding: number;
  /** Still to be raised against the target. Never negative; see `oversubscribed`. */
  remaining: number;
  oversubscribed: number;
  pctCommitted: number;
  pctFunded: number;
  investors: (InvestmentLike & {
    /** Share of the RAISE, not of the project. Ownership comes from the operating agreement. */
    shareOfRaise: number;
    outstanding: number;
  })[];
};

const sum = (ns: number[]) => ns.reduce((a, b) => a + b, 0);
const safeDiv = (a: number, b: number) => (b === 0 ? 0 : a / b);

/**
 * `target` of 0 means "no target set" — percentages read 0 rather than dividing
 * by zero and reporting an infinite raise.
 */
export function raiseProgress(investments: InvestmentLike[], target: number): RaiseProgress {
  // A prospect has not promised anything yet; counting them as committed is how
  // a pipeline gets mistaken for a closed raise.
  const real = investments.filter((i) => i.status !== "prospect");

  const committed = sum(real.map((i) => i.committedAmount));
  const funded = sum(investments.map((i) => i.contributedAmount));

  return {
    target,
    committed,
    funded,
    outstanding: Math.max(0, committed - funded),
    remaining: Math.max(0, target - committed),
    oversubscribed: Math.max(0, committed - target),
    pctCommitted: safeDiv(committed, target),
    pctFunded: safeDiv(funded, target),
    investors: investments
      .map((i) => ({
        ...i,
        shareOfRaise: safeDiv(i.committedAmount, committed),
        outstanding: Math.max(0, i.committedAmount - i.contributedAmount),
      }))
      .sort((a, b) => b.committedAmount - a.committedAmount),
  };
}

// ---------------------------------------------------------------------------
// Lots
// ---------------------------------------------------------------------------

export type LotLike = {
  id: string;
  lotNumber: string;
  style: string | null;
  listPrice: number | null;
  salePrice: number | null;
  status: "available" | "reserved" | "under_contract" | "closed" | "held";
  buyerName: string | null;
  projectedClosing: string | null;
  actualClosing: string | null;
  buildCost: number | null;
};

/** The price a lot is expected to fetch: what it sold for, else what it's asking. */
export const lotValue = (l: LotLike): number => l.salePrice ?? l.listPrice ?? 0;

export type LotSummary = {
  total: number;
  available: number;
  reserved: number;
  underContract: number;
  closed: number;
  held: number;
  /** Sum of every lot's expected value, whatever its status. */
  grossPotential: number;
  /** Already banked. */
  closedProceeds: number;
  /** Under contract or reserved — expected, not banked. */
  pipelineProceeds: number;
  /** Not yet spoken for. */
  unsoldValue: number;
  /** Lots with a price but no style, or a style but no price — the things to fix. */
  unpriced: number;
};

export function summarizeLots(lots: LotLike[]): LotSummary {
  const by = (s: LotLike["status"]) => lots.filter((l) => l.status === s);
  const closed = by("closed");
  const pipeline = [...by("under_contract"), ...by("reserved")];
  const unsold = [...by("available"), ...by("held")];

  return {
    total: lots.length,
    available: by("available").length,
    reserved: by("reserved").length,
    underContract: by("under_contract").length,
    closed: closed.length,
    held: by("held").length,
    grossPotential: sum(lots.map(lotValue)),
    closedProceeds: sum(closed.map(lotValue)),
    pipelineProceeds: sum(pipeline.map(lotValue)),
    unsoldValue: sum(unsold.map(lotValue)),
    unpriced: lots.filter((l) => lotValue(l) === 0).length,
  };
}

// ---------------------------------------------------------------------------
// The schedule
// ---------------------------------------------------------------------------

export type MonthRow = {
  /** "2026-09" */
  month: string;
  label: string;
  /** Lots closing this month. */
  lots: { lotNumber: string; buyer: string | null; amount: number; projected: boolean }[];
  proceeds: number;
  buildCost: number;
  net: number;
  cumulativeNet: number;
};

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

const monthKey = (iso: string): string => iso.slice(0, 7);
const monthLabel = (key: string): string => {
  const [y, m] = key.split("-");
  return `${MONTHS[Number(m) - 1] ?? m} ${y}`;
};

/**
 * Money in and out by month, driven by lot closings.
 *
 * A lot lands in the month it ACTUALLY closed if it has, otherwise the month it
 * is PROJECTED to close. Rows carry `projected` per lot so the UI can show which
 * half of a month is forecast — a schedule that renders a guess identically to a
 * banked closing is how a forecast quietly becomes a fact.
 *
 * Build cost is only recognised where a lot carries one. This is deliberately
 * NOT a construction draw curve: nobody has given us a draw schedule, and
 * inventing one would produce a confident cash-flow shape with no basis.
 */
export function closingSchedule(lots: LotLike[]): MonthRow[] {
  const buckets = new Map<string, MonthRow>();

  for (const l of lots) {
    const date = l.actualClosing ?? l.projectedClosing;
    if (!date) continue; // no date = not on the calendar yet, and not invented

    const key = monthKey(date);
    if (!buckets.has(key)) {
      buckets.set(key, {
        month: key,
        label: monthLabel(key),
        lots: [],
        proceeds: 0,
        buildCost: 0,
        net: 0,
        cumulativeNet: 0,
      });
    }
    const row = buckets.get(key)!;
    const amount = lotValue(l);
    row.lots.push({
      lotNumber: l.lotNumber,
      buyer: l.buyerName,
      amount,
      projected: !l.actualClosing,
    });
    row.proceeds += amount;
    row.buildCost += l.buildCost ?? 0;
  }

  const rows = [...buckets.values()].sort((a, b) => a.month.localeCompare(b.month));
  let running = 0;
  for (const r of rows) {
    r.net = r.proceeds - r.buildCost;
    running += r.net;
    r.cumulativeNet = running;
  }
  return rows;
}

/**
 * What the equity gets back, at the crudest useful level: proceeds less cost
 * less the money investors put in.
 *
 * Explicitly NOT a waterfall. Preferred return, splits and promote live in the
 * operating agreement, and guessing at them would produce a number an investor
 * might rely on. See the 3-tier waterfall noted as unbuilt in multifamily.ts.
 */
export type EquityPosition = {
  contributed: number;
  grossProceeds: number;
  projectCost: number;
  netToProject: number;
  /** null when there is no cost basis to measure against. */
  multipleOnContributed: number | null;
};

export function equityPosition(
  investments: InvestmentLike[],
  lots: LotLike[],
  projectCost: number,
): EquityPosition {
  const contributed = sum(investments.map((i) => i.contributedAmount));
  const grossProceeds = sum(lots.map(lotValue));
  const netToProject = grossProceeds - projectCost;
  return {
    contributed,
    grossProceeds,
    projectCost,
    netToProject,
    multipleOnContributed: contributed > 0 ? (contributed + netToProject) / contributed : null,
  };
}
