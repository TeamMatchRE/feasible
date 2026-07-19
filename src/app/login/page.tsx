import SignIn from "./SignIn";
import { safeNext } from "@/lib/safe-next";

export default async function LoginPage({
  searchParams,
}: {
  searchParams: Promise<{ next?: string }>;
}) {
  const { next } = await searchParams;
  const dest = safeNext(next);

  return (
    <main className="flex min-h-screen items-center justify-center px-6">
      <div className="w-full max-w-sm text-center">
        <p className="font-display text-5xl tracking-tight text-ink">
          Feasible
        </p>
        <p className="mt-3 text-sm text-muted">
          Can you build here — and what does the site work cost?
        </p>
        <div className="mt-10">
          <SignIn next={dest} />
        </div>
      </div>
    </main>
  );
}
