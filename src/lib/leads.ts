/**
 * The arithmetic half of a lead read.
 *
 * Everything here is pure and testable, and it exists so that the numbers on
 * the page — how many leads, how many are new, how many have gone quiet — are
 * counted rather than narrated. The model gets the same leads and writes the
 * prose, but it is never the source of a figure: a summary that says "about a
 * dozen" when the answer is sixteen is worse than no summary.
 *
 * No imports from the database or the FUB client on purpose; this module is
 * shaped by what a lead IS, not by where it came from.
 */

export type LeadActivityItem = {
  kind: "note" | "call" | "text";
  at: string | null;
  text: string;
};

export type Lead = {
  fubId: number;
  name: string;
  stage: string | null;
  source: string | null;
  assignedTo: string | null;
  created: string | null;
  lastActivity: string | null;
  hasEmail: boolean;
  hasPhone: boolean;
  /** Most recent first. */
  activity: LeadActivityItem[];
};

export type LeadStats = {
  total: number;
  byStage: [string, number][];
  bySource: [string, number][];
  byOwner: [string, number][];
  /** Created in the 30 days before the read. */
  newLast30: number;
  /** Nothing at all on the timeline — nobody has worked them yet. */
  neverTouched: number;
  /** No activity in 21+ days. Not "dead", but nobody has touched them in three weeks. */
  quiet: number;
  /** No email and no phone — unreachable however good the lead looks. */
  unreachable: number;
  /** ISO date of the most recently created lead, or null when there are none. */
  newestCreated: string | null;
};

const DAY = 86_400_000;

/** Whole days between an ISO timestamp and `asOf`, or null when unparseable. */
export function daysSince(iso: string | null | undefined, asOf: Date): number | null {
  if (!iso) return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  return Math.floor((asOf.getTime() - t) / DAY);
}

/** Counts of a field, biggest bucket first, with a stable tiebreak on the label. */
function tally(leads: Lead[], pick: (l: Lead) => string | null): [string, number][] {
  const counts = new Map<string, number>();
  for (const l of leads) {
    const key = (pick(l) ?? "").trim() || "Unassigned";
    counts.set(key, (counts.get(key) ?? 0) + 1);
  }
  return [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
}

export const QUIET_DAYS = 21;

export function rollUp(leads: Lead[], asOf: Date = new Date()): LeadStats {
  const newest = leads
    .map((l) => l.created)
    .filter((c): c is string => !!c)
    .sort()
    .at(-1) ?? null;

  return {
    total: leads.length,
    byStage: tally(leads, (l) => l.stage),
    bySource: tally(leads, (l) => l.source),
    byOwner: tally(leads, (l) => l.assignedTo),
    newLast30: leads.filter((l) => {
      const d = daysSince(l.created, asOf);
      return d != null && d <= 30;
    }).length,
    neverTouched: leads.filter((l) => l.activity.length === 0).length,
    quiet: leads.filter((l) => {
      const d = daysSince(l.lastActivity ?? l.created, asOf);
      return d != null && d >= QUIET_DAYS;
    }).length,
    unreachable: leads.filter((l) => !l.hasEmail && !l.hasPhone).length,
    newestCreated: newest,
  };
}

/**
 * The leads as text for the model.
 *
 * Trimmed hard and deliberately: an agent's follow-up note is two or three
 * sentences and says everything ("still on the fence, may move out of state"),
 * so a long tail of clipped boilerplate buys nothing and is billed by the
 * token. Newest leads first — that is the order a person reading a pipeline
 * cares about.
 */
export function toDigest(leads: Lead[], asOf: Date = new Date(), perLead = 6): string {
  const ordered = [...leads].sort((a, b) => (b.created ?? "").localeCompare(a.created ?? ""));

  return ordered
    .map((l) => {
      const age = daysSince(l.created, asOf);
      const idle = daysSince(l.lastActivity ?? l.created, asOf);
      const head = [
        l.name || "No name",
        l.stage ? `stage ${l.stage}` : null,
        l.source ? `via ${l.source}` : null,
        l.assignedTo ? `owner ${l.assignedTo}` : "unassigned",
        age != null ? `${age}d old` : null,
        idle != null ? `last touch ${idle}d ago` : "never touched",
        !l.hasEmail && !l.hasPhone ? "NO CONTACT DETAILS" : null,
      ]
        .filter(Boolean)
        .join(" · ");

      const body = l.activity
        .slice(0, perLead)
        .map((a) => {
          const when = a.at ? a.at.slice(0, 10) : "undated";
          const text = a.text.replace(/\s+/g, " ").trim().slice(0, 400);
          return `    ${when} ${a.kind}: ${text || "(empty)"}`;
        })
        .join("\n");

      return `- ${head}\n${body || "    (nothing on the timeline)"}`;
    })
    .join("\n");
}

/**
 * What a read of nothing looks like. Used when a stored row predates a field —
 * the page must render zeroes rather than crash on an older snapshot.
 */
export const EMPTY_LEAD_STATS: LeadStats = {
  total: 0,
  byStage: [],
  bySource: [],
  byOwner: [],
  newLast30: 0,
  neverTouched: 0,
  quiet: 0,
  unreachable: 0,
  newestCreated: null,
};
