import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { dealRole, canRead, canWrite } from "@/lib/mf-access";
import { getConnection, googleConfigured } from "@/lib/google-oauth";
import { listFolder, prettySize, type DriveFile } from "@/lib/drive";
import { sql } from "@/db";
import ProjectNav from "../ProjectNav";
import LinkFolder from "./LinkFolder";

export const dynamic = "force-dynamic";

type LinkRow = { id: string; label: string; folder_id: string; url: string | null; stage: string | null };

/**
 * PROJECT FILES — the project's Drive folders, browsable in place.
 *
 * Read as the signed-in user, so this shows exactly what they'd see in Drive and
 * nothing more. `?folder=` walks into a subfolder without storing anything: the
 * saved links are the roots, and browsing below them is transient.
 */
export default async function FilesPage({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<{ folder?: string; name?: string }>;
}) {
  const { id } = await params;
  const sp = await searchParams;
  const user = await requireUser();
  const role = await dealRole(user, id);
  if (!canRead(role)) notFound();
  const editable = canWrite(role);

  const [deal] = await sql<{ name: string }[]>`select name from feasible.mf_deals where id = ${id}`;
  if (!deal) notFound();

  const links = await sql<LinkRow[]>`
    select id, label, folder_id, url, stage from feasible.project_drive_links
    where project_id = ${id} order by label`;

  const conn = await getConnection(user.id);
  const configured = googleConfigured();

  // Browse the folder in the query string, else the first linked folder.
  const openId = sp.folder ?? links[0]?.folder_id ?? null;
  let files: DriveFile[] = [];
  let error: string | null = null;
  let needsConnect = false;

  if (conn && openId) {
    const res = await listFolder(user.id, openId);
    if (res.ok) files = res.data;
    else {
      error = res.error;
      needsConnect = !!res.needsReconnect;
    }
  }

  return (
    <Shell>
      <div className="mb-5">
        <Link href={`/multifamily/${id}`} className="text-xs uppercase tracking-wide text-muted hover:text-ink">
          ← {deal.name}
        </Link>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">Files</h1>
        <p className="mt-1 text-sm text-muted">
          Read from Google Drive as you — folders shared with your account work without re-sharing.
        </p>
      </div>

      <ProjectNav dealId={id} active="/files" />

      {!configured ? (
        <p className="rounded-lg border border-line bg-white p-4 text-sm text-muted">
          <strong className="text-ink">Google Drive isn&rsquo;t configured on this deployment.</strong>{" "}
          <Link href="/settings/google" className="underline underline-offset-2">
            Setup instructions
          </Link>
        </p>
      ) : !conn ? (
        <div className="rounded-lg border border-line bg-white p-4">
          <p className="text-sm text-ink">Connect Google Drive to see this project&rsquo;s files.</p>
          <a
            href={`/api/google/connect?next=${encodeURIComponent(`/multifamily/${id}/files`)}`}
            className="mt-3 inline-block rounded bg-ink px-4 py-2 text-sm text-white hover:bg-ink/90"
          >
            Connect Google Drive
          </a>
        </div>
      ) : (
        <>
          {/* Linked roots */}
          <div className="mb-4 flex flex-wrap items-center gap-2">
            {links.map((l) => (
              <Link
                key={l.id}
                href={`/multifamily/${id}/files?folder=${l.folder_id}`}
                className={`rounded-full border px-3 py-1 text-xs ${
                  openId === l.folder_id
                    ? "border-ink bg-ink font-semibold text-white"
                    : "border-line text-muted hover:border-ink hover:text-ink"
                }`}
              >
                {l.label}
              </Link>
            ))}
            {links.length === 0 && (
              <span className="text-xs text-muted">No folders linked to this project yet.</span>
            )}
          </div>

          {error && (
            <p className="mb-4 rounded border border-line bg-white px-4 py-3 text-sm text-red-600">
              {error}{" "}
              {needsConnect && (
                <a href="/api/google/connect" className="underline underline-offset-2">
                  Reconnect
                </a>
              )}
            </p>
          )}

          {openId && !error && (
            <div className="overflow-x-auto rounded-lg border border-line bg-white">
              <table className="w-full min-w-[620px] text-sm">
                <thead className="border-b border-line bg-black/[0.02] text-left text-xs uppercase tracking-wide text-muted">
                  <tr>
                    <th className="p-3 font-medium">Name</th>
                    <th className="p-3 font-medium">Owner</th>
                    <th className="p-3 text-right font-medium">Size</th>
                    <th className="p-3 text-right font-medium">Modified</th>
                  </tr>
                </thead>
                <tbody>
                  {files.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="p-6 text-center text-sm text-muted">
                        This folder is empty.
                      </td>
                    </tr>
                  ) : (
                    files.map((f) => (
                      <tr key={f.id} className="border-b border-line/60 last:border-0">
                        <td className="p-3">
                          {f.isFolder ? (
                            <Link
                              href={`/multifamily/${id}/files?folder=${f.id}`}
                              className="text-ink underline-offset-2 hover:underline"
                            >
                              {f.name}/
                            </Link>
                          ) : f.webViewLink ? (
                            <a
                              href={f.webViewLink}
                              target="_blank"
                              rel="noreferrer"
                              className="text-ink underline-offset-2 hover:underline"
                            >
                              {f.name}
                            </a>
                          ) : (
                            <span className="text-ink">{f.name}</span>
                          )}
                        </td>
                        <td className="p-3 text-xs text-muted">{f.owner ?? "—"}</td>
                        <td className="p-3 text-right text-xs text-muted">{prettySize(f.size)}</td>
                        <td className="p-3 text-right text-xs text-muted">
                          {f.modifiedTime ? new Date(f.modifiedTime).toLocaleDateString() : "—"}
                        </td>
                      </tr>
                    ))
                  )}
                </tbody>
              </table>
            </div>
          )}

          {editable && (
            <div className="mt-4">
              <LinkFolder projectId={id} links={links} />
            </div>
          )}
        </>
      )}
    </Shell>
  );
}
