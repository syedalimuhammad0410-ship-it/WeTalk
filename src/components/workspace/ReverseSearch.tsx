"use client";
import { useEffect, useRef, useState } from "react";
import { ExternalLink, ScanEye } from "lucide-react";
import { Button } from "@/components/ui";
import { api } from "@/lib/client/api";

const ENGINES: { id: string; label: string; note: string; url: (img: string) => string }[] = [
  { id: "lens", label: "Google Lens", note: "best overall, products & landmarks", url: (u) => `https://lens.google.com/uploadbyurl?url=${encodeURIComponent(u)}` },
  { id: "yandex", label: "Yandex Images", note: "strongest for buildings & streets", url: (u) => `https://yandex.com/images/search?rpt=imageview&url=${encodeURIComponent(u)}` },
  { id: "bing", label: "Bing Visual Search", note: "good for places & shops", url: (u) => `https://www.bing.com/images/search?view=detailv2&iss=sbi&q=imgurl:${encodeURIComponent(u)}` },
  { id: "tineye", label: "TinEye", note: "finds exact copies & where a photo first appeared", url: (u) => `https://tineye.com/search?url=${encodeURIComponent(u)}` },
];

const links = new Map<string, { url: string; at: number }>();

/** One-click reverse image search on outside sites, via a temporary 30-minute link to the image. */
export function ReverseSearch({ imageKey }: { imageKey: string }) {
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const close = (e: MouseEvent) => ref.current && !ref.current.contains(e.target as Node) && setOpen(false);
    window.addEventListener("mousedown", close);
    return () => window.removeEventListener("mousedown", close);
  }, [open]);

  async function go(engine: (typeof ENGINES)[number]) {
    setErr(null);
    // open the tab synchronously (popup blockers), then point it at the search once the link exists
    const tab = window.open("about:blank", "_blank");
    try {
      let l = links.get(imageKey);
      if (!l || Date.now() - l.at > 25 * 60_000) {
        const r = await api.post<{ url: string }>("/api/images/public-link", { imageKey });
        l = { url: r.url, at: Date.now() };
        links.set(imageKey, l);
      }
      if (tab) tab.location.href = engine.url(l.url);
      else window.open(engine.url(l.url), "_blank", "noopener");
      setOpen(false);
    } catch (e) {
      tab?.close();
      setErr(e instanceof Error ? e.message : String(e));
    }
  }

  return (
    <div ref={ref} className="relative">
      <Button size="sm" variant="ghost" onClick={() => setOpen((o) => !o)} aria-expanded={open} title="Search the web for this exact image">
        <ScanEye className="size-3.5" /> Reverse search
      </Button>
      {open && (
        <div className="absolute right-0 top-full z-30 mt-1 w-[290px] rounded-[5px] border border-line-strong bg-panel p-1.5 shadow-2xl">
          {ENGINES.map((e) => (
            <button key={e.id} onClick={() => go(e)} className="flex w-full items-start gap-2 rounded-[4px] px-2 py-1.5 text-left hover:bg-white/[0.05]">
              <ExternalLink className="mt-0.5 size-3.5 shrink-0 text-mute" />
              <span>
                <span className="block text-[12.5px]">{e.label}</span>
                <span className="block text-[11px] text-mute">{e.note}</span>
              </span>
            </button>
          ))}
          <p className="border-t border-line px-2 pt-1.5 text-[10.5px] leading-snug text-mute">Opens the site in a new tab and shares this image with it through a private link that expires in 30 minutes.</p>
          {err && <p className="px-2 pt-1 text-[11px] text-alert">{err}</p>}
        </div>
      )}
    </div>
  );
}
