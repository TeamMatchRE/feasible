import Link from "next/link";
import type { ReactNode } from "react";

/**
 * App chrome: the Feasible wordmark, an optional breadcrumb/right slot, and the
 * sign-out control. Editorial, no emoji — Brooke Team house style.
 */
export default function Shell({
  children,
  right,
  crumb,
}: {
  children: ReactNode;
  right?: ReactNode;
  crumb?: ReactNode;
}) {
  return (
    <div className="min-h-screen">
      <header className="border-b border-line bg-parchment/70 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-4 px-6 py-4">
          <Link href="/" className="font-display text-2xl tracking-tight text-ink">
            Feasible
          </Link>
          {crumb ? (
            <span className="truncate text-sm text-muted">{crumb}</span>
          ) : null}
          <div className="ml-auto flex items-center gap-4">
            {right}
            <form action="/auth/signout" method="post">
              <button
                type="submit"
                className="text-sm text-muted transition hover:text-ink"
              >
                Sign out
              </button>
            </form>
          </div>
        </div>
      </header>
      <main className="mx-auto max-w-6xl px-6 py-8">{children}</main>
    </div>
  );
}
