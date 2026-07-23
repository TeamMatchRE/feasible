import { notFound } from "next/navigation";
import Link from "next/link";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { loadDesign } from "@/lib/queries";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function fmt(n: number | null, suffix = ""): string {
  return n == null ? "—" : `${Math.round(n).toLocaleString()}${suffix}`;
}

export default async function DesignPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const design = await loadDesign(id, user.id);
  if (!design) notFound();

  // Signed URL for re-viewing the stored plan (private bucket, user's own file).
  let planUrl: string | null = null;
  if (design.storage_path) {
    const supabase = await createClient();
    const { data } = await supabase.storage.from("feasible-designs").createSignedUrl(design.storage_path, 3600);
    planUrl = data?.signedUrl ?? null;
  }

  const specs: [string, string][] = [
    ["Style", design.model_type ?? "—"],
    ["Living area", fmt(design.living_area_sf, " sf")],
    ["Bedrooms", design.bedrooms != null ? String(design.bedrooms) : "—"],
    ["Bathrooms", design.bathrooms != null ? String(design.bathrooms) : "—"],
    ["Footprint", design.footprint_width_ft && design.footprint_depth_ft ? `${fmt(design.footprint_width_ft)} × ${fmt(design.footprint_depth_ft)} ft` : "—"],
  ];

  return (
    <Shell crumb={<Link href="/designs" className="hover:text-ink">Designs</Link>}>
      <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
        <h1 className="font-display text-3xl tracking-tight text-ink">{design.name}</h1>
        {planUrl ? (
          <a href={planUrl} target="_blank" rel="noopener noreferrer" className="rounded-md border border-line bg-white px-3 py-1.5 text-sm text-ink transition hover:border-gold">
            View plan
          </a>
        ) : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-[300px_1fr]">
        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="font-display text-lg text-ink">Specs</h2>
          <dl className="mt-3 space-y-2 text-sm">
            {specs.map(([k, v]) => (
              <div key={k} className="flex justify-between gap-2">
                <dt className="text-muted">{k}</dt>
                <dd className="text-ink">{v}</dd>
              </div>
            ))}
          </dl>
        </section>

        <section className="rounded-lg border border-line bg-white p-4">
          <h2 className="font-display text-lg text-ink">Takeoff</h2>
          <p className="mt-1 text-xs italic text-muted/80">AI estimate from the plans — verify before relying on it.</p>
          {design.takeoff.length === 0 ? (
            <p className="mt-3 text-sm text-muted">No takeoff items.</p>
          ) : (
            <table className="mt-3 w-full text-sm">
              <thead>
                <tr className="border-b border-line text-left text-xs text-muted">
                  <th className="py-1 pr-2">Category</th>
                  <th className="py-1 pr-2">Description</th>
                  <th className="py-1 pr-2 text-right">Quantity</th>
                </tr>
              </thead>
              <tbody>
                {design.takeoff.map((t, i) => {
                  const isRoof = /roof/i.test(t.category);
                  const qty =
                    isRoof && t.unit === "SF"
                      ? `${(t.quantity / 100).toFixed(1)} SQ (${Math.round(t.quantity).toLocaleString()} SF)`
                      : `${Math.round(t.quantity).toLocaleString()} ${t.unit}`;
                  return (
                    <tr key={i} className="border-b border-line/50">
                      <td className="py-1 pr-2 text-ink">{t.category}</td>
                      <td className="py-1 pr-2 text-muted">{t.description ?? ""}</td>
                      <td className="num py-1 pr-2 text-right text-ink">{qty}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          )}
        </section>
      </div>
    </Shell>
  );
}
