"use client";

/** Lightweight static map from OSM raster tiles (no JS map engine), with attribution. */
export function StaticMap({ lat, lng, zoom = 14, height = 200, markers = [] }: { lat: number; lng: number; zoom?: number; height?: number; markers?: { lat: number; lng: number; color?: string }[] }) {
  const n = 2 ** zoom;
  const xt = ((lng + 180) / 360) * n;
  const yt = ((1 - Math.log(Math.tan((lat * Math.PI) / 180) + 1 / Math.cos((lat * Math.PI) / 180)) / Math.PI) / 2) * n;
  const cx = Math.floor(xt);
  const cy = Math.floor(yt);
  const tiles: { x: number; y: number; dx: number; dy: number }[] = [];
  for (let dx = -2; dx <= 2; dx++) for (let dy = -1; dy <= 1; dy++) tiles.push({ x: (((cx + dx) % n) + n) % n, y: cy + dy, dx, dy });
  const offX = (xt - cx) * 256;
  const offY = (yt - cy) * 256;
  const toPx = (la: number, lo: number) => {
    const x = ((lo + 180) / 360) * n;
    const y = ((1 - Math.log(Math.tan((la * Math.PI) / 180) + 1 / Math.cos((la * Math.PI) / 180)) / Math.PI) / 2) * n;
    return { x: (x - xt) * 256, y: (y - yt) * 256 };
  };
  return (
    <div className="relative w-full overflow-hidden rounded-[4px] border border-line bg-[#0a0c0f]" style={{ height }}>
      <div className="absolute left-1/2 top-1/2">
        {tiles.map((t) => (
          // eslint-disable-next-line @next/next/no-img-element
          <img key={`${t.dx}:${t.dy}`} src={`https://tile.openstreetmap.org/${zoom}/${t.x}/${t.y}.png`} alt="" loading="lazy" className="dim-tiles absolute max-w-none" width={256} height={256} style={{ left: t.dx * 256 - offX, top: t.dy * 256 - offY }} />
        ))}
        {markers.map((m, i) => {
          const p = toPx(m.lat, m.lng);
          return (
            <span key={i} className="absolute" style={{ left: p.x, top: p.y }}>
              <span className="pulse-ring absolute -left-3 -top-3 size-6 rounded-full border-2" style={{ borderColor: m.color || "#ff7a45" }} />
              <span className="absolute -left-1.5 -top-1.5 size-3 rounded-full border-2 border-black" style={{ background: m.color || "#ff7a45" }} />
            </span>
          );
        })}
      </div>
      <div className="absolute bottom-0 right-0 bg-black/70 px-1.5 text-[9.5px] text-mute">© OpenStreetMap contributors</div>
    </div>
  );
}

export function mapsLinks(lat: number, lng: number, name?: string) {
  return {
    googleCoords: `https://www.google.com/maps/search/?api=1&query=${lat},${lng}`,
    googleName: name ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(name)}` : undefined,
    osm: `https://www.openstreetmap.org/?mlat=${lat}&mlon=${lng}#map=17/${lat}/${lng}`,
    apple: `https://maps.apple.com/?ll=${lat},${lng}${name ? `&q=${encodeURIComponent(name)}` : ""}`,
  };
}
