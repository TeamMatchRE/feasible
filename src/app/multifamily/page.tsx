import Link from "next/link";
import Shell from "@/components/Shell";
import { SubmitButton } from "@/components/SubmitButton";
import { requireUser } from "@/lib/session";
import { listMfDeals } from "@/lib/mf-queries";
import { createDeal } from "./actions";

export const dynamic = "force-dynamic";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

export default async function MultiFamilyPage() {
  const user = await requireUser();
  const deals = await listMfDeals(user.id);

  return (
    <Shell>
      <div className="mb-6">
        <h1 className="font-display text-3xl tracking-tight text-ink">Multi-family</h1>
        <p className="mt-1 max-w-3xl text-sm text-muted">
          Underwriting for large multi-family: unit mix, commercial space, other income and operating
          expenses down to NOI — then the question that decides the deal, <strong>build to rent</strong>,{" "}
          <strong>sell out</strong>, or a blend of both, measured off one cost basis.
        </p>
      </div>

      <form action={createDeal} className="mb-8 flex flex-wrap items-end gap-3 rounded-lg border border-line bg-white p-4">
        <label className="text-sm">
          <span className="block text-xs uppercase tracking-wide text-muted">Deal name</span>
          <input
            name="name"
            required
            placeholder="26 W. Main St. — 130 units"
            className="mt-1 w-72 rounded border border-line px-2 py-1.5 text-sm"
          />
        </label>
        <label className="text-sm">
          <span className="block text-xs uppercase tracking-wide text-muted">City</span>
          <input name="city" placeholder="Avon, CT" className="mt-1 w-48 rounded border border-line px-2 py-1.5 text-sm" />
        </label>
        <SubmitButton className="rounded bg-ink px-3 py-1.5 text-sm text-white hover:bg-ink/90">
          New deal
        </SubmitButton>
      </form>

      {deals.length === 0 ? (
        <p className="rounded-lg border border-line bg-white p-6 text-sm text-muted">
          No deals yet. Name one above to start — it opens with a full institutional assumption set you can edit.
        </p>
      ) : (
        <div className="overflow-x-auto rounded-lg border border-line bg-white">
          <table className="w-full text-sm">
            <thead className="border-b border-line bg-black/[0.02] text-left text-xs uppercase tracking-wide text-muted">
              <tr>
                <th className="p-3 font-medium">Deal</th>
                <th className="p-3 font-medium">City</th>
                <th className="p-3 text-right font-medium">Units</th>
                <th className="p-3 text-right font-medium">Project cost</th>
                <th className="p-3 text-right font-medium">Updated</th>
              </tr>
            </thead>
            <tbody>
              {deals.map((d) => (
                <tr key={d.id} className="border-b border-line/60 last:border-0">
                  <td className="p-3">
                    <Link href={`/multifamily/${d.id}`} className="font-medium text-ink underline-offset-2 hover:underline">
                      {d.name}
                    </Link>
                  </td>
                  <td className="p-3 text-muted">{d.city ?? "—"}</td>
                  <td className="p-3 text-right text-muted">{d.units}</td>
                  <td className="p-3 text-right text-muted">
                    {Number(d.total_project_cost) > 0 ? money(Number(d.total_project_cost)) : "—"}
                  </td>
                  <td className="p-3 text-right text-muted">{new Date(d.updated_at).toLocaleDateString()}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </Shell>
  );
}
