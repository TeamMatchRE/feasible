import Link from "next/link";

/**
 * The project's phases, as tabs.
 *
 * Underwriting is where a project starts and the rest is where it goes once it
 * is real — the same arc Heritage Point already keeps in Drive (town approvals,
 * bank underwriting, equity raise, marketing). Rendered on every project page so
 * the deal stops being "an underwriting model" and starts being the project's
 * home.
 */
const TABS = [
  { href: "", label: "Underwriting" },
  { href: "/capital", label: "Capital" },
  { href: "/lots", label: "Lots" },
  { href: "/updates", label: "Investor updates" },
] as const;

export default function ProjectNav({ dealId, active }: { dealId: string; active: string }) {
  return (
    <div className="mb-5 flex flex-wrap gap-1 border-b border-line">
      {TABS.map((t) => {
        const isActive = t.href === active;
        return (
          <Link
            key={t.href}
            href={`/multifamily/${dealId}${t.href}`}
            className={`-mb-px border-b-2 px-3 py-2 text-sm ${
              isActive
                ? "border-ink font-medium text-ink"
                : "border-transparent text-muted hover:text-ink"
            }`}
          >
            {t.label}
          </Link>
        );
      })}
    </div>
  );
}

/** The stages a project moves through, shown as a read-only trail. */
export const STAGES = [
  ["underwriting", "Underwriting"],
  ["offer", "Offer made"],
  ["due_diligence", "Due diligence"],
  ["financing", "Financing"],
  ["capital_raise", "Capital raise"],
  ["construction", "Construction"],
  ["sales", "Sales"],
  ["closed", "Closed"],
] as const;
