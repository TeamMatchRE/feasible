"use client";

import { useState } from "react";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  Drop-in feedback widget for BGRE internal apps.
 *
 *  A floating button that opens a small panel where an agent leaves a
 *  suggestion. It POSTs to LilyPad's central ingest endpoint, so it works
 *  from ANY app regardless of that app's database or auth.
 *
 *  To use it in another app:
 *    1. Copy this file into that app's components.
 *    2. Render <FeedbackWidget app="lily" /> once (e.g. in the root layout),
 *       passing this app's id. Optionally pass submitterEmail / submitterName
 *       if the app knows who's signed in.
 *
 *  No dependencies beyond React. Styling is inline so it doesn't rely on the
 *  host app's Tailwind config.
 * ─────────────────────────────────────────────────────────────────────────
 */

const INGEST_URL =
  process.env.NEXT_PUBLIC_FEEDBACK_URL ??
  "https://app.brooketeamre.com/api/feedback";

const INK = "#1b2a44";
const GOLD = "#b08a46";
const LINEN = "#f4efe4";

export default function FeedbackWidget({
  app,
  submitterEmail,
  submitterName,
}: {
  app: string;
  submitterEmail?: string | null;
  submitterName?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );

  async function submit() {
    const text = body.trim();
    if (!text || state === "sending") return;
    setState("sending");
    try {
      const res = await fetch(INGEST_URL, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          app,
          body: text,
          pageUrl: typeof window !== "undefined" ? window.location.href : null,
          submitterEmail: submitterEmail ?? null,
          submitterName: submitterName ?? null,
        }),
      });
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      setBody("");
    } catch {
      setState("error");
    }
  }

  function close() {
    setOpen(false);
    // Reset after the panel animates away.
    setTimeout(() => setState("idle"), 250);
  }

  return (
    <>
      {/* Launcher */}
      {!open && (
        <button
          onClick={() => setOpen(true)}
          aria-label="Leave feedback or a suggestion"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 2147483000,
            display: "inline-flex",
            alignItems: "center",
            gap: 8,
            padding: "10px 16px",
            borderRadius: 999,
            border: `1px solid ${GOLD}`,
            background: INK,
            color: LINEN,
            font: '500 14px/1 ui-sans-serif, system-ui, sans-serif',
            cursor: "pointer",
            boxShadow: "0 6px 20px -8px rgba(27,42,68,0.5)",
          }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
            strokeLinejoin="round" aria-hidden>
            <path d="M21 15a2 2 0 0 1-2 2H8l-4 4V5a2 2 0 0 1 2-2h13a2 2 0 0 1 2 2z" />
          </svg>
          Feedback
        </button>
      )}

      {/* Panel */}
      {open && (
        <div
          role="dialog"
          aria-label="Feedback"
          style={{
            position: "fixed",
            right: 20,
            bottom: 20,
            zIndex: 2147483000,
            width: "min(360px, calc(100vw - 40px))",
            background: "#ffffff",
            border: "1px solid #e3ddce",
            borderRadius: 16,
            boxShadow: "0 16px 44px -16px rgba(27,42,68,0.45)",
            overflow: "hidden",
            font: '14px/1.5 ui-sans-serif, system-ui, sans-serif',
            color: INK,
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              justifyContent: "space-between",
              padding: "12px 14px",
              background: LINEN,
              borderBottom: "1px solid #e3ddce",
            }}
          >
            <strong style={{ fontWeight: 600 }}>Feedback &amp; suggestions</strong>
            <button
              onClick={close}
              aria-label="Close"
              style={{
                border: "none",
                background: "transparent",
                cursor: "pointer",
                color: INK,
                fontSize: 18,
                lineHeight: 1,
                padding: 4,
              }}
            >
              ×
            </button>
          </div>

          <div style={{ padding: 14 }}>
            {state === "sent" ? (
              <div style={{ padding: "16px 4px", textAlign: "center" }}>
                <div style={{ fontSize: 15, fontWeight: 600, marginBottom: 4 }}>
                  Thank you.
                </div>
                <div style={{ color: "#5b6472" }}>
                  Your suggestion was sent to the team.
                </div>
                <button
                  onClick={close}
                  style={{
                    marginTop: 14,
                    padding: "8px 16px",
                    borderRadius: 999,
                    border: `1px solid ${GOLD}`,
                    background: INK,
                    color: LINEN,
                    cursor: "pointer",
                  }}
                >
                  Done
                </button>
              </div>
            ) : (
              <>
                <label
                  htmlFor="feedback-body"
                  style={{ display: "block", color: "#5b6472", marginBottom: 6 }}
                >
                  What&apos;s working, what&apos;s not, or what you&apos;d change:
                </label>
                <textarea
                  id="feedback-body"
                  value={body}
                  onChange={(e) => setBody(e.target.value)}
                  rows={4}
                  maxLength={5000}
                  autoFocus
                  placeholder="Type your suggestion…"
                  style={{
                    width: "100%",
                    boxSizing: "border-box",
                    resize: "vertical",
                    padding: "10px 12px",
                    borderRadius: 10,
                    border: "1px solid #d5cfc0",
                    font: "inherit",
                    color: INK,
                    outline: "none",
                  }}
                />
                {state === "error" && (
                  <div style={{ color: "#b4413c", marginTop: 8, fontSize: 13 }}>
                    Couldn&apos;t send that. Please try again in a moment.
                  </div>
                )}
                <button
                  onClick={submit}
                  disabled={!body.trim() || state === "sending"}
                  style={{
                    marginTop: 12,
                    width: "100%",
                    padding: "10px 16px",
                    borderRadius: 10,
                    border: `1px solid ${GOLD}`,
                    background: body.trim() ? INK : "#9aa1ac",
                    color: LINEN,
                    cursor: body.trim() ? "pointer" : "default",
                    fontWeight: 500,
                  }}
                >
                  {state === "sending" ? "Sending…" : "Send suggestion"}
                </button>
              </>
            )}
          </div>
        </div>
      )}
    </>
  );
}
