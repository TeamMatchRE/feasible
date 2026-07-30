/**
 * "Back to LilyPad" — the way out of an app.
 *
 * Agents reach these apps THROUGH LilyPad, but once inside there was no way
 * back except the browser's back button or retyping the URL (Benjamin Cooper,
 * 7/29). Every app already mounts FeedbackWidget as a floating pill on the
 * bottom RIGHT; this is its mirror on the bottom LEFT, so the two read as one
 * piece of app chrome and neither one needs the host app's header to cooperate.
 * That matters: the eight apps have eight different headers (Tailwind, inline
 * styles, no header at all), but they all render a layout.
 *
 * Copied verbatim into each app repo — same convention as FeedbackWidget and
 * the signed-in greeting. There is no shared package.
 */
const INK = "#1b2a44";
const GOLD = "#c9a961";
const LINEN = "#faf7f0";

export default function LilyPadLink() {
  return (
    <>
      {/* Screen-only. A client-facing print (a CMA, a report) must never carry
          internal navigation. data-screen-only is the same hook the print
          stylesheet already uses where one exists; the rule below makes the
          component self-sufficient in the apps that have no print CSS. */}
      <style>{`@media print { .lilypad-home { display: none !important; } }`}</style>
      <a
        href="https://app.brooketeamre.com"
        className="lilypad-home"
        data-screen-only
        aria-label="Back to LilyPad — all Brooke Team apps"
        style={{
          position: "fixed",
          left: 20,
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
          textDecoration: "none",
          boxShadow: "0 6px 20px -8px rgba(27,42,68,0.5)",
        }}
      >
        <svg
          width="16"
          height="16"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.6"
          strokeLinecap="round"
          strokeLinejoin="round"
          aria-hidden
        >
          <rect x="3" y="3" width="7" height="7" rx="1.5" />
          <rect x="14" y="3" width="7" height="7" rx="1.5" />
          <rect x="3" y="14" width="7" height="7" rx="1.5" />
          <rect x="14" y="14" width="7" height="7" rx="1.5" />
        </svg>
        LilyPad
      </a>
    </>
  );
}
