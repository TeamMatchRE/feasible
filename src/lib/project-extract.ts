import "server-only";
import Anthropic from "@anthropic-ai/sdk";

/**
 * READ THE PROJECT'S OWN DOCUMENTS AND PROPOSE WHAT THEY SAY.
 *
 * Heritage Point's Drive already holds the underwriting workbook, the term
 * sheet, the quote and the subdivision plan. Retyping those into Feasible is
 * work nobody should do twice, so the model reads them and proposes values.
 *
 * IT PROPOSES. IT NEVER WRITES.
 *
 * That is not caution for its own sake — it is what the documents themselves
 * demand. The Enclave's workbook models SEVEN lots sold raw at $165,000 each,
 * while the live programme is EIGHT finished homes at $699,900 and $769,900.
 * Both are real; the workbook is simply an earlier acquisition-stage case. An
 * importer that "filled in the blanks" would silently replace the current
 * programme with a superseded one and call it data entry.
 *
 * So every field comes back with the figure, WHERE it was found, and how sure
 * the model is — and the UI shows it beside what the app already holds, with
 * disagreements called out. The human decides which is true.
 */

const MODEL = "claude-opus-5";

export type SourceDoc = {
  id: string;
  name: string;
  /** Extracted text, for Docs/Sheets/plain text. */
  text?: string;
  /** Base64 PDF, for anything that has to be read as a document. */
  pdfBase64?: string;
};

/**
 * `found` rather than a nullable value.
 *
 * Structured outputs cap a schema at 16 union-typed parameters, and one
 * `number | null` per field blew straight past it. An explicit boolean says the
 * same thing, costs no unions, and reads better in the prompt: the model is
 * answering "did you find this?" rather than choosing between a number and a
 * null it might feel obliged to fill.
 */
export type ExtractedField<T = number> = {
  found: boolean;
  value: T;
  /** Which document, and where in it. Meaningless when `found` is false. */
  source: string;
  confidence: "high" | "medium" | "low";
};

/** Read a field the way callers actually want it. */
export const valueOf = (f: ExtractedField): number | null => (f.found ? f.value : null);

export type ExtractedProject = {
  lotCount: ExtractedField<number>;
  homeStyles: { name: string; price: number; squareFeet: number; source: string }[];
  landCost: ExtractedField<number>;
  totalProjectCost: ExtractedField<number>;
  costToBuildPerSqFt: ExtractedField<number>;
  roadLengthFt: ExtractedField<number>;
  loanAmount: ExtractedField<number>;
  loanRateMonthlyPct: ExtractedField<number>;
  loanTermMonths: ExtractedField<number>;
  equityRaiseTarget: ExtractedField<number>;
  /** Anything material the model saw that the fields above have no home for. */
  notes: string[];
  /** Places the documents contradict each other, in the model's own words. */
  conflicts: string[];
};

export type ExtractResult =
  | { ok: true; extracted: ExtractedProject }
  | { ok: false; error: string };

