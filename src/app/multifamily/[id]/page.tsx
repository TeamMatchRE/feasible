import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { loadMfDeal, DEFAULT_ASSUMPTIONS } from "@/lib/mf-queries";
import Underwriter from "./Underwriter";
import CompsPanel from "./CompsPanel";

export const dynamic = "force-dynamic";

export default async function MfDealPage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const loaded = await loadMfDeal(user.id, id);
  if (!loaded) notFound();
  const { deal, units, comps } = loaded;

  // postgres-js returns numerics as strings; normalize once here so the client
  // component never has to wonder which fields are numbers.
  const initial = {
    id: deal.id,
    name: deal.name,
    address: deal.address ?? "",
    city: deal.city ?? "",
    state: deal.state ?? "CT",
    grossSqft: Number(deal.gross_sqft ?? 0),
    commercialSqft: Number(deal.commercial_sqft ?? 0),
    heightStories: Number(deal.height_stories ?? 0),
    garageSpaces: Number(deal.garage_spaces ?? 0),
    surfaceSpaces: Number(deal.surface_spaces ?? 0),
    storageSpaces: Number(deal.storage_spaces ?? 0),
    totalProjectCost: Number(deal.total_project_cost ?? 0),
    notes: deal.notes ?? "",
    assumptions: { ...DEFAULT_ASSUMPTIONS, ...(deal.assumptions ?? {}) },
    // Already merged over DEFAULT_COST_PROGRAM in loadMfDeal, including the
    // fallback that keeps a pre-budget deal on its hand-typed total.
    costProgram: deal.cost_program,
    lineDetails: deal.line_details ?? {},
    units: units.map((u) => ({
      tier: u.tier,
      label: u.label,
      unit_count: Number(u.unit_count),
      rent_monthly: Number(u.rent_monthly),
      sqft: Number(u.sqft),
      sell_price: u.sell_price != null ? Number(u.sell_price) : null,
    })),
  };

  return (
    <Shell>
      <div className="mb-5 flex flex-wrap items-baseline justify-between gap-3">
        <div>
          <Link href="/multifamily" className="text-xs uppercase tracking-wide text-muted hover:text-ink">
            ← Multi-family
          </Link>
          <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">{deal.name}</h1>
          <p className="mt-1 text-sm text-muted">
            {[deal.address, deal.city, deal.state].filter(Boolean).join(", ") || "No address set"}
          </p>
        </div>
      </div>

      <Underwriter initial={initial} />

      <CompsPanel dealId={deal.id} comps={comps} />
    </Shell>
  );
}
