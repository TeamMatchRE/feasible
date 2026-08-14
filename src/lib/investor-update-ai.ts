/**
 * INVESTOR UPDATES — you write the substance, the model writes the letter.
 *
 * David types a few lines about what is actually happening on site. This turns
 * that into an update an investor can read, in Heritage Point's voice, with the
 * project's real numbers alongside it.
 *
 * THE HARD RULE: the model may not invent facts. It gets the brief and a block
 * of figures pulled from the database, and it writes from those. It does not
 * estimate a completion date, promise a distribution, or characterise a return
 * that nobody stated. An investor update is a communication to people who have
 * given you money — a plausible-sounding invented milestone in one is a
 * materially different thing from a wrong number in a spreadsheet.
 *
 * Same propose→verify posture as the rest of the app's AI (zoning.ts,
 * mf-parking-ai.ts): this returns a DRAFT. Nothing sends. A human reads it,
 * edits it, and presses send — see the actions in src/app/multifamily/actions.ts.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";

const MODEL = "claude-opus-5";

export type UpdateFacts = {
  companyName: string;
  companyTagline: string | null;
  projectName: string;
  projectAddress: string;
  stage: string;
  /** Pre-formatted figure lines — already rounded and labelled by the caller. */
  figures: { label: string; value: string }[];
};

export type InvestorUpdateDraft = {
  subject: string;
  /** Plain-text body, paragraphs separated by blank lines. */
  body: string;
  /** Anything the model was asked to say but could not support from the facts. */
  omitted: string[];
};

export type UpdateResult =
  | { ok: true; draft: InvestorUpdateDraft }
  | { ok: false; error: string };

const SCHEMA = {
  type: "object",
  properties: {
    subject: {
      type: "string",
      description: "Email subject line. Name the project. No exclamation marks, no hype.",
    },
    body: {
      type: "string",
      description:
        "The update itself as plain text. Paragraphs separated by blank lines. " +
        "No markdown, no headings, no bullet characters, no signature block — " +
        "the template adds the letterhead and sign-off.",
    },
    omitted: {
      type: "array",
      items: { type: "string" },
      description:
        "Anything in the brief that could not be said without inventing a fact — " +
        "a date, a dollar figure, or a commitment that was implied but not stated. " +
        "Empty when the brief was fully supportable.",
    },
  },
  required: ["subject", "body", "omitted"],
  additionalProperties: false,
} as const;

const SYSTEM = `You write investor updates for a private real-estate development company.

Your reader is an individual investor who has put six figures into one project and
is not in the business day to day. They want to know what happened, what it means
for the project, and what happens next. They do not want marketing.

VOICE
Plain, specific, and calm. Short paragraphs. Write the way a competent partner
writes to someone whose money they are looking after: direct about progress,
equally direct about delay. No exclamation marks. No "we're thrilled to announce".
No adjectives doing work that a number should do.

THE RULE THAT MATTERS MOST
Write only from the brief and the figures you are given. You may reorganise,
explain, and add ordinary connective context — you may NOT introduce a fact that
is not there. Specifically, never invent or estimate:
  · a completion, closing, or delivery date
  · a distribution, return, timeline, or dollar amount
  · a permit, approval, sale, or milestone
  · a forward-looking promise of any kind

If the brief implies something you cannot support that way, leave it out of the
body and list it in "omitted" so a human can decide whether to add it. Omitting
something is always the correct choice over approximating it.

Where the brief is thin, a short update is the right answer. Do not pad.

FORM
Open with the single most important thing that happened. Then detail. Then what
is next, but only as far as the brief actually says. Close with an offer to answer
questions. Do not write a greeting line or a sign-off — the template supplies both.
Do not restate the figures table verbatim; refer to figures only where they carry
the point.`;

export async function draftInvestorUpdate(
  brief: string,
  facts: UpdateFacts,
): Promise<UpdateResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  }
  if (!brief.trim()) {
    return { ok: false, error: "Write a few lines about what is happening first." };
  }

  const figureLines = facts.figures.length
    ? facts.figures.map((f) => `  ${f.label}: ${f.value}`).join("\n")
    : "  (none provided)";

  const prompt = `PROJECT
  ${facts.projectName} — ${facts.projectAddress}
  Developer: ${facts.companyName}${facts.companyTagline ? `\n  Positioning: ${facts.companyTagline}` : ""}
  Current stage: ${facts.stage}

FIGURES ON RECORD (the only numbers you may use)
${figureLines}

WHAT THE PARTNER WROTE — this is the substance of the update:
"""
${brief.trim()}
"""

Write the investor update.`;

  try {
    const c = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await c.messages.create(
      {
        model: MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: {
          effort: "high",
          format: { type: "json_schema", schema: SCHEMA },
        },
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      },
      // The model reasons about what it may and may not assert; that is worth a
      // slower call, but not an unbounded one.
      { timeout: 120_000, maxRetries: 1 },
    );

    if (res.stop_reason === "refusal") {
      return { ok: false, error: "The model declined to draft this update." };
    }

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") {
      return { ok: false, error: "The model returned no draft." };
    }

    const parsed = JSON.parse(text.text) as InvestorUpdateDraft;
    return {
      ok: true,
      draft: {
        subject: String(parsed.subject ?? "").trim() || `${facts.projectName} — update`,
        body: String(parsed.body ?? "").trim(),
        omitted: Array.isArray(parsed.omitted)
          ? parsed.omitted.filter((s): s is string => typeof s === "string" && !!s.trim())
          : [],
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Draft failed." };
  }
}

