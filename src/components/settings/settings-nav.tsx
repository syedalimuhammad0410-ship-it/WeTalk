"use client";
import Link from "next/link";
import { cn } from "@/lib/utils";

export const SETTINGS_SECTIONS = [
  { id: "account", label: "Account" },
  { id: "workspace", label: "Workspace" },
  { id: "users", label: "Users" },
  { id: "company", label: "Company profile" },
  { id: "integrations", label: "Business Discovery & AI keys" },
  { id: "ai", label: "AI" },
  { id: "email", label: "Email" },
  { id: "automation", label: "Automation" },
  { id: "follow-ups", label: "Follow-Ups" },
  { id: "compliance", label: "Compliance" },
  { id: "notifications", label: "Notifications" },
  { id: "data", label: "Data" },
  { id: "security", label: "Security" },
] as const;

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