const FIELD = (desc: string) => ({
  type: "object",
  properties: {
    found: { type: "boolean", description: `True only if the documents state or directly compute this. ${desc}` },
    value: { type: "number", description: `${desc} Use 0 when found is false.` },
    source: { type: "string", description: "Document name and the row/label it came from. Empty string when found is false." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
  },
  required: ["found", "value", "source", "confidence"],
  additionalProperties: false,
});

const SCHEMA = {
  type: "object",
  properties: {
    lotCount: FIELD("Number of lots or homes in the project."),
    homeStyles: {
      type: "array",
      description:
        "Distinct home products offered, with asking price and typical size. Empty if the documents only model raw lot sales.",
      items: {
        type: "object",
        properties: {
          name: { type: "string" },
          price: { type: "number", description: "Asking price. 0 if the documents don't give one." },
          squareFeet: { type: "number", description: "Typical size. 0 if not stated." },
          source: { type: "string" },
        },
        required: ["name", "price", "squareFeet", "source"],
        additionalProperties: false,
      },
    },
    landCost: FIELD("Land acquisition cost."),
    totalProjectCost: FIELD("Total project cost, all in."),
    costToBuildPerSqFt: FIELD("Vertical construction cost per square foot."),
    roadLengthFt: FIELD("Length of road/infrastructure in linear feet."),
    loanAmount: FIELD("Debt/loan principal."),
    loanRateMonthlyPct: FIELD("Interest rate as a MONTHLY percent, e.g. 0.84 for 0.84%/month."),
    loanTermMonths: FIELD("Loan term in months."),
    equityRaiseTarget: FIELD("Private equity to be raised."),
    notes: {
      type: "array",
      items: { type: "string" },
      description: "Material facts worth keeping that no field above captures.",
    },
    conflicts: {
      type: "array",
      items: { type: "string" },
      description:
        "Where the documents disagree with each other — different lot counts, prices, or scenarios. State both figures and which document each came from.",
    },
  },
  required: [
    "lotCount", "homeStyles", "landCost", "totalProjectCost", "costToBuildPerSqFt",
    "roadLengthFt", "loanAmount", "loanRateMonthlyPct", "loanTermMonths",
    "equityRaiseTarget", "notes", "conflicts",
  ],
  additionalProperties: false,
} as const;

const SYSTEM = `You read a real estate developer's own project documents and report what they say.

You are NOT filling in a form. You are reporting findings, and the reader will
decide what to accept. That distinction governs everything below.

RULES

Report only what the documents state or directly compute. Never estimate, never
average two figures into one, never carry a number over from general knowledge
about how projects like this usually look.

Cite where each figure came from — the document name and the row label or
heading. A figure without a traceable source is worth less than no figure.

DOCUMENTS DISAGREE, AND THAT IS THE MOST IMPORTANT THING YOU REPORT.
A developer's folder accumulates several passes at the same project: an
acquisition model, a later build programme, a lender's term sheet. These often
describe DIFFERENT scenarios rather than one truth — one may sell raw lots while
another builds finished homes on them, with different counts and different
prices. Do not reconcile them, do not average them, and do not silently pick the
larger, newer-looking, or more detailed one.

Instead: put the most complete single scenario in the fields, and list every
material disagreement in "conflicts", naming both figures and both documents.
If the documents model two different business plans, say so plainly there.

Set found=false for anything the documents do not support. found=false is a
perfectly good answer and always better than a plausible number — a wrong figure
here becomes a wrong figure in a live project.

Confidence: "high" only when the document states the figure outright and nothing
contradicts it. "medium" when it is computed or one document among several.
"low" when you are reading between the lines — and prefer found=false to a
low-confidence guess on anything financial.`;

export async function extractProjectFromDocs(docs: SourceDoc[]): Promise<ExtractResult> {
  if (!process.env.ANTHROPIC_API_KEY) return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  if (docs.length === 0) return { ok: false, error: "Pick at least one document to read." };

  const content: Anthropic.ContentBlockParam[] = [];

  for (const d of docs) {
    if (d.pdfBase64) {
      content.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: d.pdfBase64 },
        title: d.name,
      });
    } else if (d.text) {
      // Truncated per document rather than globally, so one enormous export
      // can't crowd every other document out of the request.
      content.push({
        type: "text",
        text: `--- DOCUMENT: ${d.name} ---\n${d.text.slice(0, 60_000)}`,
      });
    }
  }

  content.push({
    type: "text",
    text:
      "Report what these documents say about the project. Remember: where they " +
      "describe different scenarios, put the most complete one in the fields and " +
      "list the disagreements in conflicts.",
  });

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create(
      {
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: { effort: "high", format: { type: "json_schema", schema: SCHEMA } },
        system: SYSTEM,
        messages: [{ role: "user", content }],
      },
      { timeout: 180_000, maxRetries: 1 },
    );

    if (res.stop_reason === "refusal") return { ok: false, error: "The model declined to read these." };

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { ok: false, error: "No result returned." };

    return { ok: true, extracted: JSON.parse(text.text) as ExtractedProject };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Extraction failed." };
  }
}
