"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";
import { SETTINGS_SECTIONS } from "@/lib/settings-sections";


export function SettingsNav({ active }: { active: string }) {
  return (
    <nav aria-label="Settings sections" className="scrollbar-thin -mx-4 flex gap-1 overflow-x-auto px-4 lg:mx-0 lg:flex-col lg:px-0">
      {SETTINGS_SECTIONS.map((s) => (
        <Link key={s.id} href={`/settings/${s.id}`} aria-current={active === s.id ? "page" : undefined} className={cn("shrink-0 whitespace-nowrap rounded-lg px-3 py-2 text-sm transition-colors", active === s.id ? "bg-subtle font-medium text-fg" : "text-muted hover:bg-subtle/60 hover:text-fg")}>
          {s.label}
        </Link>
      ))}
    </nav>
  );
}
