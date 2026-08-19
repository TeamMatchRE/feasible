import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { dealRole, canRead, canWrite } from "@/lib/mf-access";
import { leadTagForProject, loadLatestLeadRead, listLeadReads } from "@/lib/hpd-queries";
import { fubConfigured } from "@/lib/fub";
import ProjectNav from "../ProjectNav";
import LeadSummary from "../LeadSummary";
import LeadControls from "./LeadControls";

export const dynamic = "force-dynamic";
// One refresh is a few dozen CRM requests plus a model call. The default
// function timeout cuts that off partway and leaves nothing written.
export const maxDuration = 300;

/**
 * LEADS — who is asking about this project.
 *
 * The sales side of a development lives in Follow Up Boss: every call-in and
 * showing is logged as a note on a person tagged with the community's name.
 * This reads them, counts them, and writes down what the notes say — so the
 * project's page can answer "how many leads do we have and what's happening
 * with them" without anyone opening the CRM and scrolling.
 *
 * READ ONLY. Nothing here writes to Follow Up Boss.
 */
export default async function LeadsPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const role = await dealRole(user, id);
  if (!canRead(role)) notFound();

  const target = await leadTagForProject(id);
  if (!target) notFound();

  const [latest, history] = await Promise.all([loadLatestLeadRead(id), listLeadReads(id)]);
  const earlier = history.filter((h) => h.id !== latest?.id);

  return (
    <Shell>
      <div className="mb-5">
        <Link href={`/multifamily/${id}`} className="text-xs uppercase tracking-wide text-muted hover:text-ink">
          ← {target.name}
        </Link>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">Leads</h1>
        <p className="mt-1 text-sm text-muted">
          Follow Up Boss contacts tagged “{target.tag}”
          {latest ? ` · ${latest.lead_count} at the last read` : ""}
        </p>
      </div>

      <ProjectNav dealId={id} active="/leads" />

      {canWrite(role) ? (
        <LeadControls
          projectId={id}
          tag={target.tag}
          explicit={target.explicit}
          projectName={target.name}
          fubReady={fubConfigured()}
          lastReadAt={latest?.created_at ?? null}
        />
      ) : (
        <p className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
          You have view access to this project, so you can read the last summary but not refresh it.
        </p>
      )}

      <div className="mt-4">
        {latest ? (
          <LeadSummary read={latest} projectId={id} />
        ) : (
          <p className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
            No reading yet. Press <strong className="text-ink">Refresh now</strong> and this fills in
            with the tagged leads and what the notes on them say.
          </p>
        )}
      </div>

      {latest && (latest.stats.byStage.length > 0 || latest.stats.byOwner.length > 0) && (
        <div className="mt-4 grid gap-4 sm:grid-cols-3">
          {(
            [
              ["By stage", latest.stats.byStage],
              ["By source", latest.stats.bySource],
              ["By owner", latest.stats.byOwner],
            ] as const
          ).map(([label, rows]) => (
            <div key={label} className="rounded-lg border border-line bg-white p-4">
              <p className="text-[11px] uppercase tracking-wide text-muted">{label}</p>
              <dl className="mt-2 space-y-1">
                {rows.map(([k, n]) => (
                  <div key={k} className="flex items-baseline justify-between gap-3 text-sm">
                    <dt className="truncate text-ink">{k}</dt>
                    <dd className="tabular-nums text-muted">{n}</dd>
                  </div>
                ))}
              </dl>
            </div>
          ))}
        </div>
      )}

      {earlier.length > 0 && (
        <div className="mt-6">
          <h2 className="text-sm font-semibold text-ink">Earlier readings</h2>
          <p className="mt-0.5 text-xs text-muted">
            Kept so the pipeline can be compared with itself over time.
          </p>
          <div className="mt-2 space-y-3">
            {earlier.map((r) => (
              <details key={r.id} className="rounded-lg border border-line bg-white p-4">
                <summary className="cursor-pointer text-sm text-ink">
                  <span className="font-medium">
                    {new Date(r.created_at).toLocaleDateString()}
                  </span>
                  <span className="ml-2 text-xs text-muted">
                    {r.lead_count} lead{r.lead_count === 1 ? "" : "s"} tagged “{r.tag}”
                    {r.generated_by_name ? ` · ${r.generated_by_name}` : ""}
                  </span>
                </summary>
                <div className="mt-3 border-t border-line pt-3">
                  {r.headline && <p className="text-sm font-medium text-ink">{r.headline}</p>}
                  {r.summary && (
                    <p className="mt-1 whitespace-pre-wrap text-sm leading-relaxed text-muted">
                      {r.summary}
                    </p>
                  )}
                </div>
              </details>
            ))}
          </div>
        </div>
      )}
    </Shell>
  );
}
