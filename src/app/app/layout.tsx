import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { AppShell } from "@/components/AppShell";
import { SESSION_COOKIE, verifySessionToken } from "@/lib/auth/session";

// Server-side gate for every /app page (replaces the old middleware so the app runs unchanged on
// Netlify and Cloudflare Workers). API routes still check the session and allow-list on every call.
export default async function AppLayout({ children }: { children: React.ReactNode }) {
  const token = (await cookies()).get(SESSION_COOKIE)?.value;
  if (!(await verifySessionToken(token).catch(() => null))) redirect("/login");
  return <AppShell>{children}</AppShell>;
}
