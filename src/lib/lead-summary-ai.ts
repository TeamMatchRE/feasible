/**
 * WHAT IS GOING ON WITH THIS PROJECT'S LEADS.
 *
 * The counts come from src/lib/leads.ts. This adds the half arithmetic cannot
 * reach: sixteen people tagged "The Enclave" is a number, and "most of them are
 * downsizers who like the location but are waiting to sell their own house" is
 * the thing you actually wanted to know. The raw material is the agent's own
 * follow-up notes in Follow Up Boss, which on this account are where the
 * substance lives.
 *
 * THE HARD RULE, same as investor-update-ai.ts: the model summarises what the
 * notes say and invents nothing. It does not score a lead's likelihood, decide
 * someone is "ready to buy", or produce a figure — every number on the page is
 * counted in code and handed to it. A pipeline summary that quietly upgrades a
 * maybe into a hot prospect is worse than no summary, because someone will
 * plan around it.
 *
 * PII: this sends lead names and the agent's notes about them to the Anthropic
 * API. That is the same posture as the app's other AI features, and the leads
 * are the company's own CRM records — but it is worth knowing that it is what
 * this does.
 */
import "server-only";
import Anthropic from "@anthropic-ai/sdk";
import type { Lead, LeadStats } from "@/lib/leads";
import { toDigest } from "@/lib/leads";

export const LEAD_SUMMARY_MODEL = "claude-opus-5";

export type LeadTheme = { label: string; detail: string };
export type LeadAttention = { lead: string; why: string };

export type LeadSummary = {
  headline: string;
  summary: string;
  themes: LeadTheme[];
  attention: LeadAttention[];
};

export type LeadSummaryResult =
  | { ok: true; summary: LeadSummary }
  | { ok: false; error: string };

const SCHEMA = {
  type: "object",
  properties: {
    headline: {
      type: "string",
      description:
        "One sentence answering 'what is going on with these leads'. No greeting, no project name preamble.",
    },
    summary: {
      type: "string",
      description:
        "Two to four short paragraphs of plain text, separated by blank lines. No markdown, no " +
        "headings, no bullet characters. Where the pipeline is thin, say so briefly rather than padding.",
    },
    themes: {
      type: "array",
      description:
        "The patterns that actually recur across the notes — what these people have in common, " +
        "what they keep asking for, what keeps stalling them. Between zero and six; zero is the " +
        "right answer when the notes are too thin to show a pattern.",
      items: {
        type: "object",
        properties: {
          label: { type: "string", description: "A few words, e.g. 'Waiting to sell first'." },
          detail: {
            type: "string",
            description:
              "One or two sentences grounded in the notes, naming leads where it helps.",
          },
        },
        required: ["label", "detail"],
        additionalProperties: false,
      },
    },
    attention: {
      type: "array",
      description:
        "Leads where the notes themselves show something outstanding — a promised follow-up that " +
        "has not happened, a question left unanswered, a showing to book. Only where the notes say " +
        "so. Do not list a lead merely because they have gone quiet; the page counts that already.",
      items: {
        type: "object",
        properties: {
          lead: { type: "string", description: "The lead's name exactly as given." },
          why: { type: "string", description: "One sentence, from the notes." },
        },
        required: ["lead", "why"],
        additionalProperties: false,
      },
    },
  },
  required: ["headline", "summary", "themes", "attention"],
  additionalProperties: false,
} as const;

const SYSTEM = `You summarise a real-estate development's sales pipeline for the partners building it.

WHAT YOU ARE READING
A list of leads from the team's CRM, each with their stage, source, owner, how
old they are, and the agent's own follow-up notes. The notes are the substance:
they are what the agent wrote down after speaking to the person.

WHAT THE READER WANTS
Two things, in this order: what is actually happening across these people, and
anything that needs doing. They already know how many leads there are — that is
counted for them and shown alongside your summary. Your job is the pattern and
the specifics.

THE RULE THAT MATTERS MOST
Write only from the notes and fields you are given.
  · Do not invent a conversation, an objection, a budget, a timeline or a visit.
  · Do not state any number that is not in the FIGURES block. If you want to say
    how many leads want a Ranch, and nobody counted that, write "several" or
    name them — do not produce a figure.
  · Do not upgrade someone's interest. "Said she was too busy" is not "warm".
    If the notes are ambiguous, the summary is ambiguous.
  · Do not predict, score, or rank likelihood to buy. Nobody gave you the
    evidence for that.
  · Names: use only names present in the list. Never write about a lead who is
    not there.

VOICE
Plain and specific. Short paragraphs. Write the way one partner briefs another:
direct about interest, equally direct about stalls and silence. No marketing
language, no exclamation marks, no "exciting pipeline". Concrete detail from the
notes beats an adjective every time.

Where the notes are thin, a three-sentence summary is the correct output. Do not
pad it out to look thorough.`;

