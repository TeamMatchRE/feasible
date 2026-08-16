import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { dealRole, canRead, canWrite } from "@/lib/mf-access";
import { getConnection } from "@/lib/google-oauth";
import { listFolder, isReadable } from "@/lib/drive";
import { ensureActiveScenario } from "@/lib/mf-scenarios";
import { asJson } from "@/lib/mf-queries";
import { DEFAULT_COST_PROGRAM, type CostProgram } from "@/lib/mf-costs";
import { sql } from "@/db";
import ProjectNav from "../ProjectNav";
import ImportPanel from "./ImportPanel";

export const dynamic = "force-dynamic";

/**
 * READ FROM DRIVE — the project's own documents, proposed back to it.
 *
 * The current values sit beside every proposal, because the interesting case is
 * disagreement: this folder's underwriting workbook models seven raw lots while
 * the live programme builds eight homes. Showing only the proposal would make
 * accepting it look like filling a blank.
 */
export default async function ImportPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const role = await dealRole(user, id);
  if (!canRead(role)) notFound();
  if (!canWrite(role)) notFound();

  const [deal] = await sql<{ name: string }[]>`select name from feasible.mf_deals where id = ${id}`;
  if (!deal) notFound();

  const conn = await getConnection(user.id);
  const [link] = await sql<{ folder_id: string; label: string }[]>`
    select folder_id, label from feasible.project_drive_links
    where project_id = ${id} order by created_at limit 1`;

  // What the app holds now, so each proposal has something to be compared with.
  const scenarioId = await ensureActiveScenario(id);
  const [sc] = await sql<{ cost_program: unknown; total_project_cost: string }[]>`
    select cost_program, total_project_cost from feasible.mf_scenarios where id = ${scenarioId}`;
  const stored = asJson<Partial<CostProgram>>(sc?.cost_program, {});
  const program: CostProgram = { ...DEFAULT_COST_PROGRAM, ...stored };
  const [lots] = await sql<{ n: number }[]>`
    select count(*)::int as n from feasible.project_lots where project_id = ${id}`;

  const current = {
    lotCount: lots?.n ?? 0,
    landCost: program.landCost ?? 0,
    costToBuildPerSqFt: program.residentialCostPerSf ?? null,
    roadLengthFt: program.infrastructure?.find((l) => l.id === "road")?.quantity ?? null,
    totalProjectCost: Number(sc?.total_project_cost ?? 0),
  };

  let docs: { id: string; name: string; mimeType: string; size: number | null }[] = [];
  let error: string | null = null;

  if (conn && link) {
    const res = await listFolder(user.id, link.folder_id);
    if (res.ok) {
      docs = res.data
        .filter((f) => !f.isFolder && isReadable(f.mimeType))
        .map((f) => ({ id: f.id, name: f.name, mimeType: f.mimeType, size: f.size }));
    } else error = res.error;
  }

  return (
    <Shell>
      <div className="mb-5">
        <Link href={`/multifamily/${id}`} className="text-xs uppercase tracking-wide text-muted hover:text-ink">
          ← {deal.name}
        </Link>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">Read from Drive</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Pick the documents that describe this project and they&rsquo;ll be read for figures —
          lot count, costs, financing. Nothing is written until you tick it.
        </p>
      </div>

      <ProjectNav dealId={id} active="/import" />

      {!conn ? (
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-sm text-ink">Connect Google Drive first.</p>
          <a
            href={`/api/google/connect?next=${encodeURIComponent(`/multifamily/${id}/import`)}`}
            className="mt-3 inline-block rounded bg-ink px-4 py-2 text-sm text-white"
          >
            Connect Google Drive
          </a>
        </div>
      ) : !link ? (
        <p className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
          No Drive folder linked to this project yet —{" "}
          <Link href={`/multifamily/${id}/files`} className="underline underline-offset-2">
            link one on the Files tab
          </Link>
          .
        </p>
      ) : error ? (
        <p className="rounded-lg border border-line bg-white p-4 text-sm text-red-600">{error}</p>
      ) : (
        <ImportPanel projectId={id} folderLabel={link.label} docs={docs} current={current} />
      )}
    </Shell>
  );
}
