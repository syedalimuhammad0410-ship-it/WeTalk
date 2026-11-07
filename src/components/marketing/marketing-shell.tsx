import Link from "next/link";

/** Public site header + footer (homepage, pricing). */
export function MarketingShell({ loggedIn, children }: { loggedIn: boolean; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-bg text-fg">
      <header className="sticky top-0 z-30 border-b border-border/70 bg-bg/85 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-6xl items-center justify-between px-4">
          <Link href="/" className="flex items-center gap-2 font-semibold"><span className="flex h-8 w-8 items-center justify-center rounded-lg bg-accent text-sm font-bold text-accent-fg">W</span> WebScout AI</Link>
          <nav className="hidden items-center gap-6 text-sm text-muted md:flex">
            <Link href="/#how" className="hover:text-fg">How it works</Link>
            <Link href="/#features" className="hover:text-fg">Features</Link>
            <Link href="/pricing" className="hover:text-fg">Pricing</Link>
            <Link href="/#faq" className="hover:text-fg">FAQ</Link>
          </nav>
          <div className="flex items-center gap-2 text-sm">
            {loggedIn ? (
              <Link href="/dashboard" className="inline-flex h-9 items-center rounded-lg bg-accent px-4 font-semibold text-accent-fg">Open dashboard</Link>
            ) : (
              <>
                <Link href="/login" className="hidden h-9 items-center rounded-lg px-3 font-medium text-muted hover:text-fg sm:inline-flex">Sign in</Link>
                <Link href={`/signup?next=${encodeURIComponent("/checkout?plan=FREE")}`} className="inline-flex h-9 items-center rounded-lg bg-accent px-4 font-semibold text-accent-fg">Start free</Link>
              </>
            )}
          </div>
        </div>
      </header>
      <main>{children}</main>
      <footer className="border-t border-border">
        <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-10 text-sm text-muted sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-center gap-2"><span className="flex h-6 w-6 items-center justify-center rounded-md bg-accent text-xs font-bold text-accent-fg">W</span> WebScout AI — from search to sales pipeline.</div>
          <div className="flex gap-5"><Link href="/pricing" className="hover:text-fg">Pricing</Link><Link href="/login" className="hover:text-fg">Sign in</Link><Link href="/#faq" className="hover:text-fg">FAQ</Link></div>
        </div>
      </footer>
    </div>
  );
}