export async function summarizeLeads(args: {
  projectName: string;
  tag: string;
  leads: Lead[];
  stats: LeadStats;
  asOf?: Date;
}): Promise<LeadSummaryResult> {
  if (!process.env.ANTHROPIC_API_KEY) {
    return { ok: false, error: "ANTHROPIC_API_KEY is not set." };
  }
  if (args.leads.length === 0) {
    return { ok: false, error: `No Follow Up Boss leads carry the tag “${args.tag}”.` };
  }

  const asOf = args.asOf ?? new Date();
  const s = args.stats;
  const list = (pairs: [string, number][]) =>
    pairs.length ? pairs.map(([k, n]) => `${k} ${n}`).join(", ") : "none";

  // The only numbers the model may use. Everything here was counted in
  // src/lib/leads.ts from the same payload the digest was built from.
  const figures = [
    `Leads carrying the tag: ${s.total}`,
    `Created in the last 30 days: ${s.newLast30}`,
    `No activity in 21+ days: ${s.quiet}`,
    `Never touched at all: ${s.neverTouched}`,
    `No email and no phone: ${s.unreachable}`,
    `By stage: ${list(s.byStage)}`,
    `By source: ${list(s.bySource)}`,
    `By owner: ${list(s.byOwner)}`,
  ].join("\n  ");

  const prompt = `PROJECT
  ${args.projectName}
  Leads are the people tagged "${args.tag}" in Follow Up Boss.
  Read as of ${asOf.toISOString().slice(0, 10)}.

FIGURES (counted from the same records — the only numbers you may state)
  ${figures}

THE LEADS, newest first. Each bullet is one person; the indented lines are their
timeline, most recent first.
${toDigest(args.leads, asOf)}

Write the summary.`;

  try {
    const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
    const res = await client.messages.create(
      {
        model: LEAD_SUMMARY_MODEL,
        max_tokens: 8000,
        thinking: { type: "adaptive" },
        output_config: {
          // The work is reading carefully and refusing to overstate, not deep
          // reasoning — medium keeps a routine refresh cheap.
          effort: "medium",
          format: { type: "json_schema", schema: SCHEMA },
        },
        system: SYSTEM,
        messages: [{ role: "user", content: prompt }],
      },
      { timeout: 120_000, maxRetries: 1 },
    );

    if (res.stop_reason === "refusal") {
      return { ok: false, error: "The model declined to summarise these leads." };
    }

    const text = res.content.find((b) => b.type === "text");
    if (!text || text.type !== "text") return { ok: false, error: "The model returned nothing." };

    const parsed = JSON.parse(text.text) as Partial<LeadSummary>;
    const cleanList = <T>(v: unknown, keep: (x: Record<string, unknown>) => T | null): T[] =>
      Array.isArray(v)
        ? v.flatMap((x) => {
            const kept = x && typeof x === "object" ? keep(x as Record<string, unknown>) : null;
            return kept ? [kept] : [];
          })
        : [];

    // Names come back as free text, so a hallucinated one is possible however
    // firmly the prompt forbids it. Anything not in the list we sent is dropped
    // rather than shown: an "action" against a person who does not exist is the
    // one failure that would send someone into the CRM looking for a ghost.
    const known = new Set(args.leads.map((l) => l.name.trim().toLowerCase()).filter(Boolean));

    return {
      ok: true,
      summary: {
        headline: String(parsed.headline ?? "").trim(),
        summary: String(parsed.summary ?? "").trim(),
        themes: cleanList<LeadTheme>(parsed.themes, (t) =>
          typeof t.label === "string" && typeof t.detail === "string" && t.label.trim()
            ? { label: t.label.trim(), detail: String(t.detail).trim() }
            : null,
        ),
        attention: cleanList<LeadAttention>(parsed.attention, (a) =>
          typeof a.lead === "string" &&
          typeof a.why === "string" &&
          known.has(a.lead.trim().toLowerCase())
            ? { lead: a.lead.trim(), why: String(a.why).trim() }
            : null,
        ),
      },
    };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Summary failed." };
  }
}
