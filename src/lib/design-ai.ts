import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * AI read of an uploaded house-design plan set → specs + a comprehensive
 * quantity takeoff. Claude (Opus 4.8) vision over the plan pages (PDF as a
 * document, images as image blocks) with a strict JSON schema. This is an AI
 * ESTIMATE to review — never an estimator's takeoff — so every number carries a
 * confidence and the model is told to leave a value null rather than guess.
 *
 * Units are the feasible.unit_of_measure enum (EA/LF/SF/SY/CY/TON/GAL/LS/HR).
 * There is no "square" unit — roofing is returned in SF; the UI shows squares
 * (SF / 100).
 */

const MODEL = "claude-opus-4-8";

export interface DesignMeta {
  model_type: string | null; // style, e.g. "Colonial", "Ranch"
  living_area_sf: number | null;
  stories: number | null;
  bedrooms: number | null;
  bathrooms: number | null;
  footprint_width_ft: number | null;
  footprint_depth_ft: number | null;
  confidence: string | null;
  notes: string | null;
}
export interface TakeoffItem {
  category: string;
  description: string | null;
  quantity: number;
  unit: string; // enum value
  confidence: string | null;
}
export interface DesignAnalysis {
  meta: DesignMeta;
  takeoff: TakeoffItem[];
}
export interface AnalyzeResult {
  ok: boolean;
  analysis?: DesignAnalysis;
  error?: string;
}

export interface PlanFile {
  b64: string; // base64, no data: prefix
  mediaType: string; // application/pdf | image/png | image/jpeg | image/webp | image/gif
}

const numOrNull = { anyOf: [{ type: "number" }, { type: "null" }] } as const;
const strOrNull = { anyOf: [{ type: "string" }, { type: "null" }] } as const;

const SCHEMA = {
  type: "object",
  additionalProperties: false,
  properties: {
    meta: {
      type: "object",
      additionalProperties: false,
      properties: {
        model_type: strOrNull,
        living_area_sf: numOrNull,
        stories: numOrNull,
        bedrooms: numOrNull,
        bathrooms: numOrNull,
        footprint_width_ft: numOrNull,
        footprint_depth_ft: numOrNull,
        confidence: strOrNull,
        notes: strOrNull,
      },
      required: [
        "model_type",
        "living_area_sf",
        "stories",
        "bedrooms",
        "bathrooms",
        "footprint_width_ft",
        "footprint_depth_ft",
        "confidence",
        "notes",
      ],
    },
    takeoff: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        properties: {
          category: { type: "string" },
          description: strOrNull,
          quantity: { type: "number" },
          unit: { type: "string", enum: ["EA", "LF", "SF", "SY", "CY", "TON", "GAL", "LS", "HR"] },
          confidence: strOrNull,
        },
        required: ["category", "description", "quantity", "unit", "confidence"],
      },
    },
  },
  required: ["meta", "takeoff"],
} as const;

const PROMPT = [
  "You are a construction estimator reading a residential house-design plan set (floor plans,",
  "elevations, roof plan, sections). Produce two things:",
  "1) meta: the design's style (model_type), heated living area (living_area_sf), number of stories,",
  "   bedrooms, bathrooms, and the building footprint width x depth in feet.",
  "2) takeoff: a COMPREHENSIVE quantity takeoff. Include, where the plans support it: windows (EA),",
  "   exterior doors (EA), interior doors (EA), roofing (SF — total roof area, not squares),",
  "   siding/exterior wall cladding (SF), soffit & fascia (LF), gutters (LF), flooring broken out by",
  "   type (SF each), interior wall drywall (SF), ceiling drywall (SF), insulation (SF), and plumbing",
  "   fixtures (EA). Add other meaningful categories you can quantify.",
  "Rules: base every number ONLY on what the plans actually show or let you compute. If a value",
  "isn't determinable, leave it null (meta) or omit that takeoff line (do NOT guess). Give each item",
  "and the meta a confidence of 'high' | 'medium' | 'low'. Units MUST be one of",
  "EA/LF/SF/SY/CY/TON/GAL/LS/HR (roofing and siding in SF). This is an advisory estimate for review.",
].join(" ");

function client(): Anthropic | null {
  if (!process.env.ANTHROPIC_API_KEY) return null;
  return new Anthropic({ timeout: 120_000, maxRetries: 1 });
}

export async function analyzeDesign(files: PlanFile[]): Promise<AnalyzeResult> {
  const c = client();
  if (!c) return { ok: false, error: "ANTHROPIC_API_KEY is not set for Feasible — add it, then retry." };
  if (files.length === 0) return { ok: false, error: "No plan file provided." };
  try {
    const content: Anthropic.ContentBlockParam[] = files.map((f) =>
      f.mediaType === "application/pdf"
        ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: f.b64 } }
        : {
            type: "image",
            source: {
              type: "base64",
              media_type: f.mediaType as "image/png" | "image/jpeg" | "image/webp" | "image/gif",
              data: f.b64,
            },
          },
    );
    content.push({ type: "text", text: PROMPT });

    const res = await c.messages.create({
      model: MODEL,
      max_tokens: 8192,
      output_config: { format: { type: "json_schema", schema: SCHEMA } },
      messages: [{ role: "user", content }],
    });
    const block = res.content.find((b) => b.type === "text");
    const analysis = block && block.type === "text" ? (JSON.parse(block.text) as DesignAnalysis) : null;
    if (!analysis) return { ok: false, error: "Could not read a design from those plans." };
    return { ok: true, analysis };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Design analysis failed." };
  }
}
