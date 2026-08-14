"use client";

import { useState } from "react";
import { saveLot, addLot } from "../../capital-actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { LotRow } from "@/lib/hpd-queries";

/**
 * The Enclave's two products. Picking a style fills the list price, because the
 * price is a property of the style — but the field stays editable, since a lot
 * with a premium position doesn't have to sell at the sheet price.
 *
 * Nothing here assumes WHICH lot is which style; that was never stated, so every
 * lot starts blank and a human assigns it.
 */
const STYLES: { name: string; price: number }[] = [
  { name: "Ranch", price: 699_900 },
  { name: "Cape", price: 769_900 },
];

const money = (n: number | null) => (n == null || n === 0 ? "—" : `$${Math.round(n).toLocaleString("en-US")}`);

const STATUS_LABEL: Record<LotRow["status"], string> = {
  available: "Available",
  reserved: "Reserved",
  under_contract: "Under contract",
  closed: "Closed",
  held: "Held",
};

export default function LotRowEditor({
  projectId,
  lot,
  editable,
}: {
  projectId: string;
  lot: LotRow;
  editable: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [price, setPrice] = useState(lot.list_price ?? 0);

  if (!open) {
    return (
      <tr className="border-b border-line/60 last:border-0">
        <td className="p-3 font-medium text-ink">{lot.lot_number}</td>
        <td className="p-3 text-muted">{lot.style ?? <span className="text-red-600">not set</span>}</td>
        <td className="p-3 text-right text-ink">{money(lot.list_price)}</td>
        <td className="p-3 text-right text-ink">{money(lot.sale_price)}</td>
        <td className="p-3 text-xs text-muted">{STATUS_LABEL[lot.status]}</td>
        <td className="p-3 text-xs text-muted">{lot.buyer_name ?? "—"}</td>
        <td className="p-3 text-xs text-muted">{lot.projected_closing ?? "—"}</td>
        <td className="p-3 text-xs text-muted">{lot.actual_closing ?? "—"}</td>
        {editable && (
          <td className="p-3 text-right">
            <button type="button" onClick={() => setOpen(true)} className="text-xs text-muted hover:text-ink">
              Edit
            </button>
          </td>
        )}
      </tr>
    );
  }

  const field = "mt-1 w-full rounded border border-line px-2 py-1 text-sm";
  const label = "block text-[11px] uppercase tracking-wide text-muted";

  return (
    <tr className="border-b border-line/60 last:border-0">
      <td colSpan={9} className="p-3">
        <form action={saveLot} onSubmit={() => setOpen(false)} className="space-y-3">
          <input type="hidden" name="projectId" value={projectId} />
          <input type="hidden" name="lotId" value={lot.id} />

          <div className="flex flex-wrap items-baseline gap-3">
            <span className="font-medium text-ink">{lot.lot_number}</span>
            <span className="text-xs text-muted">
              Choosing a style fills the list price; you can still override it.
            </span>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">
              <span className={label}>Style</span>
              <select
                name="style"
                defaultValue={lot.style ?? ""}
                onChange={(e) => {
                  const s = STYLES.find((x) => x.name === e.target.value);
                  if (s) setPrice(s.price);
                }}
                className={field}
              >
                <option value="">— not set —</option>
                {STYLES.map((s) => (
                  <option key={s.name} value={s.name}>
                    {s.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-xs">
              <span className={label}>List price</span>
              <input
                name="list_price"
                inputMode="numeric"
                value={price === 0 ? "" : String(price)}
                onChange={(e) => setPrice(Number(e.target.value.replace(/[$,\s]/g, "")) || 0)}
                className={field}
              />
            </label>
            <label className="text-xs">
              <span className={label}>Sale price</span>
              <input
                name="sale_price"
                inputMode="numeric"
                defaultValue={lot.sale_price == null ? "" : String(lot.sale_price)}
                placeholder="once under contract"
                className={field}
              />
            </label>
            <label className="text-xs">
              <span className={label}>Status</span>
              <select name="status" defaultValue={lot.status} className={field}>
                {(Object.keys(STATUS_LABEL) as LotRow["status"][]).map((s) => (
                  <option key={s} value={s}>
                    {STATUS_LABEL[s]}
                  </option>
                ))}
              </select>
            </label>
          </div>

          <div className="grid gap-3 sm:grid-cols-4">
            <label className="text-xs">
              <span className={label}>Buyer</span>
              <input name="buyer_name" defaultValue={lot.buyer_name ?? ""} className={field} />
            </label>
            <label className="text-xs">
              <span className={label}>Contract date</span>
              <input name="contract_date" type="date" defaultValue={lot.contract_date ?? ""} className={field} />
            </label>
            <label className="text-xs">
              <span className={label}>Projected closing</span>
              <input
                name="projected_closing"
                type="date"
                defaultValue={lot.projected_closing ?? ""}
                className={field}
              />
            </label>
            <label className="text-xs">
              <span className={label}>Actual closing</span>
              <input
                name="actual_closing"
                type="date"
                defaultValue={lot.actual_closing ?? ""}
                className={field}
              />
              <span className="mt-0.5 block text-[10px] text-muted">set this and it stops being a forecast</span>
            </label>
          </div>

          <div className="flex items-center gap-3">
            <SubmitButton className="rounded bg-ink px-3 py-1.5 text-xs text-white">Save lot</SubmitButton>
            <button type="button" onClick={() => setOpen(false)} className="text-xs text-muted hover:text-ink">
              Cancel
            </button>
          </div>
        </form>
      </td>
    </tr>
  );
}

export function AddLotButton({ projectId }: { projectId: string }) {
  return (
    <form action={addLot}>
      <input type="hidden" name="projectId" value={projectId} />
      <SubmitButton className="rounded border border-line px-3 py-1.5 text-sm text-ink hover:bg-line/30">
        + Add a lot
      </SubmitButton>
    </form>
  );
}
