import Link from "next/link";
import Shell from "@/components/Shell";
import NewDesign from "./NewDesign";
import { deleteDesign } from "./actions";
import { requireUser } from "@/lib/session";
import { listDesigns } from "@/lib/queries";

export const dynamic = "force-dynamic";

function spec(d: { model_type: string | null; living_area_sf: number | null; bedrooms: number | null; bathrooms: number | null }): string {
  const bits = [
    d.model_type,
    d.living_area_sf ? `${Math.round(d.living_area_sf).toLocaleString()} sf` : null,
    d.bedrooms != null ? `${d.bedrooms} bd` : null,
    d.bathrooms != null ? `${d.bathrooms} ba` : null,
  ].filter(Boolean);
  return bits.join(" · ") || "No specs yet";
}

export default async function DesignsPage() {
  const user = await requireUser();
  const designs = await listDesigns(user.id);

  return (
    <Shell>
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h1 className="font-display text-3xl tracking-tight text-ink">Your designs</h1>
          <p className="mt-1 text-sm text-muted">
            Upload a plan set — the AI reads it, fills the specs, and builds a quantity takeoff you can review.
          </p>
        </div>
      </div>

      <div className="mt-6">
        <NewDesign ownerId={user.id} />
      </div>

      <div className="mt-8">
        {designs.length === 0 ? (
          <div className="rounded-lg border border-dashed border-line bg-parchment/40 px-6 py-16 text-center">
            <p className="font-display text-xl text-ink">No designs yet</p>
            <p className="mt-2 text-sm text-muted">Upload a plan set above to get started.</p>
          </div>
        ) : (
          <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
            {designs.map((d) => (
              <li
                key={d.id}
                className="group relative rounded-lg border border-line bg-white/70 p-5 transition hover:border-gold hover:shadow-sm"
              >
                <Link href={`/designs/${d.id}`} className="block">
                  <h2 className="font-display text-lg leading-snug text-ink">{d.name}</h2>
                  <p className="mt-1 text-sm text-muted">{spec(d)}</p>
                  <p className="mt-4 text-xs text-muted">
                    updated {new Date(d.updated_at).toLocaleDateString()}
                  </p>
                </Link>
                <form action={deleteDesign} className="absolute right-3 top-3 opacity-0 transition group-hover:opacity-100">
                  <input type="hidden" name="id" value={d.id} />
                  <button type="submit" title="Delete design" className="rounded px-1.5 py-0.5 text-xs text-muted hover:text-fail">
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
