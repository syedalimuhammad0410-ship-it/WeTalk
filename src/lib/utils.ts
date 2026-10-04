import clsx, { type ClassValue } from "clsx";

export const cn = (...v: ClassValue[]) => clsx(v);

export function formatNumber(n: number | null | undefined) {
  if (n === null || n === undefined) return "—";
  return new Intl.NumberFormat("en-US").format(n);
}

export function formatPercent(n: number | null | undefined, digits = 1) {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function formatDate(d: string | Date | null | undefined, opts: Intl.DateTimeFormatOptions = { dateStyle: "medium" }) {
  if (!d) return "—";
  return new Intl.DateTimeFormat("en-US", opts).format(new Date(d));
}

export function formatDateTime(d: string | Date | null | undefined) {
  return formatDate(d, { dateStyle: "medium", timeStyle: "short" });
}

export function timeAgo(d: string | Date | null | undefined) {
  if (!d) return "—";
  const diff = (Date.now() - new Date(d).getTime()) / 1000;
  const abs = Math.abs(diff);
  const units: [number, Intl.RelativeTimeFormatUnit][] = [
    [60, "second"],
    [3600, "minute"],
    [86400, "hour"],
    [604800, "day"],
    [2629800, "week"],
    [31557600, "month"],
    [Infinity, "year"],
  ];
  const div: Record<string, number> = { second: 1, minute: 60, hour: 3600, day: 86400, week: 604800, month: 2629800, year: 31557600 };
  const rtf = new Intl.RelativeTimeFormat("en", { numeric: "auto" });
  for (const [limit, unit] of units) {
    if (abs < limit) return rtf.format(-Math.round(diff / div[unit]), unit);
  }
  return formatDate(d);
}

export function initials(name: string) {
  return name
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((p) => p[0]!.toUpperCase())
    .join("");
}

export function pluralize(n: number, one: string, many = `${one}s`) {
  return `${formatNumber(n)} ${n === 1 ? one : many}`;
}

export function scoreTone(score: number | null | undefined): "red" | "orange" | "amber" | "blue" | "green" | "zinc" {
  if (score === null || score === undefined) return "zinc";
  if (score < 35) return "red";
  if (score < 50) return "orange";
  if (score < 65) return "amber";
  if (score < 80) return "blue";
  return "green";
}

export function opportunityTone(score: number | null | undefined): "violet" | "blue" | "slate" | "zinc" {
  if (score === null || score === undefined) return "zinc";
  if (score >= 70) return "violet";
  if (score >= 45) return "blue";
  return "slate";
}

export function greeting(date = new Date()) {
  const h = date.getHours();
  if (h < 12) return "Good morning";
  if (h < 18) return "Good afternoon";
  return "Good evening";
}