// ---------------------------------------------------------------------------
// Branded HTML
// ---------------------------------------------------------------------------

export type Brand = {
  primary?: string;
  accent?: string;
  paper?: string;
  ink?: string;
  displayFont?: string;
  bodyFont?: string;
};

const esc = (s: string) =>
  s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

/**
 * Wrap the drafted text in the company's letterhead.
 *
 * Inline styles and a table-free single column, because that is what survives
 * Gmail, Outlook and Apple Mail. Web fonts are named but never relied on — the
 * stacks fall back to serif/sans, since a mail client that drops the font should
 * still render something composed rather than something broken.
 */
export function renderInvestorUpdateHtml(opts: {
  brand: Brand;
  companyName: string;
  tagline: string | null;
  projectName: string;
  body: string;
  greeting: string;
  signOffName: string;
  signOffTitle?: string | null;
  figures?: { label: string; value: string }[];
}): string {
  const b = opts.brand ?? {};
  const primary = b.primary ?? "#0A330F";
  const accent = b.accent ?? "#86AA5D";
  const paper = b.paper ?? "#F6F1E6";
  const ink = b.ink ?? "#1C1C1C";
  const display = `${b.displayFont ?? "Playfair Display"}, Georgia, 'Times New Roman', serif`;
  const body = `${b.bodyFont ?? "Afacad Flux"}, -apple-system, 'Helvetica Neue', Arial, sans-serif`;

  const paragraphs = opts.body
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean)
    .map(
      (p) =>
        `<p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:${ink};">${esc(p).replace(/\n/g, "<br>")}</p>`,
    )
    .join("");

  const figures = (opts.figures ?? []).length
    ? `<div style="margin:28px 0;padding:20px 24px;background:${paper};border-left:3px solid ${accent};">
         ${(opts.figures ?? [])
           .map(
             (f) =>
               `<div style="display:flex;justify-content:space-between;font-size:14px;line-height:2;color:${ink};">
                  <span style="color:${ink};opacity:.7;">${esc(f.label)}</span>
                  <strong style="color:${primary};">${esc(f.value)}</strong>
                </div>`,
           )
           .join("")}
       </div>`
    : "";

  return `<div style="margin:0;padding:0;background:#ffffff;">
  <div style="max-width:600px;margin:0 auto;padding:40px 32px;font-family:${body};">

    <div style="padding-bottom:24px;border-bottom:1px solid ${accent};">
      <div style="font-family:${display};font-size:26px;letter-spacing:.01em;color:${primary};">
        ${esc(opts.companyName)}
      </div>
      ${
        opts.tagline
          ? `<div style="margin-top:6px;font-size:13px;font-style:italic;color:${ink};opacity:.65;">${esc(opts.tagline)}</div>`
          : ""
      }
    </div>

    <div style="margin:28px 0 20px;font-family:${display};font-size:20px;color:${primary};">
      ${esc(opts.projectName)}
    </div>

    <p style="margin:0 0 16px;font-size:16px;line-height:1.65;color:${ink};">${esc(opts.greeting)}</p>

    ${paragraphs}
    ${figures}

    <p style="margin:28px 0 0;font-size:16px;line-height:1.65;color:${ink};">
      ${esc(opts.signOffName)}${opts.signOffTitle ? `<br><span style="opacity:.65;font-size:14px;">${esc(opts.signOffTitle)}</span>` : ""}
      <br><span style="opacity:.65;font-size:14px;">${esc(opts.companyName)}</span>
    </p>

    <div style="margin-top:36px;padding-top:18px;border-top:1px solid ${paper};font-size:12px;line-height:1.6;color:${ink};opacity:.55;">
      This update is provided for information only to existing investors in this project.
      It is not an offer to sell or a solicitation of an offer to buy any security, and it
      does not constitute investment advice. Figures are current as of the date of this
      message and are subject to change.
    </div>

  </div>
</div>`;
}
