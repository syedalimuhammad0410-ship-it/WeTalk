"use client";
import { useEffect, useState } from "react";
import { formatDateTime, timeAgo } from "@/lib/utils";

/** Times depend on the viewer's clock and time zone, so they render after mount to avoid hydration mismatches. */
function useMounted() {
  const [m, setM] = useState(false);
  useEffect(() => setM(true), []);
  return m;
}

export function RelTime({ d }: { d: string | Date | null | undefined }) {
  const mounted = useMounted();
  if (!d) return <>—</>;
  const iso = new Date(d).toISOString();
  return <time dateTime={iso} title={mounted ? formatDateTime(d) : undefined} suppressHydrationWarning>{mounted ? timeAgo(d) : iso.slice(0, 10)}</time>;
}

export function DateTimeText({ d }: { d: string | Date | null | undefined }) {
  const mounted = useMounted();
  if (!d) return <>—</>;
  const iso = new Date(d).toISOString();
  return <time dateTime={iso} suppressHydrationWarning>{mounted ? formatDateTime(d) : iso.slice(0, 16).replace("T", " ")}</time>;
}
