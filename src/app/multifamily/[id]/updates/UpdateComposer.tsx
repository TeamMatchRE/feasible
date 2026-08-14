"use client";

import { useActionState } from "react";
import { generateUpdate, type DraftState } from "../../capital-actions";
import { SubmitButton } from "@/components/SubmitButton";

/**
 * Write the substance; the model writes the letter.
 *
 * The brief is deliberately the only input. Asking for a subject line, a tone
 * setting and a length would be asking the user to do the writing after all —
 * the point is that a few honest sentences about what happened on site come out
 * as something an investor can read.
 */
export default function UpdateComposer({
  projectId,
  recipients,
}: {
  projectId: string;
  recipients: { name: string; email: string | null }[];
}) {
  const [state, formAction] = useActionState<DraftState, FormData>(generateUpdate, null);

  return (
    <div className="rounded-lg border border-line bg-white p-4">
      <h2 className="text-sm font-semibold text-ink">Write an update</h2>
      <p className="mt-0.5 text-xs text-muted">
        A few lines is enough — what happened, what changed, what&rsquo;s next. It gets written up
        in the company&rsquo;s voice with the project&rsquo;s real figures alongside it.
      </p>

      <form action={formAction} className="mt-3 space-y-3">
        <input type="hidden" name="projectId" value={projectId} />
        <textarea
          name="brief"
          required
          rows={6}
          placeholder={
            "Foundations are in on the first three lots and passed inspection. Eversource finally scheduled the transformer. Two of the eight are reserved."
          }
          className="w-full rounded border border-line px-3 py-2 text-sm leading-relaxed"
        />

        <div className="flex flex-wrap items-center gap-3">
          <SubmitButton
            pendingLabel="Writing… (about 15 seconds)"
            className="rounded bg-ink px-4 py-2 text-sm text-white hover:bg-ink/90"
          >
            Draft the update
          </SubmitButton>
          <span className="text-xs text-muted">
            Goes to {recipients.length} investor{recipients.length === 1 ? "" : "s"} once you send it —
            nothing sends automatically.
          </span>
        </div>
      </form>

      {state?.error && <p className="mt-3 text-xs text-red-600">{state.error}</p>}
      {state?.id && (
        <p className="mt-3 text-xs text-ink">
          Draft written — it&rsquo;s in <strong>Past updates</strong> below. Read it before it goes
          anywhere; anything the model refused to say is listed with it.
        </p>
      )}

      <div className="mt-4 border-t border-line pt-3">
        <p className="text-[11px] uppercase tracking-wide text-muted">What it will not do</p>
        <p className="mt-1 text-xs leading-relaxed text-muted">
          It writes only from what you type and the figures already recorded on this project. It will
          not invent a closing date, promise a distribution or a return, or claim a permit or
          milestone you didn&rsquo;t mention — if your note implies one of those, it leaves it out and
          tells you it did, so you can decide whether to add it yourself.
        </p>
      </div>
    </div>
  );
}
