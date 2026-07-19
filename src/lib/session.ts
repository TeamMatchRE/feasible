import "server-only";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import { sql } from "@/db";

export interface SessionUser {
  id: string;
  email: string | null;
  fullName: string | null;
}

/**
 * The signed-in user for the current request, or null. Also mirrors the user
 * into feasible.profiles (id = auth.uid()) so every owner_id FK resolves — the
 * app never writes a project/template without a profile row behind it.
 */
export async function getUser(): Promise<SessionUser | null> {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return null;

  const email = user.email ?? null;
  const fullName =
    (user.user_metadata?.full_name as string | undefined) ??
    (user.user_metadata?.name as string | undefined) ??
    null;

  // Upsert the profile mirror. Cheap; keeps email/name fresh on every login.
  await sql`
    insert into feasible.profiles (id, email, full_name)
    values (${user.id}, ${email}, ${fullName})
    on conflict (id) do update
      set email = excluded.email,
          full_name = excluded.full_name,
          updated_at = now()
  `;

  return { id: user.id, email, fullName };
}

/** Same as getUser() but redirects to /login when unauthenticated. */
export async function requireUser(next = "/"): Promise<SessionUser> {
  const user = await getUser();
  if (!user) redirect(`/login?next=${encodeURIComponent(next)}`);
  return user;
}
