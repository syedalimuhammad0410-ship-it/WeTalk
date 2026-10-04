import { Badge } from "../ui/misc";
import { LEAD_STATUS_META, WEBSITE_CLASS_META, WEBSITE_STATUS_META, type LeadStatusT } from "@/lib/constants";

export function StatusBadge({ status }: { status: string }) {
  const m = LEAD_STATUS_META[status as LeadStatusT] ?? { label: status, tone: "slate" as const };
  return <Badge tone={m.tone} dot>{m.label}</Badge>;
}

export function WebsiteBadge({ websiteClass, websiteStatus }: { websiteClass?: string | null; websiteStatus?: string | null }) {
  if (websiteClass) {
    const m = WEBSITE_CLASS_META[websiteClass];
    return m ? <Badge tone={m.tone}>{m.label}</Badge> : null;
  }
  const s = WEBSITE_STATUS_META[websiteStatus ?? "UNKNOWN"];
  return <Badge tone={s?.tone ?? "zinc"}>{s?.label ?? "Not checked"}</Badge>;
}
