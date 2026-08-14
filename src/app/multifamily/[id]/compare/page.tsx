import Link from "next/link";
import { notFound } from "next/navigation";
import Shell from "@/components/Shell";
import { requireUser } from "@/lib/session";
import { dealRole, canRead } from "@/lib/mf-access";
import { loadAllScenarios } from "@/lib/mf-scenarios";
import { scenarioMetrics, assumptionDiff, fmt, type ScenarioMetrics } from "@/lib/mf-compare";
import { sql } from "@/db";

export const dynamic = "force-dynamic";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const pct = (n: number, dp = 1) => `${(n * 100).toFixed(dp)}%`;
const num = (n: number) => Math.round(n).toLocaleString("en-US");

/**
 * SCENARIO COMPARISON.
 *
 * Every metric is recomputed from stored inputs (see src/lib/mf-compare.ts), so
 * this page and the deal page can never disagree.
 *
 * The best column is highlighted on profit alone, and only when the scenarios
 * are actually comparable. Two cases with different unit counts are different
 * projects, not a better and worse version of one — so the units row is always
 * shown, right under the money.
 */
export default async function ComparePage({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const role = await dealRole(user, id);
  if (!canRead(role)) notFound();

  const [deal] = await sql<{ name: string; city: string | null }[]>`
    select name, city from feasible.mf_deals where id = ${id}`;
  if (!deal) notFound();

  const scenarios = await loadAllScenarios(id);
  const metrics = scenarios.map(scenarioMetrics);
  const diff = assumptionDiff(scenarios);

  // Highlight the most profitable case. With one scenario there is nothing to win.
  const bestProfit = metrics.length > 1 ? Math.max(...metrics.map((m) => m.profit)) : null;
  const isBest = (m: ScenarioMetrics) => bestProfit != null && m.profit === bestProfit;

  const Row = ({
    label, pick, hint, strong = false,
  }: {
    label: string;
    pick: (m: ScenarioMetrics) => string;
    hint?: string;
    strong?: boolean;
  }) => (
    <tr className="border-b border-line/50">
      <td className={`py-1.5 pr-4 ${strong ? "font-medium text-ink" : "text-muted"}`}>
        {label}
        {hint && <span className="ml-2 text-[11px] text-muted/70">{hint}</span>}
      </td>
      {metrics.map((m) => (
        <td
          key={m.id}
          className={`py-1.5 pl-4 text-right ${strong ? "font-semibold" : ""} ${
            isBest(m) && strong ? "text-ink" : "text-ink"
          }`}
        >
          {pick(m)}
        </td>
      ))}
    </tr>
  );

  const SectionRow = ({ title }: { title: string }) => (
    <tr>
      <td
        colSpan={metrics.length + 1}
        className="pb-1 pt-5 text-xs uppercase tracking-wide text-muted"
      >
        {title}
      </td>
    </tr>
  );

  return (
    <Shell>
      <div className="mb-5">
        <Link
          href={`/multifamily/${id}`}
          className="text-xs uppercase tracking-wide text-muted hover:text-ink"
        >
          ← {deal.name}
        </Link>
        <h1 className="mt-1 font-display text-3xl tracking-tight text-ink">Compare scenarios</h1>
        <p className="mt-1 text-sm text-muted">
          {scenarios.length === 1
            ? "Only one scenario so far. Duplicate it on the deal page to start comparing."
            : `${scenarios.length} cases, each recomputed from its own inputs.`}
        </p>
      </div>

      <div className="overflow-x-auto rounded-lg border border-line bg-white p-4">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line">
              <th className="pb-2 pr-4 text-left text-xs uppercase tracking-wide text-muted">
                Metric
              </th>
              {metrics.map((m) => (
                <th key={m.id} className="pb-2 pl-4 text-right">
                  <span className="block text-ink">{m.name}</span>
                  {isBest(m) && (
                    <span className="mt-0.5 inline-block rounded-full bg-ink px-2 py-0.5 text-[10px] font-semibold text-white">
                      most profit
                    </span>
                  )}
                  {m.note && (
                    <span className="mt-0.5 block text-[11px] font-normal text-muted">{m.note}</span>
                  )}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            <SectionRow title="The bottom line" />
            <Row label="Profit" strong pick={(m) => money(m.profit)} />
            <Row label="Margin" pick={(m) => pct(m.profitMargin)} />
            <Row label="Total value" pick={(m) => money(m.totalValue)} />
            <Row label="Plan" pick={(m) => (m.designated ? "Designated" : m.best)} />
            <Row
              label="Units"
              hint="different counts = different projects"
              pick={(m) => (m.designated ? `${m.unitsSold} sold / ${m.unitsHeld} held` : num(m.totalUnits))}
            />
            <Row
              label="Sold portion"
              pick={(m) => (m.designated ? money(m.soldNet) : "—")}
            />
            <Row
              label="Held portion"
              pick={(m) => (m.designated ? money(m.heldValue) : "—")}
            />

            <SectionRow title="Cost basis" />
            <Row label="Total development cost" strong pick={(m) => money(m.totalCost)} />
            <Row label="Per unit" pick={(m) => money(m.costPerUnit)} />
            <Row label="Per net SF" pick={(m) => money(m.costPerNetSqft)} />
            <Row label="Hard cost" pick={(m) => money(m.hardCost)} />

            <SectionRow title="Income & yield" />
            <Row label="NOI" strong pick={(m) => money(m.noi)} />
            <Row label="EGI" pick={(m) => money(m.egi)} />
            <Row label="Expense ratio" pick={(m) => pct(m.expenseRatio)} />
            <Row label="Yield on cost" pick={(m) => pct(m.yieldOnCost, 2)} />
            <Row
              label="Development spread"
              hint="bps over the exit cap"
              pick={(m) => `${m.developmentSpreadBps} bps`}
            />
            <Row label="Net rentable SF" pick={(m) => num(m.netSqft)} />
          </tbody>
        </table>
      </div>

      {/* ---- Why they differ ---- */}
      <div className="mt-5 rounded-lg border border-line bg-white p-4">
        <h2 className="text-sm font-semibold text-ink">What actually differs</h2>
        <p className="mt-0.5 text-xs text-muted">
          Only the inputs that aren&rsquo;t the same across every scenario. Anything identical
          everywhere is left out — a list of ninety unchanged assumptions hides the three that moved.
        </p>

        {scenarios.length < 2 ? (
          <p className="mt-3 text-sm text-muted">Nothing to compare against yet.</p>
        ) : diff.length === 0 ? (
          <p className="mt-3 text-sm text-muted">
            These scenarios have identical inputs — they were duplicated but not yet changed.
          </p>
        ) : (
          <div className="mt-3 overflow-x-auto">
            <table className="w-full min-w-[640px] text-sm">
              <thead>
                <tr className="border-b border-line text-xs uppercase tracking-wide text-muted">
                  <th className="pb-2 pr-4 text-left font-medium">Input</th>
                  {scenarios.map((s) => (
                    <th key={s.id} className="pb-2 pl-4 text-right font-medium">
                      {s.name}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {diff.map((r) => (
                  <tr key={r.label} className="border-b border-line/50">
                    <td className="py-1.5 pr-4 text-muted">{r.label}</td>
                    {r.values.map((v, i) => (
                      <td key={i} className="py-1.5 pl-4 text-right text-ink">
                        {fmt(v, r.kind)}
                      </td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>
    </Shell>
  );
}
