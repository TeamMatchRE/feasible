"use client";

import type { LineBasis, LineDetail, ProformaLine } from "@/lib/multifamily";

/**
 * The drill-down on a proforma line.
 *
 * A line is an ESTIMATE until you open it and itemize. Once itemized, the
 * sub-lines sum and that sum replaces the estimate — but the estimate stays on
 * screen, because the useful moment is seeing that the standardized $900/unit was
 * $90,000 and the real quotes come to $111,700. Toggling back to Estimate keeps
 * the items around, so you can flip between the two readings without retyping.
 */

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const numOr = (s: string, fallback = 0) => {
  const n = Number(String(s).replace(/[$,%\s]/g, ""));
  return Number.isFinite(n) ? n : fallback;
};

const BASIS_LABEL: Record<LineBasis, string> = {
  amount: "$",
  per_unit: "$ / unit",
  per_sf: "$ / SF",
  pct_egi: "% of EGI",
};

export type LineContext = { units: number; netSqft: number; egiTotal: number };

/** What one sub-line contributes, so each row shows its own arithmetic. */
function itemAmount(basis: LineBasis, value: number, ctx: LineContext): number {
  switch (basis) {
    case "per_unit": return value * ctx.units;
    case "per_sf": return value * ctx.netSqft;
    case "pct_egi": return value * ctx.egiTotal;
    default: return value;
  }
}

export function LineDetailEditor({
  line, detail, ctx, negate, allowPctEgi, onChange, onClose,
}: {
  line: ProformaLine;
  detail: LineDetail | undefined;
  ctx: LineContext;
  /** Expenses read as negatives in the proforma; the editor stays in positives. */
  negate: boolean;
  /** Income resolves before EGI exists, so % of EGI isn't offered there. */
  allowPctEgi: boolean;
  onChange: (next: LineDetail | undefined) => void;
  onClose: () => void;
}) {
  const d: LineDetail = detail ?? { mode: "estimate", items: [] };
  const items = d.items ?? [];
  const patch = (next: Partial<LineDetail>) => onChange({ ...d, ...next });

  const setItem = (i: number, p: Partial<LineDetail["items"][number]>) =>
    patch({ items: items.map((it, idx) => (idx === i ? { ...it, ...p } : it)) });
  const addItem = () => patch({ mode: "itemized", items: [...items, { label: "", basis: "amount", value: 0 }] });
  const removeItem = (i: number) => patch({ items: items.filter((_, idx) => idx !== i) });

  const itemized = items.reduce((s, it) => s + itemAmount(it.basis, it.value, ctx), 0);
  const active = d.mode === "itemized" && items.length > 0;
  const sign = negate ? -1 : 1;
  const delta = itemized - line.estimated;

  const bases: LineBasis[] = allowPctEgi
    ? ["amount", "per_unit", "per_sf", "pct_egi"]
    : ["amount", "per_unit", "per_sf"];

  return (
    <div className="rounded border border-ink/25 bg-black/[0.02] p-3">
      <div className="flex items-baseline justify-between gap-2">
        <p className="text-sm font-semibold text-ink">{line.label}</p>
        <button type="button" onClick={onClose} className="text-xs text-muted hover:text-ink">
          Close
        </button>
      </div>

      {/* Which number the proforma should use. */}
      <div className="mt-2 flex flex-wrap gap-4 text-xs">
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={d.mode !== "itemized"}
            onChange={() => patch({ mode: "estimate" })}
          />
          <span>
            Estimate <span className="text-muted">{money(sign * line.estimated)}</span>
          </span>
        </label>
        <label className="flex items-center gap-1.5">
          <input
            type="radio"
            checked={d.mode === "itemized"}
            onChange={() => patch({ mode: "itemized" })}
          />
          <span>
            Itemized{" "}
            <span className="text-muted">{items.length ? money(sign * itemized) : "— add a line"}</span>
          </span>
        </label>
      </div>

      <table className="mt-3 w-full text-sm">
        <tbody>
          {items.map((it, i) => (
            <tr key={i} className="border-b border-line/50">
              <td className="py-1 pr-2">
                <input
                  className="w-full rounded border border-line px-2 py-1 text-sm"
                  placeholder="Description"
                  value={it.label}
                  onChange={(e) => setItem(i, { label: e.target.value })}
                />
              </td>
              <td className="py-1 pr-2">
                <select
                  className="rounded border border-line px-1 py-1 text-xs"
                  value={it.basis}
                  onChange={(e) => setItem(i, { basis: e.target.value as LineBasis })}
                >
                  {bases.map((b) => (
                    <option key={b} value={b}>
                      {BASIS_LABEL[b]}
                    </option>
                  ))}
                </select>
              </td>
              <td className="py-1 pr-2 text-right">
                <input
                  className="w-24 rounded border border-line px-2 py-1 text-right text-sm"
                  inputMode="decimal"
                  value={String(it.value)}
                  onChange={(e) => setItem(i, { value: numOr(e.target.value) })}
                />
              </td>
              <td className="py-1 text-right text-xs text-muted">
                {it.basis === "amount" ? "" : money(sign * itemAmount(it.basis, it.value, ctx))}
              </td>
              <td className="py-1 pl-2 text-right">
                <button type="button" onClick={() => removeItem(i)} className="text-xs text-muted hover:text-ink">
                  ×
                </button>
              </td>
            </tr>
          ))}
          {items.length > 0 && (
            <tr className="font-medium">
              <td className="py-1.5" colSpan={3}>
                Total
              </td>
              <td className="py-1.5 text-right" colSpan={2}>
                {money(sign * itemized)}
              </td>
            </tr>
          )}
        </tbody>
      </table>

      <div className="mt-2 flex flex-wrap items-center gap-3">
        <button
          type="button"
          onClick={addItem}
          className="rounded border border-line px-2 py-1 text-xs hover:bg-black/[0.03]"
        >
          + Add line
        </button>
        {active && (
          <span className="text-xs text-muted">
            {ctx.units > 0 && <>{money((sign * itemized) / ctx.units)} / unit · </>}
            {delta === 0 ? (
              "same as the estimate"
            ) : (
              <>
                {money(Math.abs(delta))} {delta > 0 ? "above" : "below"} the estimate
              </>
            )}
          </span>
        )}
        {items.length > 0 && (
          <button
            type="button"
            onClick={() => onChange(undefined)}
            className="ml-auto text-xs text-muted hover:text-ink"
          >
            Clear detail
          </button>
        )}
      </div>

      <label className="mt-3 block text-xs">
        <span className="block uppercase tracking-wide text-muted">Backup / source</span>
        <textarea
          className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
          rows={2}
          placeholder="Where these figures came from — a quote, an assessor's card, a signed agreement."
          value={d.note ?? ""}
          onChange={(e) => patch({ note: e.target.value })}
        />
      </label>
    </div>
  );
}
