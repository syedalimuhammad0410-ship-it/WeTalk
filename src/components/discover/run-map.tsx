"use client";
import { useEffect, useState } from "react";
import { Card, CardHeader } from "../ui/misc";
import { LiveMap, type MapPoint } from "../map/live-map";
import { apiFetch } from "@/lib/client";

/** Live map of the latest Business Finder search: pins drop in as businesses are found. */
export function RunMap({ runId, label, live }: { runId: string; label: string; live: boolean }) {
  const [points, setPoints] = useState<MapPoint[]>([]);
  const [isLive, setLive] = useState(live);
  useEffect(() => {
    let alive = true;
    const load = async () => {
      if (document.hidden) return;
      try {
        const r = await apiFetch<{ points: MapPoint[]; live: boolean }>(`/api/map/points?run=${runId}&limit=1500`);
        if (!alive) return;
        setPoints(r.points);
        setLive(r.live);
      } catch {
        /* keep the last pins */
      }
    };
    load();
    if (!isLive) return () => void (alive = false);
    const t = setInterval(load, 4000);
    return () => {
      alive = false;
      clearInterval(t);
    };
  }, [runId, isLive]);
  return (
    <Card className="mt-5">
      <CardHeader title="Search map" description={`${label} — ${isLive ? "new businesses drop onto the map as they're found" : "businesses found by this search"}. Click a pin for details or a 3D view.`} />
      <div className="p-4 pt-0"><LiveMap points={points} live={isLive} height={460} emptyText={isLive ? "Searching… the first businesses will appear here." : "No mappable businesses from this search."} /></div>
    </Card>
  );
}
