/**
 * AI comp finder for multi-family deals — rent comps and for-sale comps.
 *
 * The Procopio workbook's Rent Comps sheet is three CoStar pulls typed in by hand:
 * property, address, year built, unit count, then a rent and an average size per
 * bedroom type. This does the same job from the web, in the same shape, so the
 * output drops straight into the comp grid beside the subject.
 *
 * PROPOSE → VERIFY, like CMAssist. Everything returned is a draft flagged
 * `ai_generated` and unconfirmed. A comp nobody checked should never quietly move
 * a $50M decision, and a model can be confidently wrong about a rent roll.
 *
 * Model: claude-opus-5 with adaptive thinking. Basic web_search variant on
 * purpose, for the same reason zoning.ts gives: the dynamic-filtering variant runs
 * code execution underneath and can loop for minutes, and this sits behind a
 * button someone is waiting on.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

export type CompKind = "rent" | "sale";

/** One bedroom type within a comp. `rent` is monthly; `price` is a sale price. */
export type CompUnitLine = {
  label: string;
  count: number | null;
  sqft: number | null;
  rent: number | null;
  price: number | null;
};

export type ProposedComp = {
  propertyName: string;
  address: string | null;
  city: string | null;
  yearBuilt: number | null;
  units: number | null;
  distanceMi: number | null;
  units_detail: CompUnitLine[];
  source: string | null;
  note: string | null;
};

export type CompSearchResult =
  | { ok: true; comps: ProposedComp[] }
  | { ok: false; error: string };

function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ timeout: 120_000, maxRetries: 1 });
}

const num = (v: unknown): number | null => {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = Number(v.replace(/[$,\s]/g, ""));
    return Number.isFinite(n) ? n : null;
  }
  return null;
};
const str = (v: unknown): string | null => (typeof v === "string" && v.trim() ? v.trim() : null);

/** Pull the first JSON object/array out of a text response, tolerating prose and fences. */
function extractJson(text: string): unknown {
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  const body = fenced ? fenced[1] : text;
  const start = body.search(/[[{]/);
  if (start === -1) return null;
  // Walk to the matching close so trailing commentary doesn't break the parse.
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

function normalize(raw: unknown): ProposedComp[] {
  const arr = Array.isArray(raw)
    ? raw
    : Array.isArray((raw as { comps?: unknown[] })?.comps)
      ? (raw as { comps: unknown[] }).comps
      : [];
  return arr
    .map((r) => {
      const o = (r ?? {}) as Record<string, unknown>;
      const detailRaw = Array.isArray(o.units_detail) ? o.units_detail : [];
      const units_detail: CompUnitLine[] = detailRaw.map((d) => {
        const u = (d ?? {}) as Record<string, unknown>;
        return {
          label: str(u.label) ?? "—",
          count: num(u.count),
          sqft: num(u.sqft),
          rent: num(u.rent),
          price: num(u.price),
        };
      });
      return {
        propertyName: str(o.property_name) ?? str(o.propertyName) ?? "Unnamed comp",
        address: str(o.address),
        city: str(o.city),
        yearBuilt: num(o.year_built ?? o.yearBuilt),
        units: num(o.units),
        distanceMi: num(o.distance_mi ?? o.distanceMi),
        units_detail,
        source: str(o.source),
        note: str(o.note),
      };
    })
    // A comp with no name AND no per-unit detail tells an underwriter nothing.
    .filter((c) => c.propertyName !== "Unnamed comp" || c.units_detail.length > 0);
}

export type CompSearchInput = {
  kind: CompKind;
  address: string | null;
  city: string | null;
  state: string;
  /** The subject's mix, so the model reports the same bedroom types back. */
  unitTypes: { label: string; count: number; sqft: number }[];
  totalUnits: number;
};

export async function findComps(input: CompSearchInput): Promise<CompSearchResult> {
  const c = client();
  if (!c) return { ok: false, error: "ANTHROPIC_API_KEY is not set for Feasible — add it, then retry." };

  const where = [input.address, input.city, input.state].filter(Boolean).join(", ");
  if (!input.city) return { ok: false, error: "Add the deal's city before searching for comps." };

  const mix = input.unitTypes.length
    ? input.unitTypes.map((u) => `${u.count}× ${u.label} at ~${u.sqft} SF`).join("; ")
    : "unit mix not set yet";

  const askingFor =
    input.kind === "rent"
      ? `asking RENTS. For each bedroom type report the monthly rent in "rent" and leave "price" null.`
      : `SALE prices for comparable new condominium or for-sale units. For each bedroom type report the per-unit sale price in "price" and leave "rent" null.`;

  const prompt = `You are sourcing ${input.kind === "rent" ? "rent comps" : "for-sale comps"} for a ${input.totalUnits}-unit multi-family development at ${where}.

Subject unit mix: ${mix}.

Find up to 4 genuinely comparable recent properties near the subject — prioritize the same submarket, similar vintage (newer construction), and a similar unit mix. For each, report ${askingFor}

Return ONLY a JSON array, no commentary, each element shaped exactly:
{
  "property_name": string,
  "address": string|null,
  "city": string|null,
  "year_built": number|null,
  "units": number|null,
  "distance_mi": number|null,
  "source": string|null,      // where the figure came from, e.g. the site or listing name
  "note": string|null,        // one line on why it is comparable, or a caveat
  "units_detail": [ { "label": "1 Bed", "count": number|null, "sqft": number|null, "rent": number|null, "price": number|null } ]
}

Rules:
- Use the SAME bedroom labels as the subject mix where possible, so the columns line up.
- Report only figures you actually found. Use null rather than estimating or interpolating — a null is useful, an invented rent is not.
- Prefer current asking figures; say so in "note" if a figure is dated or is an average rather than by-bedroom.
- If you cannot find real comparables, return [].`;

  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 8000,
      thinking: { type: "adaptive" },
      output_config: { effort: "high" },
      // See the header note: basic variant keeps this inside a button's patience.
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 6 }],
      messages: [{ role: "user", content: prompt }],
    });

    if (res.stop_reason === "refusal") {
      return { ok: false, error: "The model declined this request. Try narrowing the location." };
    }

    const text = res.content
      .filter((b): b is Anthropic.TextBlock => b.type === "text")
      .map((b) => b.text)
      .join("\n");
    const parsed = extractJson(text);
    if (parsed == null) return { ok: false, error: "Could not read comps from the response — try again." };

    const comps = normalize(parsed);
    return { ok: true, comps };
  } catch (e) {
    if (e instanceof Anthropic.RateLimitError) return { ok: false, error: "Rate limited — wait a moment and retry." };
    if (e instanceof Anthropic.APIError) return { ok: false, error: `Comp search failed (${e.status}).` };
    return { ok: false, error: e instanceof Error ? e.message : "Comp search failed." };
  }
}
