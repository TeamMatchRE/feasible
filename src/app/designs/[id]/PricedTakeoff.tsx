"use client";

import { useState } from "react";
import type { PricedLine, Tier } from "@/lib/costs";

const TIERS: Tier[] = ["Base", "Upgraded", "Superior"];
const money = (n: number) => `$${Math.round(n).toLocaleString()}`;

export default function PricedTakeoff({ lines }: { lines: PricedLine[] }) {
  // Per-line tier selection; a header control sets them all at once.
  const [tiers, setTiers] = useState<Tier[]>(lines.map(() => "Base"));

  const priced = lines.map((l, i) => {
    const rate = l.rates ? l.rates[tiers[i]] : null;
    return { ...l, tier: tiers[i], rate, ext: rate != null ? l.quantity * rate : null };
  });
  const total = priced.reduce((s, p) => s + (p.ext ?? 0), 0);
  const anyUnmatched = priced.some((p) => p.rates == null);

  return (
    <section className="rounded-lg border border-line bg-white p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h2 className="font-display text-lg text-ink">Takeoff &amp; cost</h2>
        <label className="flex items-center gap-2 text-xs text-muted">
          Set all to
          <select
            onChange={(e) => setTiers(lines.map(() => e.target.value as Tier))}
            className="rounded border border-line bg-white px-2 py-0.5 text-ink"
            defaultValue=""
          >
            <option value="" disabled>tier…</option>
            {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
          </select>
        </label>
      </div>
      <p className="mt-1 text-xs italic text-muted/80">
        AI-estimated quantities × your Construction Costs — advisory, verify before relying on it.
      </p>

      {lines.length === 0 ? (
        <p className="mt-3 text-sm text-muted">No takeoff items.</p>
      ) : (
        <table className="mt-3 w-full text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="py-1 pr-2">Category</th>
              <th className="py-1 pr-2 text-right">Qty</th>
              <th className="py-1 pr-2">Tier</th>
              <th className="py-1 pr-2 text-right">Unit $</th>
              <th className="py-1 pr-2 text-right">Extended</th>
            </tr>
          </thead>
          <tbody>
            {priced.map((p, i) => {
              const isRoof = /roof/i.test(p.category) && p.unit === "SF";
              const qty = isRoof ? `${(p.quantity / 100).toFixed(1)} SQ` : `${Math.round(p.quantity).toLocaleString()} ${p.unit}`;
              return (
                <tr key={i} className="border-b border-line/50">
                  <td className="py-1 pr-2 text-ink">
                    {p.category}
                    {p.description ? <span className="text-muted"> · {p.description}</span> : null}
                  </td>
                  <td className="num py-1 pr-2 text-right text-ink">{qty}</td>
                  <td className="py-1 pr-2">
                    {p.rates ? (
                      <select
                        value={p.tier}
                        onChange={(e) => setTiers((prev) => prev.map((t, j) => (j === i ? (e.target.value as Tier) : t)))}
                        className="rounded border border-line bg-white px-1 py-0.5 text-xs text-ink"
                      >
                        {TIERS.map((t) => <option key={t} value={t}>{t}</option>)}
                      </select>
                    ) : (
                      <span className="text-xs text-warn">no rate</span>
                    )}
                  </td>
                  <td className="num py-1 pr-2 text-right text-muted">{p.rate != null ? `$${p.rate}` : "—"}</td>
                  <td className="num py-1 pr-2 text-right text-ink">{p.ext != null ? money(p.ext) : "—"}</td>
                </tr>
              );
            })}
          </tbody>
          <tfoot>
            <tr>
              <td colSpan={4} className="py-2 pr-2 text-right font-medium text-ink">Total (matched lines)</td>
              <td className="num py-2 pr-2 text-right font-display text-lg text-ink">{money(total)}</td>
            </tr>
          </tfoot>
        </table>
      )}
      {anyUnmatched ? (
        <p className="mt-2 text-xs text-warn">
          Some lines have no matching cost component — add them in the Costs tab to include them.
        </p>
      ) : null}
    </section>
  );
}
