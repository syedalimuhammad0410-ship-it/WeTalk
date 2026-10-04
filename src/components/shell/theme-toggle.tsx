"use client";
import { useEffect, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { apiFetch, setThemeCookie } from "@/lib/client";

const ORDER = ["light", "dark", "system"] as const;

export function ThemeToggle() {
  const [pref, setPref] = useState<(typeof ORDER)[number]>("system");
  useEffect(() => {
    setPref((document.documentElement.dataset.themePref as (typeof ORDER)[number]) ?? "system");
    const mq = window.matchMedia("(prefers-color-scheme: dark)");
    const onChange = () => document.documentElement.dataset.themePref === "system" && setThemeCookie("system");
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);
  const next = ORDER[(ORDER.indexOf(pref) + 1) % ORDER.length]!;
  const Icon = pref === "light" ? Sun : pref === "dark" ? Moon : Monitor;
  return (
    <button
      className="rounded-lg p-2 text-muted transition-colors hover:bg-subtle hover:text-fg"
      onClick={() => {
        setThemeCookie(next);
        setPref(next);
        apiFetch("/api/me", { method: "PATCH", body: { themePreference: next } }).catch(() => {});
      }}
      aria-label={`Theme: ${pref}. Switch to ${next}`}
      title={`Theme: ${pref}`}
    >
      <Icon className="h-[18px] w-[18px]" />
    </button>
  );
}
