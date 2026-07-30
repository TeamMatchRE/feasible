/**
 * "Refine for this site" — ask the model what THIS town actually requires.
 *
 * The parking engine in mf-costs.ts runs on defensible national defaults: a 9×18
 * stall, a 2.05 aisle factor, David's 1-bed/2-bed ratio rule. Those are right
 * until a zoning table says otherwise, and zoning tables disagree constantly —
 * Avon wants 2.0 per unit flat, a transit-oriented overlay in Hartford wants 0.75,
 * and a few towns still specify a 10' stall.
 *
 * So this is a REFINEMENT, not a replacement. It proposes; the underwriter
 * applies. Same propose→verify posture as mf-comps-ai.ts and zoning.ts, for the
 * same reason: a regulation the model half-remembered should not quietly resize a
 * $50M parking deck. Every field comes back with a source and may come back null,
 * and null means "I didn't find it" — the default stands.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

export type ParkingRefinement = {
  /** Per-unit-type required ratios the ordinance actually states. */
  ratios: { label: string; spacesPerUnit: number }[] | null;
  guestPerUnit: number | null;
  stallWidthFt: number | null;
  stallDepthFt: number | null;
  /** Gross SF per space including aisles — a multiple of the bare stall. */
  aisleFactor: number | null;
  /** Linear feet of interior drive the site plan is likely to need. */
  roadLf: number | null;
  /** Where each figure came from, in the underwriter's own reading order. */
  citations: string[];
  /** What the model wants a human to check before trusting any of it. */
  caveats: string[];
  summary: string;
};

export type RefineResult = { ok: true; refinement: ParkingRefinement } | { ok: false; error: string };

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const strArr = (v: unknown): string[] =>
  Array.isArray(v) ? v.filter((x): x is string => typeof x === "string" && x.trim().length > 0) : [];

/** Pull the first JSON object out of a text response, tolerating prose and fences. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  const open = body[start];
  const close = open === "[" ? "]" : "}";
  let depth = 0;
  let inStr = false;
  let esc = false;
  for (let i = start; i < body.length; i++) {
    const ch = body[i];
    if (inStr) {
      if (esc) esc = false;
      else if (ch === "\\") esc = true;
      else if (ch === '"') inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(body.slice(start, i + 1));
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Guard rails on what comes back. A model that returns a 40-foot stall or a ratio
 * of 25 has misread a table, and shipping that into a budget is worse than
 * ignoring it — an out-of-range figure becomes null and the default survives.
 */
const inRange = (v: number | null, lo: number, hi: number): number | null =>
  v != null && v >= lo && v <= hi ? v : null;

export type RefineInput = {
  address: string | null;
  city: string | null;
  state: string;
  unitTypes: { label: string; count: number }[];
  totalUnits: number;
};

export async function refineParking(input: RefineInput): Promise<RefineResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not set for Feasible — add it, then retry." };
  }
  if (!input.city) return { ok: false, error: "Add the deal's city before refining parking." };

  const c = new Anthropic({ timeout: 120_000, maxRetries: 1 });
  const where = [input.address, input.city, input.state].filter(Boolean).join(", ");
  const mix = input.unitTypes.length
    ? input.unitTypes.map((u) => `${u.count}× ${u.label}`).join("; ")
    : "unit mix not set yet";

  const prompt = `You are a site planner sizing parking for a ${input.totalUnits}-unit multi-family development at ${where}.

Unit mix: ${mix}.

Find what the LOCAL zoning regulation for ${input.city}, ${input.state} actually requires for multi-family parking, and report the geometry a site plan there would use.

Return ONLY a JSON object, no commentary, shaped exactly:
{
  "ratios": [ { "label": "1 Bed", "spaces_per_unit": number } ] | null,
  "guest_per_unit": number|null,
  "stall_width_ft": number|null,
  "stall_depth_ft": number|null,
  "aisle_factor": number|null,
  "road_lf": number|null,
  "citations": [ "string" ],
  "caveats": [ "string" ],
  "summary": "one or two sentences"
}

Rules:
- "ratios" must reuse the SAME unit labels as the mix above so the rows line up.
- "aisle_factor" is GROSS square feet per space divided by the bare stall area — a
  typical double-loaded surface lot is about 2.0 to 2.1. Report the factor, not the SF.
- "road_lf" is an estimate of interior drive length in linear feet for a site this size.
- Report ONLY what you actually find in the regulation or can size from the site.
  Use null for anything you cannot source. A null is useful; an invented requirement is not.
- Put the ordinance section number and the effective date in "citations".
- Put anything a human must verify in "caveats" — a special permit reduction, a
  transit overlay, a pending amendment, or the fact that you could not find the table.`;

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 6000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      // Basic web_search on purpose — someone is watching a button spin. Same
      // reasoning as mf-comps-ai.ts and zoning.ts.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: prompt }],
    });

    if (res.stop_reason === "refusal") {
      return { ok: false, error: "The model declined this request." };
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const raw = extractJson(text) as Record<string, unknown> | null;
    if (!raw) return { ok: false, error: "Could not read a refinement from the response — try again." };

    const rawRatios = Array.isArray(raw.ratios) ? raw.ratios : null;
    const ratios =
      rawRatios
        ?.map((r) => {
          const o = (r ?? {}) as Record<string, unknown>;
          const label = typeof o.label === "string" ? o.label.trim() : "";
          const spacesPerUnit = inRange(num(o.spaces_per_unit ?? o.spacesPerUnit), 0, 5);
          return label && spacesPerUnit != null ? { label, spacesPerUnit } : null;
        })
        .filter((r): r is { label: string; spacesPerUnit: number } => r !== null) ?? null;

    return {
      ok: true,
      refinement: {
        ratios: ratios && ratios.length ? ratios : null,
        guestPerUnit: inRange(num(raw.guest_per_unit), 0, 2),
        stallWidthFt: inRange(num(raw.stall_width_ft), 7.5, 12),
        stallDepthFt: inRange(num(raw.stall_depth_ft), 15, 25),
        aisleFactor: inRange(num(raw.aisle_factor), 1.3, 3.5),
        roadLf: inRange(num(raw.road_lf), 0, 20_000),
        citations: strArr(raw.citations),
        caveats: strArr(raw.caveats),
        summary: typeof raw.summary === "string" ? raw.summary : "",
      },
    };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "Rate limited — wait a moment and retry." };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Parking refinement failed (${e.status}).` };
    return { ok: false, error: e instanceof Error ? e.message : "Parking refinement failed." };
  }
}
