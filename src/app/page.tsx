import Link from "next/link";
import Shell from "@/components/Shell";
import NewStudy from "./NewStudy";
import { deleteProject } from "./actions";
import { requireUser } from "@/lib/session";
import { listProjects } from "@/lib/queries";

export const dynamic = "force-dynamic";

const STATUS_STYLE: Record<string, string> = {
  feasible: "text-pass",
  not_feasible: "text-fail",
  in_review: "text-warn",
  draft: "text-muted",
  archived: "text-muted",
};

const STATUS_LABEL: Record<string, string> = {
  feasible: "Feasible",
  not_feasible: "Not feasible",
  in_review: "In review",
  draft: "Draft",
  archived: "Archived",
};

export default async function Home() {
  const user = await requireUser();
  const projects = await listProjects(user.id);

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-ink">
            Your studies
          </h1>
          <p className="mt-1 text-sm text-muted">
            Draw the lot, place the house, well, and septic — Feasible checks the
            setbacks and gives you a go / no-go.
          </p>
        </div>
        <NewStudy />
      </div>

      <div className="mt-8">
        {projects.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-parchment/40 px-6 py-16 text-center">
            <p className="font-display text-xl text-ink">No studies yet</p>
            <p className="mt-2 text-sm text-muted">
              Start one with a site address to open the map studio.
            </p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {projects.map((p) => (
              <li
                key={p.id}
                className="group relative rounded-lg border border-line bg-white/70 p-5 transition hover:border-gold hover:shadow-sm"
              >
                <Link href={`/projects/${p.id}`} className="block">
                  <div className="flex items-start justify-between gap-3">
                    <h2 className="font-display text-lg leading-snug text-ink">
                      {p.name}
                    </h2>
                    <span
                      className={`shrink-0 text-xs font-medium ${STATUS_STYLE[p.status] ?? "text-muted"}`}
                    >
                      {STATUS_LABEL[p.status] ?? p.status}
                    </span>
                  </div>
                  {p.address ? (
                    <p className="mt-1 truncate text-sm text-muted">{p.address}</p>
                  ) : (
                    <p className="mt-1 text-sm italic text-muted/70">No address</p>
                  )}
                  <p className="mt-4 text-xs text-muted">
                    {p.parcel_count} parcel{p.parcel_count === 1 ? "" : "s"} ·
                    updated {new Date(p.updated_at).toLocaleDateString()}
                  </p>
                </Link>
                <form action={deleteProject} className="absolute right-3 top-3 opacity-0 transition group-hover:opacity-100">
                  <input type="hidden" name="id" value={p.id} />
                  <button
                    type="submit"
                    title="Delete study"
                    className="rounded px-1.5 py-0.5 text-xs text-muted hover:text-fail"
                  >
                    Delete
                  </button>
                </form>
              </li>
            ))}
          </ul>
        )}
      </div>
    </Shell>
  );
}
