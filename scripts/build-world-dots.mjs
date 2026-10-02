// Generates public/world-dots.json: land sample points (lon,lat) on a 2° grid,
// derived from Natural Earth 110m land (public domain) via world-atlas.
import fs from "node:fs";
import { feature } from "topojson-client";

const topo = JSON.parse(fs.readFileSync(process.argv[2] || "/tmp/land.json", "utf8"));
const land = feature(topo, topo.objects.land);
const polys = [];
for (const f of land.features) {
  const g = f.geometry;
  if (g.type === "Polygon") polys.push(g.coordinates);
  else if (g.type === "MultiPolygon") polys.push(...g.coordinates);
}
function inRing(x, y, ring) {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i], [xj, yj] = ring[j];
    if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
  }
  return inside;
}
const pts = [];
const step = 2;
for (let lat = -58; lat <= 82; lat += step)
  for (let lon = -180; lon < 180; lon += step) {
    const x = lon + step / 2, y = lat + step / 2;
    if (polys.some((p) => inRing(x, y, p[0]) && !p.slice(1).some((h) => inRing(x, y, h)))) pts.push([+(x.toFixed(1)), +(y.toFixed(1))]);
  }
fs.writeFileSync("public/world-dots.json", JSON.stringify(pts));
console.log(pts.length, "points");
