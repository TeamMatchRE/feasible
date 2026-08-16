"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { requireUser } from "@/lib/session";
import { dealRole, canWrite } from "@/lib/mf-access";
import { readTextFile, readBinaryFile, exportMimeFor } from "@/lib/drive";
import { extractProjectFromDocs, valueOf, type ExtractedProject, type SourceDoc } from "@/lib/project-extract";
import { ensureActiveScenario } from "@/lib/mf-scenarios";
import { asJson } from "@/lib/mf-queries";
import { DEFAULT_COST_PROGRAM, type CostProgram } from "@/lib/mf-costs";

/**
 * Read the project's own Drive documents and propose what they say.
 *
 * Two steps on purpose — extract, then apply — with a human reading the middle.
 * See project-extract.ts for why: these folders hold several passes at the same
 * project, and a one-click importer would quietly overwrite the live programme
 * with a superseded one.
 */

export type ExtractState =
  | { error: string; extracted?: undefined }
  | { extracted: ExtractedProject; error?: undefined }
  | null;

/** PDFs are the expensive input; a modest cap keeps one scan from dominating. */
const MAX_PDF_BYTES = 8 * 1024 * 1024;

export async function extractFromDrive(_prev: ExtractState, formData: FormData): Promise<ExtractState> {
  const projectId = String(formData.get("projectId"));
  const user = await requireUser();
  if (!canWrite(await dealRole(user, projectId))) {
    return { error: "You don't have permission to change this project." };
  }

  const picked = formData.getAll("doc").map(String);
  if (picked.length === 0) return { error: "Pick at least one document." };

  const docs: SourceDoc[] = [];
  const skipped: string[] = [];

  for (const spec of picked) {
    // "id|mimeType|name" — assembled by the page, which already listed them.
    const [id, mimeType, ...rest] = spec.split("|");
    const name = rest.join("|");

    if (exportMimeFor(mimeType) || mimeType.startsWith("text/")) {
      const r = await readTextFile(user.id, id, mimeType);
      if (r.ok) docs.push({ id, name, text: r.data });
      else skipped.push(`${name}: ${r.error}`);
    } else if (mimeType === "application/pdf") {
      const r = await readBinaryFile(user.id, id);
      if (!r.ok) skipped.push(`${name}: ${r.error}`);
      else if (r.data.bytes > MAX_PDF_BYTES) {
        skipped.push(`${name}: ${(r.data.bytes / 1024 / 1024).toFixed(1)} MB is too large to read.`);
      } else docs.push({ id, name, pdfBase64: r.data.base64 });
    } else {
      skipped.push(`${name}: not a readable format.`);
    }
  }

  if (docs.length === 0) {
    return { error: `Couldn't read anything. ${skipped.join(" ")}`.trim() };
  }

  const res = await extractProjectFromDocs(docs);
  if (!res.ok) return { error: res.error };

  // A file that couldn't be read is reported rather than silently dropped —
  // otherwise the result looks complete when it isn't.
  if (skipped.length) {
    res.extracted.notes = [...res.extracted.notes, ...skipped.map((s) => `Not read — ${s}`)];
  }
  return { extracted: res.extracted };
}

export type ApplyState = { error?: string; ok?: string } | null;

/**
 * Write only the ticked fields.
 *
 * Everything the app has no home for yet — financing terms, the conflicts, the
 * scenario notes — is appended to the project's notes with today's date and its
 * source, rather than dropped. A figure the app can't model is still a figure
 * the developer needs.
 */
