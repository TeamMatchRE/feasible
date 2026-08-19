"use server";

import { revalidatePath } from "next/cache";
import { sql } from "@/db";
import { requireUser } from "@/lib/session";
import { dealRole, canWrite } from "@/lib/mf-access";
import { leadTagForProject } from "@/lib/hpd-queries";
import { fubConfigured, peopleByTag, personActivity, inBatches, type FubPerson } from "@/lib/fub";
import { rollUp, type Lead, type LeadActivityItem } from "@/lib/leads";
import { summarizeLeads, LEAD_SUMMARY_MODEL } from "@/lib/lead-summary-ai";

/**
 * Reading a project's leads out of Follow Up Boss.
 *
 * One direction only: this fetches from FUB, counts, summarises, and stores the
 * reading here. It never writes to the CRM. Both actions gate on canWrite for
 * the deal, the same check every other project write uses — a viewer invited to
 * look at a project should not be able to pull the sales pipeline out of it, or
 * spend a model call doing so.
 */

async function gate(projectId: string) {
  const user = await requireUser();
  if (!canWrite(await dealRole(user, projectId))) return null;
  return user;
}

/** How many tagged people one refresh will read. Well above any real project. */
const MAX_LEADS = 200;

const primary = (list: { value: string }[] | undefined): boolean => (list?.length ?? 0) > 0;

/** FUB's person + timeline payloads, flattened into what src/lib/leads.ts wants. */
function toLead(p: FubPerson, activity: LeadActivityItem[]): Lead {
  const name =
    (p.name ?? "").trim() ||
    [p.firstName, p.lastName].filter(Boolean).join(" ").trim() ||
    `FUB ${p.id}`;
  return {
    fubId: p.id,
    name,
    stage: p.stage ?? null,
    source: p.source ?? null,
    assignedTo: p.assignedTo ?? null,
    created: p.created ?? null,
    lastActivity: p.lastActivity ?? null,
    hasEmail: primary(p.emails),
    hasPhone: primary(p.phones),
    activity: activity
      .filter((a) => a.text.trim())
      .sort((a, b) => (b.at ?? "").localeCompare(a.at ?? "")),
  };
}

export type LeadRefreshState = { error?: string; ok?: true; count?: number } | null;

/**
 * Read the tagged leads, count them, and write a dated summary.
 *
 * Deliberately not on a schedule. The read costs a model call and a few dozen
 * CRM requests, and a project's pipeline does not change hourly — it refreshes
 * when someone asks for it, and every reading is kept.
 */
export async function refreshLeads(
  _prev: LeadRefreshState,
  formData: FormData,
): Promise<LeadRefreshState> {
  const projectId = String(formData.get("projectId"));
  const user = await gate(projectId);
  if (!user) return { error: "You don't have permission to read leads for this project." };

  if (!fubConfigured()) {
    return { error: "FUB_API_KEY isn't set, so there's nothing to read from Follow Up Boss." };
  }

  const target = await leadTagForProject(projectId);
  if (!target) return { error: "That project no longer exists." };

  try {
    const people = await peopleByTag(target.tag, MAX_LEADS);
    if (people.length === 0) {
      return { error: `No one in Follow Up Boss carries the tag “${target.tag}”.` };
    }

    // Three timeline calls per person, four people at a time — see inBatches.
    const leads = await inBatches(people, 4, async (p) => {
      const { notes, calls, texts } = await personActivity(p.id);
      const items: LeadActivityItem[] = [
        ...notes.map((n) => ({
          kind: "note" as const,
          at: n.created ?? null,
          text: [n.subject, n.body].filter(Boolean).join(" — "),
        })),
        ...calls.map((c) => ({
          kind: "call" as const,
          at: c.created ?? null,
          text: [c.outcome, c.note].filter(Boolean).join(" — "),
        })),
        ...texts.map((t) => ({
          kind: "text" as const,
          at: t.created ?? null,
          text: `${t.isIncoming ? "them" : "us"}: ${t.message ?? ""}`,
        })),
      ];
      return toLead(p, items);
    });

    const asOf = new Date();
    const stats = rollUp(leads, asOf);

    const result = await summarizeLeads({
      projectName: target.name,
      tag: target.tag,
      leads,
      stats,
      asOf,
    });
    if (!result.ok) return { error: result.error };

    await sql`
      insert into feasible.project_lead_reads
        (project_id, tag, lead_count, stats, headline, summary, themes, attention, model, generated_by)
      values (${projectId}, ${target.tag}, ${stats.total},
              ${JSON.stringify(stats)}::jsonb,
              ${result.summary.headline}, ${result.summary.summary},
              ${JSON.stringify(result.summary.themes)}::jsonb,
              ${JSON.stringify(result.summary.attention)}::jsonb,
              ${LEAD_SUMMARY_MODEL}, ${user.id})`;

    revalidatePath(`/multifamily/${projectId}/leads`);
    revalidatePath(`/multifamily/${projectId}`);
    return { ok: true, count: stats.total };
  } catch (err) {
    // A CRM outage, a revoked key or a rate limit all land here. Say what
    // happened rather than showing an empty pipeline, which reads as "no leads".
    return { error: err instanceof Error ? err.message : "Reading Follow Up Boss failed." };
  }
}

/** Point the project at a different FUB tag; blank restores the project name. */
export async function saveLeadTag(formData: FormData) {
  const projectId = String(formData.get("projectId"));
  if (!(await gate(projectId))) return;

  const raw = String(formData.get("tag") ?? "").trim();
  await sql`
    update feasible.mf_deals set fub_lead_tag = ${raw || null}, updated_at = now()
    where id = ${projectId}`;
  revalidatePath(`/multifamily/${projectId}/leads`);
}
