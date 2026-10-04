import { Logo } from "../shell/logo";
import { Search, Gauge, FileCode2, MessagesSquare } from "lucide-react";

export function AuthShell({ children }: { children: React.ReactNode }) {
  return (
    <div className="grid min-h-screen lg:grid-cols-[1fr_minmax(0,560px)]">
      <aside className="relative hidden overflow-hidden bg-sidebar text-sidebar-fg lg:flex lg:flex-col lg:justify-between lg:p-12">
        <div className="absolute inset-0 opacity-[0.35]" style={{ backgroundImage: "radial-gradient(circle at 20% 20%, rgba(99,102,241,.35), transparent 40%), radial-gradient(circle at 80% 70%, rgba(14,165,233,.18), transparent 45%)" }} aria-hidden />
        <div className="relative flex items-center gap-2.5">
          <Logo />
          <span className="text-[15px] font-semibold">WebScout AI</span>
        </div>
        <div className="relative max-w-md">
          <h2 className="text-3xl font-semibold leading-tight tracking-tight">Find businesses. Understand their websites. Discover opportunities. Start better conversations.</h2>
          <ul className="mt-10 space-y-5 text-sm text-sidebar-muted">
            {[
              [Search, "Discover local businesses through official APIs"],
              [Gauge, "Explainable website audits and opportunity scores"],
              [FileCode2, "Business-specific website specs for any AI builder"],
              [MessagesSquare, "Compliant outreach with human-approved AI replies"],
            ].map(([Icon, t], i) => {
              const I = Icon as typeof Search;
              return (
                <li key={i} className="flex items-center gap-3">
                  <span className="flex h-8 w-8 items-center justify-center rounded-lg bg-white/5 ring-1 ring-white/10">
                    <I className="h-4 w-4 text-indigo-300" />
                  </span>
                  {t as string}
                </li>
              );
            })}
          </ul>
        </div>
        <p className="relative text-xs text-sidebar-muted">Built for small website agencies.</p>
      </aside>
      <main className="flex items-center justify-center px-4 py-12 sm:px-10">
        <div className="w-full max-w-sm">
          <div className="mb-8 flex items-center gap-2.5 lg:hidden">
            <Logo />
            <span className="text-[15px] font-semibold">WebScout AI</span>
          </div>
          {children}
        </div>
      </main>
    </div>
  );
}
