import { LayoutDashboard, Users, Compass, Gauge, FileCode2, Inbox, CalendarClock, Megaphone, BarChart3, LayoutTemplate, Settings } from "lucide-react";

export const NAV = [
  { href: "/dashboard", label: "Dashboard", icon: LayoutDashboard },
  { href: "/leads", label: "Leads", icon: Users },
  { href: "/discover", label: "Find Businesses", icon: Compass },
  { href: "/audits", label: "Website Audits", icon: Gauge },
  { href: "/prompts", label: "Prompts", icon: FileCode2 },
  { href: "/inbox", label: "Inbox", icon: Inbox, badge: "inbox" as const },
  { href: "/follow-ups", label: "Follow-Ups", icon: CalendarClock, badge: "followups" as const },
  { href: "/campaigns", label: "Campaigns", icon: Megaphone },
  { href: "/analytics", label: "Analytics", icon: BarChart3 },
  { href: "/templates", label: "Templates", icon: LayoutTemplate },
  { href: "/settings", label: "Settings", icon: Settings },
];
