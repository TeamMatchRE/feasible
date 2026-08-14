"use client";

import { useState } from "react";
import Link from "next/link";
import { newScenario, switchScenario, updateScenario, removeScenario } from "../actions";
import { SubmitButton } from "@/components/SubmitButton";
import type { ScenarioSummary } from "@/lib/mf-scenarios";

/**
 * SCENARIO BAR — which case you are underwriting.
 *
 * Always visible and always naming the active scenario, because the most
 * expensive mistake this feature can cause is editing the wrong case for ten
 * minutes without noticing.
 *
 * Switching is a server action, not client state: a scenario is a different set
 * of rows, so the page reloads to show it — and unsaved edits are lost, which
 * the standing note below says out loud rather than trapping in a dialog.
 *
 * No native confirm()/prompt() anywhere here. They block the whole page, they
 * can't be styled, and a destructive step that reads as a two-click inline
 * question is clearer than a modal people dismiss by reflex.
 */
export default function ScenarioBar({
  dealId,
  scenarios,
  activeId,
  canEdit,
}: {
  dealId: string;
  scenarios: ScenarioSummary[];
  activeId: string;
  canEdit: boolean;
}) {
  const [mode, setMode] = useState<"idle" | "rename" | "new" | "confirmDelete">("idle");
  const active = scenarios.find((s) => s.id === activeId);

  /**
   * Close whatever panel is open as soon as its form is submitted.
   *
   * These are server actions: the page revalidates but this component keeps its
   * state, so an open panel survives the very action that finished it. For the
   * delete confirmation that is not just untidy — it re-arms itself against
   * whichever scenario is active NEXT, so a second reflexive click deletes a case
   * nobody asked to delete. Found by deleting a scenario and watching the prompt
   * re-point at the survivor.
   *
   * Called from onSubmit without preventDefault, so the action still fires.
   */
  const closePanel = () => setMode("idle");

  return (
    <div className="mb-4 rounded-lg border border-line bg-white px-4 py-3">
      <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
        <span className="text-xs uppercase tracking-wide text-muted">Scenario</span>

        {/* One small form per scenario. A <select> would need JS to submit; this
            keeps the control working as plain forms and stays keyboard-friendly. */}
        <div className="flex flex-wrap items-center gap-1.5">
          {scenarios.map((s) =>
            s.id === activeId ? (
              <span
                key={s.id}
                className="rounded-full bg-ink px-3 py-1 text-xs font-semibold text-white"
                title={s.note ?? undefined}
              >
                {s.name}
              </span>
            ) : (
              <form key={s.id} action={switchScenario}>
                <input type="hidden" name="dealId" value={dealId} />
                <input type="hidden" name="scenarioId" value={s.id} />
                <SubmitButton
                  title={s.note ?? undefined}
                  pendingLabel="Opening…"
                  className="rounded-full border border-line px-3 py-1 text-xs text-muted hover:border-ink hover:text-ink"
                >
                  {s.name}
                </SubmitButton>
              </form>
            ),
          )}
        </div>

        <div className="ml-auto flex items-center gap-3 text-xs">
          {canEdit && (
            <>
              <button
                type="button"
                onClick={() => setMode((m) => (m === "new" ? "idle" : "new"))}
                className="text-muted hover:text-ink"
              >
                Duplicate
              </button>
              <button
                type="button"
                onClick={() => setMode((m) => (m === "rename" ? "idle" : "rename"))}
                className="text-muted hover:text-ink"
              >
                Rename
              </button>
              {scenarios.length > 1 && (
                <button
                  type="button"
                  onClick={() => setMode((m) => (m === "confirmDelete" ? "idle" : "confirmDelete"))}
                  className="text-muted hover:text-red-600"
                >
                  Delete
                </button>
              )}
            </>
          )}

          <Link
            href={`/multifamily/${dealId}/compare`}
            className="rounded border border-line px-3 py-1.5 text-xs text-ink hover:bg-line/30"
          >
            Compare{scenarios.length > 1 ? ` (${scenarios.length})` : ""}
          </Link>
        </div>
      </div>

      {active?.note && mode === "idle" && <p className="mt-1.5 text-xs text-muted">{active.note}</p>}

      {scenarios.length > 1 && mode === "idle" && (
        <p className="mt-1.5 text-[11px] text-muted">
          Switching scenarios reloads the deal — save before you switch, or you&rsquo;ll lose what
          you changed.
        </p>
      )}

      {mode === "new" && canEdit && (
        <form action={newScenario} onSubmit={closePanel} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="dealId" value={dealId} />
          <input type="hidden" name="from" value={activeId} />
          <label className="text-xs">
            <span className="block text-[11px] uppercase tracking-wide text-muted">
              New scenario, copied from &ldquo;{active?.name}&rdquo;
            </span>
            <input
              name="name"
              required
              defaultValue={active ? `${active.name} (copy)` : "New scenario"}
              className="mt-1 w-64 rounded border border-line px-2 py-1 text-sm"
            />
          </label>
          <SubmitButton pendingLabel="Creating…" className="rounded bg-ink px-3 py-1.5 text-xs text-white">
            Create &amp; open
          </SubmitButton>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-muted hover:text-ink">
            Cancel
          </button>
          <span className="basis-full text-[11px] text-muted">
            Copies every input including the unit mix, then opens it — change the two things this
            case is about.
          </span>
        </form>
      )}

      {mode === "rename" && canEdit && (
        <form action={updateScenario} onSubmit={closePanel} className="mt-3 flex flex-wrap items-end gap-2">
          <input type="hidden" name="dealId" value={dealId} />
          <input type="hidden" name="scenarioId" value={activeId} />
          <label className="text-xs">
            <span className="block text-[11px] uppercase tracking-wide text-muted">Name</span>
            <input
              name="name"
              defaultValue={active?.name ?? ""}
              className="mt-1 w-56 rounded border border-line px-2 py-1 text-sm"
            />
          </label>
          <label className="min-w-[16rem] flex-1 text-xs">
            <span className="block text-[11px] uppercase tracking-wide text-muted">
              Why this case exists
            </span>
            <input
              name="note"
              defaultValue={active?.note ?? ""}
              placeholder="rents held flat, 6.5% exit"
              className="mt-1 w-full rounded border border-line px-2 py-1 text-sm"
            />
          </label>
          <SubmitButton className="rounded bg-ink px-3 py-1.5 text-xs text-white">Save</SubmitButton>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-muted hover:text-ink">
            Cancel
          </button>
        </form>
      )}

      {mode === "confirmDelete" && canEdit && (
        <form action={removeScenario} onSubmit={closePanel} className="mt-3 flex flex-wrap items-center gap-3">
          <input type="hidden" name="dealId" value={dealId} />
          <input type="hidden" name="scenarioId" value={activeId} />
          <span className="text-xs text-ink">
            Delete &ldquo;{active?.name}&rdquo; and everything in it? This can&rsquo;t be undone.
          </span>
          <SubmitButton
            pendingLabel="Deleting…"
            className="rounded bg-red-600 px-3 py-1.5 text-xs font-medium text-white"
          >
            Delete scenario
          </SubmitButton>
          <button type="button" onClick={() => setMode("idle")} className="text-xs text-muted hover:text-ink">
            Keep it
          </button>
        </form>
      )}
    </div>
  );
}
