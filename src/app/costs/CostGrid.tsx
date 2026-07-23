"use client";

import { useState } from "react";
import { saveRate, addComponent, removeComponent } from "./actions";
import type { CostCatalog, CostItem, Tier } from "@/lib/costs";

const UNITS = ["EA", "LF", "SF", "SY", "CY", "TON", "GAL", "LS", "HR"] as const;
const TIERS: Tier[] = ["Base", "Upgraded", "Superior"];

export default function CostGrid({ catalog }: { catalog: CostCatalog }) {
  const [items, setItems] = useState<CostItem[]>(catalog.items);
  const [msg, setMsg] = useState<string | null>(null);
  const profileId = (t: Tier) => catalog.profiles.find((p) => p.name === t)?.id ?? "";

  async function onRate(itemId: string, tier: Tier, raw: string) {
    const cost = raw.trim() === "" ? null : Number(raw);
    setItems((prev) => prev.map((it) => (it.id === itemId ? { ...it, rates: { ...it.rates, [tier]: cost } } : it)));
    const res = await saveRate(itemId, profileId(tier), cost);
    if (!res.ok) setMsg(res.error ?? "Save failed.");
  }

  async function onRemove(itemId: string) {
    setItems((prev) => prev.filter((it) => it.id !== itemId));
    await removeComponent(itemId);
  }

  // Group rows by category for display.
  const grouped = items.reduce<Record<string, CostItem[]>>((acc, it) => {
    (acc[it.category] ??= []).push(it);
    return acc;
  }, {});

  return (
    <div>
      {msg ? <p className="mb-2 text-xs text-fail">{msg}</p> : null}
      <div className="overflow-x-auto rounded-lg border border-line bg-white">
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="border-b border-line text-left text-xs text-muted">
              <th className="px-3 py-2">Component</th>
              <th className="px-3 py-2">Unit</th>
              {TIERS.map((t) => (
                <th key={t} className="px-3 py-2 text-right">{t}</th>
              ))}
              <th className="px-3 py-2" />
            </tr>
          </thead>
          <tbody>
            {Object.entries(grouped).map(([category, rows]) => (
              <FragmentGroup key={category} category={category} rows={rows} onRate={onRate} onRemove={onRemove} />
            ))}
          </tbody>
        </table>
      </div>
      <AddRow />
      <p className="mt-3 text-xs italic text-muted/80">
        Illustrative baseline (rough US residential) — edit to your real numbers. $ per the listed unit.
      </p>
    </div>
  );
}

function FragmentGroup({
  category,
  rows,
  onRate,
  onRemove,
}: {
  category: string;
  rows: CostItem[];
  onRate: (id: string, t: Tier, raw: string) => void;
  onRemove: (id: string) => void;
}) {
  return (
    <>
      <tr className="bg-parchment/40">
        <td colSpan={6} className="px-3 py-1 text-xs font-medium uppercase tracking-wide text-muted">{category}</td>
      </tr>
      {rows.map((it) => (
        <tr key={it.id} className="border-b border-line/50">
          <td className="px-3 py-1.5 text-ink">{it.name}</td>
          <td className="px-3 py-1.5 text-muted">{it.unit}</td>
          {TIERS.map((t) => (
            <td key={t} className="px-3 py-1.5 text-right">
              <span className="text-muted">$</span>
              <input
                type="number"
                defaultValue={it.rates[t] ?? ""}
                onBlur={(e) => onRate(it.id, t, e.target.value)}
                className="w-20 rounded border border-line px-1.5 py-0.5 text-right text-ink"
              />
            </td>
          ))}
          <td className="px-3 py-1.5 text-right">
            <button onClick={() => onRemove(it.id)} className="text-xs text-muted hover:text-fail">✕</button>
          </td>
        </tr>
      ))}
    </>
  );
}

function AddRow() {
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ category: "", name: "", unit: "EA", base: "", upgraded: "", superior: "" });
  const [busy, setBusy] = useState(false);

  if (!open) {
    return (
      <button onClick={() => setOpen(true)} className="mt-3 text-sm text-gold-deep hover:underline">
        + Add component
      </button>
    );
  }
  const n = (s: string) => (s.trim() === "" ? null : Number(s));
  return (
    <form
      action={async () => {
        setBusy(true);
        await addComponent({ category: f.category, name: f.name, unit: f.unit, base: n(f.base), upgraded: n(f.upgraded), superior: n(f.superior) });
        setBusy(false);
        setOpen(false);
        setF({ category: "", name: "", unit: "EA", base: "", upgraded: "", superior: "" });
      }}
      className="mt-3 flex flex-wrap items-end gap-2 rounded-lg border border-line bg-parchment/40 p-3 text-xs"
    >
      <label className="flex flex-col gap-1 text-muted">Category<input value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} className="rounded border border-line px-1.5 py-1 text-ink" /></label>
      <label className="flex flex-col gap-1 text-muted">Component<input value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} required className="rounded border border-line px-1.5 py-1 text-ink" /></label>
      <label className="flex flex-col gap-1 text-muted">Unit
        <select value={f.unit} onChange={(e) => setF({ ...f, unit: e.target.value })} className="rounded border border-line px-1 py-1 text-ink">
          {UNITS.map((u) => <option key={u}>{u}</option>)}
        </select>
      </label>
      {(["base", "upgraded", "superior"] as const).map((k) => (
        <label key={k} className="flex flex-col gap-1 text-muted capitalize">{k}<input type="number" value={f[k]} onChange={(e) => setF({ ...f, [k]: e.target.value })} className="w-20 rounded border border-line px-1.5 py-1 text-ink" /></label>
      ))}
      <button type="submit" disabled={busy} className="rounded-md bg-ink px-3 py-1.5 font-medium text-parchment disabled:opacity-50">{busy ? "Adding…" : "Add"}</button>
      <button type="button" onClick={() => setOpen(false)} className="text-muted hover:text-ink">Cancel</button>
    </form>
  );
}