export async function applyExtraction(_prev: ApplyState, formData: FormData): Promise<ApplyState> {
  const projectId = String(formData.get("projectId"));
  const user = await requireUser();
  if (!canWrite(await dealRole(user, projectId))) {
    return { error: "You don't have permission to change this project." };
  }

  let extracted: ExtractedProject;
  try {
    extracted = JSON.parse(String(formData.get("extracted") ?? "")) as ExtractedProject;
  } catch {
    return { error: "The proposal was lost — run the read again." };
  }

  const apply = new Set(formData.getAll("apply").map(String));
  if (apply.size === 0) return { error: "Nothing was ticked." };

  const scenarioId = await ensureActiveScenario(projectId);
  const [row] = await sql<{ cost_program: unknown }[]>`
    select cost_program from feasible.mf_scenarios where id = ${scenarioId}`;
  const stored = asJson<Partial<CostProgram>>(row?.cost_program, {});
  const program: CostProgram = {
    ...DEFAULT_COST_PROGRAM,
    ...stored,
    parking: { ...DEFAULT_COST_PROGRAM.parking, ...(stored.parking ?? {}) },
  };

  const applied: string[] = [];

  const land = valueOf(extracted.landCost);
  if (apply.has("landCost") && land != null) {
    program.landCost = land;
    applied.push(`land cost $${land.toLocaleString()}`);
  }

  const perSf = valueOf(extracted.costToBuildPerSqFt);
  if (apply.has("costToBuildPerSqFt") && perSf != null) {
    program.residentialCostPerSf = perSf;
    applied.push(`$${perSf}/SF build cost`);
  }

  const road = valueOf(extracted.roadLengthFt);
  if (apply.has("roadLengthFt") && road != null) {
    program.infrastructure = program.infrastructure.map((l) =>
      l.id === "road" ? { ...l, quantity: road } : l,
    );
    applied.push(`${road.toLocaleString()} LF of road`);
  }

  const total = valueOf(extracted.totalProjectCost);
  if (apply.has("totalProjectCost") && total != null) {
    // An imported total is a stated figure, not one this app built up — so it
    // goes in as an override with the computed budget left intact beside it.
    program.useComputed = false;
    program.overrideTotal = total;
    applied.push(`total project cost $${total.toLocaleString()} (as an override)`);
  }

  await sql`
    update feasible.mf_scenarios
       set cost_program = ${JSON.stringify(program)}::jsonb,
           total_project_cost = ${total != null && apply.has("totalProjectCost") ? total : sql`total_project_cost`},
           updated_at = now()
     where id = ${scenarioId}`;

  // Everything without a field, kept where a human will see it.
  const stamp = new Date().toISOString().slice(0, 10);
  const lines: string[] = [`=== Read from Drive ${stamp} ===`];
  if (applied.length) lines.push(`Applied: ${applied.join("; ")}.`);

  const fin: string[] = [];
  const loan = valueOf(extracted.loanAmount);
  const rate = valueOf(extracted.loanRateMonthlyPct);
  const term = valueOf(extracted.loanTermMonths);
  const equity = valueOf(extracted.equityRaiseTarget);
  if (loan != null) fin.push(`loan $${loan.toLocaleString()}`);
  if (rate != null) fin.push(`${rate}%/month`);
  if (term != null) fin.push(`${term} month term`);
  if (equity != null) fin.push(`private equity target $${equity.toLocaleString()}`);
  if (fin.length) lines.push(`Financing (no field for this yet): ${fin.join(", ")}.`);

  if (extracted.conflicts.length) {
    lines.push("", "CONFLICTS BETWEEN DOCUMENTS — read before trusting any of the above:");
    extracted.conflicts.forEach((c) => lines.push(`  · ${c}`));
  }
  if (extracted.notes.length) {
    lines.push("", "Also noted:");
    extracted.notes.forEach((n) => lines.push(`  · ${n}`));
  }

  await sql`
    update feasible.mf_deals
       set notes = coalesce(notes, '') || ${"\n\n" + lines.join("\n")}, updated_at = now()
     where id = ${projectId}`;

  revalidatePath(`/multifamily/${projectId}`);
  revalidatePath(`/multifamily/${projectId}/import`);

  return {
    ok: applied.length
      ? `Applied ${applied.length} value${applied.length === 1 ? "" : "s"}. Findings and conflicts were added to the project notes.`
      : "Nothing was applied to the model, but the findings and conflicts were added to the project notes.",
  };
}
