import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * AI-assisted zoning-setback extraction. Two source paths, both returning a
 * ZoningProposal the user must CONFIRM before it drives the building envelope —
 * this is an assist, never an authority (setbacks feed a go/no-go verdict).
 *
 *   1. PDF  — the user uploads the town's zoning regs; Claude (Opus 4.8) reads
 *             the document and extracts the parcel's likely district's
 *             dimensional table via a strict JSON schema (structured outputs).
 *   2. web  — no PDF on hand: Claude uses the server-side web_search tool
 *             against the town's online code. Lower confidence.
 *
 * Model: claude-opus-4-8 (the skill default). Needs ANTHROPIC_API_KEY in the
 * environment; absent, both paths return a friendly error rather than throwing.
 */

const MODEL = "claude-opus-4-8";

export interface ZoningProposal {
  zoning_district: string | null;
  front_setback_ft: number | null;
  side_setback_ft: number | null;
  rear_setback_ft: number | null;
  max_coverage_pct: number | null;
  min_lot_sf: number | null;
  citation: string | null;
  /** "high" | "medium" | "low" — how sure the model is, for the confirm UI. */
  confidence: string | null;
  source_url: string | null;
  notes: string | null;
}

export interface ProposeResult {
  ok: boolean;
  proposal?: ZoningProposal;
  error?: string;
}

// JSON Schema for structured outputs. Nullable via anyOf so the model can leave
// a field blank rather than inventing a number.
const numOrNull = { anyOf: [{ type: "number" }, { type: "null" }] } as const;
const strOrNull = { anyOf: [{ type: "string" }, { type: "null" }] } as const;
const ZONING_SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    zoning_district: strOrNull,
    front_setback_ft: numOrNull,
    side_setback_ft: numOrNull,
    rear_setback_ft: numOrNull,
    max_coverage_pct: numOrNull,
    min_lot_sf: numOrNull,
    citation: strOrNull,
    confidence: strOrNull,
    source_url: strOrNull,
    notes: strOrNull,
  },
  required: [
    "zoning_district",
    "front_setback_ft",
    "side_setback_ft",
    "rear_setback_ft",
    "max_coverage_pct",
    "min_lot_sf",
    "citation",
    "confidence",
    "source_url",
    "notes",
  ],
} as const;

// A hard per-request timeout so a slow web search / large PDF surfaces an error
// in the UI instead of hanging on the SDK's 10-minute default.
function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ timeout: 90_000, maxRetries: 1 });
}

function promptFor(town: string | null, address: string | null): string {
  return [
    `You are a land-use analyst. For the parcel at ${address ?? "the given address"}`,
    town ? ` in ${town}, Connecticut,` : ",",
    " determine its most likely zoning district and that district's DIMENSIONAL / BULK standards:",
    " front, side, and rear building setbacks (in feet), maximum lot coverage (percent), and minimum lot size (square feet).",
    " Report ONLY the governing residential district's standards. If the parcel could fall in more than one district, pick the most likely residential one and say so in notes.",
    " If a value genuinely isn't stated, return null for it rather than guessing.",
    " Set confidence to 'high', 'medium', or 'low'. Put the citation (section number / table) in citation, and any caveats in notes.",
  ].join("");
}

/**
 * Pull the LAST balanced JSON object out of a text blob — the web-search reply
 * is prose followed by the JSON object, so scan back from the final `}` to its
 * matching `{` (brace-counting, string-aware).
 */
function extractJson(text: string): ZoningProposal | null {
  const end = text.lastIndexOf("}");
  if (end < 0) return null;
  let depth = 0;
  let inStr = false;
  for (let i = end; i >= 0; i--) {
    const ch = text[i];
    if (inStr) {
      if (ch === '"' && text[i - 1] !== "\\") inStr = false;
      continue;
    }
    if (ch === '"') inStr = true;
    else if (ch === "}") depth++;
    else if (ch === "{") {
      depth--;
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(i, end + 1)) as ZoningProposal;
        } catch {
          return null;
        }
      }
    }
  }
  return null;
}

/**
 * Extract setbacks from an uploaded zoning-regs PDF (base64, no data: prefix).
 * Uses structured outputs so the result validates against ZONING_SCHEMA.
 */
export async function proposeFromPdf(
  pdfBase64: string,
  town: string | null,
  address: string | null,
): Promise<ProposeResult> {
  const c = client();
  if (!c) return { ok: false, error: "ANTHROPIC_API_KEY is not set for Feasible — add it, then retry." };
  try {
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 4096,
      output_config: { format: { type: "json_schema", schema: ZONING_SCHEMA } },
      messages: [
        {
          role: "user",
          content: [
            { type: "document", source: { type: "base64", media_type: "application/pdf", data: pdfBase64 } },
            { type: "text", text: promptFor(town, address) + " Base every number strictly on THIS document." },
          ],
        },
      ],
    });
    const block = res.content.find((b) => b.type === "text");
    const proposal = block && block.type === "text" ? (JSON.parse(block.text) as ZoningProposal) : null;
    if (!proposal) return { ok: false, error: "Could not read a zoning table from that PDF." };
    return { ok: true, proposal };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "PDF extraction failed." };
  }
}

/**
 * Look up setbacks by searching the town's online zoning code. Lower confidence
 * than the PDF path; the confirm step is the safeguard.
 */
export async function proposeFromWebSearch(
  town: string | null,
  address: string | null,
): Promise<ProposeResult> {
  const c = client();
  if (!c) return { ok: false, error: "ANTHROPIC_API_KEY is not set for Feasible — add it, then retry." };
  try {
    // Basic web_search variant on purpose: the _20260209 dynamic-filtering
    // variant runs code execution under the hood and can loop for minutes; the
    // basic one returns in ~20s, which is what a UI button needs.
    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 3072,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 3 }],
      messages: [
        {
          role: "user",
          content:
            promptFor(town, address) +
            " Search the town's official zoning regulations online. Put the page you relied on in source_url." +
            ' You MUST end your reply with a single JSON object on its own line of the form {"zoning_district","front_setback_ft","side_setback_ft","rear_setback_ft","max_coverage_pct","min_lot_sf","citation","confidence","source_url","notes"} — use null for any value you could not confirm, and set confidence to "low" when the numbers were not clearly found.',
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b.type === "text" ? b.text : ""))
      .join("\n");
    const proposal = extractJson(text);
    if (!proposal) return { ok: false, error: "The search didn't return a usable zoning table — try uploading the town's PDF." };
    return { ok: true, proposal };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Zoning search failed." };
  }
}
