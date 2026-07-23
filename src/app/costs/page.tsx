import Shell from "@/components/Shell";
import CostGrid from "./CostGrid";
import { requireUser } from "@/lib/session";
import { seedCostsIfEmpty, loadCosts } from "@/lib/costs";

export const dynamic = "force-dynamic";

export default async function CostsPage() {
  const user = await requireUser();
  await seedCostsIfEmpty(user.id);
  const catalog = await loadCosts(user.id);

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="font-display text-3xl tracking-tight text-ink">Construction costs</h1>
        <p className="mt-1 text-sm text-muted">
          Baseline unit costs by quality tier. Seeded with illustrative numbers — edit them, or import
          your spreadsheet. These price out a design&rsquo;s takeoff.
        </p>
      </div>
      <CostGrid catalog={catalog} />
    </Shell>
  );
}
