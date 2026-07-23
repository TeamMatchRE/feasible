"use client";

import { useState, useRef } from "react";
import { useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/browser";
import { analyze, createDesign, type DesignAnalysis } from "./actions";

const UNITS = ["EA", "LF", "SF", "SY", "CY", "TON", "GAL", "LS", "HR"] as const;

type Meta = DesignAnalysis["meta"];
type Row = { category: string; description: string | null; quantity: number; unit: string; confidence?: string | null };

function readB64(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result).split(",")[1] ?? "");
    r.onerror = () => reject(new Error("Could not read the file."));
    r.readAsDataURL(file);
  });
}

export default function NewDesign({ ownerId }: { ownerId: string }) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [name, setName] = useState("");
  const [meta, setMeta] = useState<Meta | null>(null);
  const [rows, setRows] = useState<Row[]>([]);
  const [busy, setBusy] = useState<"analyze" | "save" | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);

  function pickFiles(list: FileList | null) {
    if (!list) return;
    const arr = Array.from(list);
    const tooBig = arr.find((f) => f.size > 16 * 1024 * 1024);
    if (tooBig) {
      setErr(`"${tooBig.name}" is over 16 MB — upload the key sheets (floor plans + elevations), not the full set.`);
      return;
    }
    setErr(null);
    setFiles(arr);
    if (!name && arr[0]) setName(arr[0].name.replace(/\.[^.]+$/, ""));
  }

  async function onAnalyze() {
    if (files.length === 0) return;
    setBusy("analyze");
    setErr(null);
    setNote(null);
    try {
      const payload = await Promise.all(files.map(async (f) => ({ b64: await readB64(f), mediaType: f.type })));
      const res = await analyze(payload);
      setBusy(null);
      if (!res.ok || !res.analysis) {
        setErr(res.error ?? "Could not analyze the plans.");
        return;
      }
      setMeta(res.analysis.meta);
      setRows(res.analysis.takeoff.map((t) => ({ ...t })));
      setNote(
        `Reviewed by AI — check the numbers before saving.${res.analysis.meta.confidence ? ` Overall confidence: ${res.analysis.meta.confidence}.` : ""}${
          res.analysis.meta.notes ? ` ${res.analysis.meta.notes}` : ""
        }`,
      );
    } catch (e) {
      setBusy(null);
      setErr(e instanceof Error ? e.message : "Analysis failed.");
    }
  }

  async function onSave() {
    if (!meta) return;
    if (!name.trim()) {
      setErr("Give the design a name.");
      return;
    }
    setBusy("save");
    setErr(null);
    try {
      // Store the first (representative) plan file under the user's folder.
      let storagePath: string | null = null;
      let fileKind: "pdf" | "image" | null = null;
      const primary = files[0];
      if (primary) {
        const ext = primary.name.split(".").pop() || "bin";
        const path = `${ownerId}/${crypto.randomUUID()}.${ext}`;
        const supabase = createClient();
        const { error } = await supabase.storage.from("feasible-designs").upload(path, primary, { contentType: primary.type });
        if (error) throw new Error(`Upload failed: ${error.message}`);
        storagePath = path;
        fileKind = primary.type === "application/pdf" ? "pdf" : "image";
      }
      const res = await createDesign({
        name: name.trim(),
        meta,
        takeoff: rows.map((r) => ({ category: r.category, description: r.description, quantity: r.quantity, unit: r.unit })),
        storagePath,
        fileKind,
        parsedMeta: { meta, itemCount: rows.length },
      });
      setBusy(null);
      if (!res.ok || !res.id) {
        setErr(res.error ?? "Could not save.");
        return;
      }
      router.push(`/designs/${res.id}`);
    } catch (e) {
      setBusy(null);
      setErr(e instanceof Error ? e.message : "Save failed.");
    }
  }

  const num = (v: number | null) => (v == null ? "" : String(v));
  const setM = (k: keyof Meta, v: string | number | null) => setMeta((m) => (m ? { ...m, [k]: v } : m));

  return (
    <div className="rounded-lg border border-line bg-parchment/50 p-5">
      {/* Upload */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept="application/pdf,image/*"
          multiple
          className="hidden"
          onChange={(e) => pickFiles(e.target.files)}
        />
        <button
          onClick={() => fileRef.current?.click()}
          className="rounded-md border border-line bg-white px-3 py-2 text-sm text-ink transition hover:border-gold"
        >
          Choose plan file(s)
        </button>
        <span className="text-xs text-muted">
          {files.length ? files.map((f) => f.name).join(", ") : "PDF or images — floor plans, elevations, roof plan."}
        </span>
        <button
          onClick={() => void onAnalyze()}
          disabled={files.length === 0 || busy !== null}
          className="ml-auto rounded-md bg-ink px-4 py-2 text-sm font-medium text-parchment transition hover:bg-ink-soft disabled:opacity-50"
        >
          {busy === "analyze" ? "Reading plans…" : "Analyze with AI"}
        </button>
      </div>
      {err ? <p className="mt-2 text-xs text-fail">{err}</p> : null}
      {note ? <p className="mt-2 text-xs text-gold-deep">{note}</p> : null}

      {/* Review */}
      {meta ? (
        <div className="mt-5 border-t border-line pt-5">
          <label className="block">
            <span className="mb-1 block text-xs font-medium uppercase tracking-wide text-muted">Design name</span>
            <input
              value={name}
              onChange={(e) => setName(e.target.value)}
              className="w-full rounded-md border border-line bg-white px-3 py-2 text-sm text-ink outline-none focus:border-gold"
            />
          </label>

          <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
            {(
              [
                ["Style", "model_type", "text"],
                ["Living area (sf)", "living_area_sf", "number"],
                ["Stories", "stories", "number"],
                ["Bedrooms", "bedrooms", "number"],
                ["Bathrooms", "bathrooms", "number"],
                ["Footprint W (ft)", "footprint_width_ft", "number"],
                ["Footprint D (ft)", "footprint_depth_ft", "number"],
              ] as const
            ).map(([label, key, type]) => (
              <label key={key} className="flex flex-col gap-1 text-xs text-muted">
                {label}
                <input
                  type={type}
                  value={type === "number" ? num(meta[key] as number | null) : ((meta[key] as string | null) ?? "")}
                  onChange={(e) => setM(key, type === "number" ? (e.target.value === "" ? null : Number(e.target.value)) : e.target.value)}
                  className="rounded border border-line bg-white px-2 py-1 text-sm text-ink"
                />
              </label>
            ))}
          </div>

          {/* Takeoff */}
          <div className="mt-5">
            <div className="flex items-center justify-between">
              <h3 className="font-display text-lg text-ink">Takeoff</h3>
              <button
                onClick={() => setRows((r) => [...r, { category: "", description: "", quantity: 0, unit: "EA" }])}
                className="text-xs text-gold-deep hover:underline"
              >
                + Add line
              </button>
            </div>
            <div className="mt-2 overflow-x-auto">
              <table className="w-full min-w-[560px] text-sm">
                <thead>
                  <tr className="border-b border-line text-left text-xs text-muted">
                    <th className="py-1 pr-2">Category</th>
                    <th className="py-1 pr-2">Description</th>
                    <th className="py-1 pr-2 text-right">Qty</th>
                    <th className="py-1 pr-2">Unit</th>
                    <th className="py-1" />
                  </tr>
                </thead>
                <tbody>
                  {rows.map((r, i) => (
                    <tr key={i} className="border-b border-line/50">
                      <td className="py-1 pr-2">
                        <input value={r.category} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, category: e.target.value } : x)))} className="w-full rounded border border-line bg-white px-1.5 py-0.5 text-ink" />
                      </td>
                      <td className="py-1 pr-2">
                        <input value={r.description ?? ""} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, description: e.target.value } : x)))} className="w-full rounded border border-line bg-white px-1.5 py-0.5 text-ink" />
                      </td>
                      <td className="py-1 pr-2">
                        <input type="number" value={r.quantity} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, quantity: Number(e.target.value) } : x)))} className="w-20 rounded border border-line bg-white px-1.5 py-0.5 text-right text-ink" />
                      </td>
                      <td className="py-1 pr-2">
                        <select value={r.unit} onChange={(e) => setRows((rs) => rs.map((x, j) => (j === i ? { ...x, unit: e.target.value } : x)))} className="rounded border border-line bg-white px-1 py-0.5 text-ink">
                          {UNITS.map((u) => (
                            <option key={u} value={u}>{u}</option>
                          ))}
                        </select>
                      </td>
                      <td className="py-1 text-right">
                        <button onClick={() => setRows((rs) => rs.filter((_, j) => j !== i))} className="text-xs text-muted hover:text-fail">✕</button>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
            {rows.some((r) => /roof/i.test(r.category)) ? (
              <p className="mt-1 text-xs text-muted">Roofing is in SF; 1 square = 100 SF.</p>
            ) : null}
          </div>

          <div className="mt-4 flex items-center gap-3">
            <button
              onClick={() => void onSave()}
              disabled={busy !== null}
              className="rounded-md bg-ink px-4 py-2 text-sm font-medium text-parchment transition hover:bg-ink-soft disabled:opacity-50"
            >
              {busy === "save" ? "Saving…" : "Save design"}
            </button>
            <button onClick={() => { setMeta(null); setRows([]); setNote(null); }} className="text-sm text-muted hover:text-ink">
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
