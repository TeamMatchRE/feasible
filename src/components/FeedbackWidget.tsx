"use client";

import { useEffect, useRef, useState } from "react";

/*
 * ─────────────────────────────────────────────────────────────────────────
 *  Drop-in feedback widget for BGRE internal apps.
 *
 *  A floating button that opens a small panel where an agent leaves a
 *  suggestion, optionally with one screenshot (attach a file, or just paste
 *  from the clipboard — Cmd-Shift-4 then Cmd-V). It POSTs to LilyPad's
 *  central ingest endpoint, so it works from ANY app regardless of that
 *  app's database or auth.
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

// Must match the ingest endpoint + the storage bucket's own limits.
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;
const IMAGE_TYPES = ["image/png", "image/jpeg", "image/webp", "image/gif"];

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
  const [image, setImage] = useState<File | null>(null);
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [imageError, setImageError] = useState<string | null>(null);
  const [state, setState] = useState<"idle" | "sending" | "sent" | "error">(
    "idle",
  );
  const fileInput = useRef<HTMLInputElement>(null);

  // Preview object URL, revoked whenever the image changes or we unmount.
  useEffect(() => {
    if (!image) {
      setImageUrl(null);
      return;
    }
    const url = URL.createObjectURL(image);
    setImageUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [image]);

  function attach(file: File | null | undefined) {
    if (!file) return;
    if (!IMAGE_TYPES.includes(file.type)) {
      setImageError("That file isn't a PNG, JPEG, WebP or GIF image.");
      return;
    }
    if (file.size > MAX_IMAGE_BYTES) {
      setImageError("That image is over 5 MB. Try a smaller crop.");
      return;
    }
    setImageError(null);
    setImage(file);
  }

  // Pasting a screenshot straight into the panel is the whole point — most
  // people screenshot to the clipboard and never save a file.
  function onPaste(e: React.ClipboardEvent) {
    const file = Array.from(e.clipboardData.files).find((f) =>
      f.type.startsWith("image/"),
    );
    if (file) {
      e.preventDefault();
      attach(file);
    }
  }

  function removeImage() {
    setImage(null);
    setImageError(null);
    if (fileInput.current) fileInput.current.value = "";
  }

  async function submit() {
    const text = body.trim();
    if (!text || state === "sending") return;
    setState("sending");
    try {
      const pageUrl =
        typeof window !== "undefined" ? window.location.href : null;

      // Multipart only when there's a file; plain JSON otherwise, so the
      // endpoint's original contract is unchanged for text-only submissions.
      let init: RequestInit;
      if (image) {
        const form = new FormData();
        form.set("app", app);
        form.set("body", text);
        if (pageUrl) form.set("pageUrl", pageUrl);
        if (submitterEmail) form.set("submitterEmail", submitterEmail);
        if (submitterName) form.set("submitterName", submitterName);
        form.set("screenshot", image, image.name || "screenshot.png");
        init = { method: "POST", body: form };
      } else {
        init = {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            app,
            body: text,
            pageUrl,
            submitterEmail: submitterEmail ?? null,
            submitterName: submitterName ?? null,
          }),
        };
      }

      const res = await fetch(INGEST_URL, init);
      if (!res.ok) throw new Error(String(res.status));
      setState("sent");
      setBody("");
      removeImage();
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
          onPaste={onPaste}
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
                  placeholder="Type your suggestion… you can paste a screenshot too."
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
                <input
                  ref={fileInput}
                  type="file"
                  accept={IMAGE_TYPES.join(",")}
                  onChange={(e) => attach(e.target.files?.[0])}
                  style={{ display: "none" }}
                />

                {image && imageUrl ? (
                  <div
                    style={{
                      marginTop: 10,
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      padding: 8,
                      borderRadius: 10,
                      border: "1px solid #d5cfc0",
                      background: LINEN,
                    }}
                  >
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img
                      src={imageUrl}
                      alt="Screenshot to send"
                      style={{
                        width: 52,
                        height: 52,
                        objectFit: "cover",
                        borderRadius: 6,
                        border: "1px solid #d5cfc0",
                      }}
                    />
                    <span
                      style={{
                        flex: 1,
                        minWidth: 0,
                        fontSize: 13,
                        color: "#5b6472",
                        overflow: "hidden",
                        textOverflow: "ellipsis",
                        whiteSpace: "nowrap",
                      }}
                    >
                      Screenshot attached
                    </span>
                    <button
                      onClick={removeImage}
                      aria-label="Remove screenshot"
                      style={{
                        border: "none",
                        background: "transparent",
                        color: "#5b6472",
                        cursor: "pointer",
                        fontSize: 13,
                        textDecoration: "underline",
                        padding: 2,
                      }}
                    >
                      Remove
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={() => fileInput.current?.click()}
                    style={{
                      marginTop: 10,
                      display: "inline-flex",
                      alignItems: "center",
                      gap: 6,
                      padding: "6px 10px",
                      borderRadius: 999,
                      border: "1px solid #d5cfc0",
                      background: "transparent",
                      color: "#5b6472",
                      font: "inherit",
                      fontSize: 13,
                      cursor: "pointer",
                    }}
                  >
                    <svg width="14" height="14" viewBox="0 0 24 24" fill="none"
                      stroke="currentColor" strokeWidth="1.6" strokeLinecap="round"
                      strokeLinejoin="round" aria-hidden>
                      <rect x="3" y="3" width="18" height="18" rx="2" />
                      <circle cx="8.5" cy="8.5" r="1.5" />
                      <path d="m21 15-5-5L5 21" />
                    </svg>
                    Add a screenshot
                  </button>
                )}

                {imageError && (
                  <div style={{ color: "#b4413c", marginTop: 8, fontSize: 13 }}>
                    {imageError}
                  </div>
                )}
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
