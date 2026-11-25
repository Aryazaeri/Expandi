import "server-only";
import { redirect } from "next/navigation";
import { connection } from "next/server";
import { createClient } from "@/lib/supabase/server";

/** The signed-in user's id + an RLS-scoped client. Redirects to /login otherwise. */
export async function requireUser() {
  await connection(); // everything below is per-request (auth, Date.now, DB)
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  if (!userId) redirect("/login");
  return { db, userId, email: (data?.claims?.email as string | undefined) ?? null };
}

/** Same as requireUser, for route handlers (returns null instead of redirecting). */
export async function getUser() {
  await connection();
  const db = await createClient();
  const { data } = await db.auth.getClaims();
  const userId = data?.claims?.sub;
  return userId ? { db, userId } : null;
}
