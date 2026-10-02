"use client";
// Tile-based zero-shot recognition (CLIP) for country flags and brand / sponsor logos.
// Results are probabilistic visual evidence: only confident, well-separated matches are kept.
import { imageEmbedding, zeroShot } from "./clip";

export const COUNTRIES = [
  "Afghanistan","Albania","Algeria","Andorra","Angola","Antigua and Barbuda","Argentina","Armenia","Australia","Austria","Azerbaijan","Bahamas","Bahrain","Bangladesh","Barbados","Belarus","Belgium","Belize","Benin","Bhutan","Bolivia","Bosnia and Herzegovina","Botswana","Brazil","Brunei","Bulgaria","Burkina Faso","Burundi","Cambodia","Cameroon","Canada","Cape Verde","Central African Republic","Chad","Chile","China","Colombia","Comoros","Costa Rica","Croatia","Cuba","Cyprus","Czech Republic","Democratic Republic of the Congo","Denmark","Djibouti","Dominica","Dominican Republic","Ecuador","Egypt","El Salvador","Equatorial Guinea","Eritrea","Estonia","Eswatini","Ethiopia","Fiji","Finland","France","Gabon","Gambia","Georgia","Germany","Ghana","Greece","Grenada","Guatemala","Guinea","Guinea-Bissau","Guyana","Haiti","Honduras","Hungary","Iceland","India","Indonesia","Iran","Iraq","Ireland","Israel","Italy","Ivory Coast","Jamaica","Japan","Jordan","Kazakhstan","Kenya","Kiribati","Kosovo","Kuwait","Kyrgyzstan","Laos","Latvia","Lebanon","Lesotho","Liberia","Libya","Liechtenstein","Lithuania","Luxembourg","Madagascar","Malawi","Malaysia","Maldives","Mali","Malta","Marshall Islands","Mauritania","Mauritius","Mexico","Micronesia","Moldova","Monaco","Mongolia","Montenegro","Morocco","Mozambique","Myanmar","Namibia","Nauru","Nepal","Netherlands","New Zealand","Nicaragua","Niger","Nigeria","North Korea","North Macedonia","Norway","Oman","Pakistan","Palau","Palestine","Panama","Papua New Guinea","Paraguay","Peru","Philippines","Poland","Portugal","Qatar","Republic of the Congo","Romania","Russia","Rwanda","Saint Kitts and Nevis","Saint Lucia","Saint Vincent and the Grenadines","Samoa","San Marino","Saudi Arabia","Senegal","Serbia","Seychelles","Sierra Leone","Singapore","Slovakia","Slovenia","Solomon Islands","Somalia","South Africa","South Korea","South Sudan","Spain","Sri Lanka","Sudan","Suriname","Sweden","Switzerland","Syria","Taiwan","Tajikistan","Tanzania","Thailand","Togo","Tonga","Trinidad and Tobago","Tunisia","Turkey","Turkmenistan","Tuvalu","Uganda","Ukraine","United Arab Emirates","United Kingdom","United States","Uruguay","Uzbekistan","Vanuatu","Vatican City","Venezuela","Vietnam","Yemen","Zambia","Zimbabwe","England","Scotland","Wales","European Union","Puerto Rico","Hong Kong",
];

export const BRANDS = [
  "Coca-Cola","Pepsi","Nike","Adidas","Puma","Under Armour","Reebok","New Balance","Spalding","Wilson","Gatorade","Red Bull","Monster Energy","McDonald's","Burger King","KFC","Starbucks","Subway","Domino's","Pizza Hut","Heineken","Budweiser","Carlsberg","Corona","Emirates","Qatar Airways","Etihad","Turkish Airlines","Delta Air Lines","American Airlines","United Airlines","Lufthansa","Fly Emirates","Visa","Mastercard","American Express","PayPal","Samsung","Apple","Google","Microsoft","Amazon","Sony","LG","Huawei","Xiaomi","Intel","Toyota","Honda","Nissan","Hyundai","Kia","Ford","Chevrolet","BMW","Mercedes-Benz","Audi","Volkswagen","Tesla","Ferrari","Shell","BP","Chevron","ExxonMobil","Total","Verizon","AT&T","T-Mobile","Vodafone","State Farm","Allstate","Geico","AIG","Allianz","AXA","Santander","HSBC","Barclays","Chase","Bank of America","Citi","Wells Fargo","Rakuten","Standard Chartered","FedEx","UPS","DHL","Walmart","Target","IKEA","Coca-Cola Zero","Lay's","Doritos","Mountain Dew","Nestlé","Kellogg's","Hilton","Marriott","Holiday Inn","Hyatt","Ritz-Carlton","Sheraton","Uber","Airbnb","Netflix","Disney","ESPN","Fox Sports","NBC","CBS","BBC","CNN","Sky Sports","Beats","Bose","Playstation","Xbox","EA Sports","Nintendo","Rolex","Tag Heuer","Omega","Hublot","Lego","Mattel","H&M","Zara","Uniqlo","Gucci","Louis Vuitton","Chanel","Prada","Kia Motors","Jeep","Gillette","Colgate","Pantene","Nivea","L'Oréal","Unilever","Procter & Gamble","Oracle","Cisco","IBM","Dell","HP","Lenovo","Canon","Nikon","GoPro","Bridgestone","Michelin","Goodyear","Pirelli","Castrol","Mobil 1",
];

interface Hit {
  name: string;
  p: number;
  margin: number;
  box: { x: number; y: number; w: number; h: number };
}

function crop(c: HTMLCanvasElement, b: { x: number; y: number; w: number; h: number }) {
  const out = document.createElement("canvas");
  out.width = Math.max(1, Math.round(c.width * b.w));
  out.height = Math.max(1, Math.round(c.height * b.h));
  out.getContext("2d")!.drawImage(c, c.width * b.x, c.height * b.y, out.width, out.height, 0, 0, out.width, out.height);
  return out;
}

/** Full frame + overlapping grid tiles; returns the best label per tile when it clearly wins. */
async function tileZeroShot(c: HTMLCanvasElement, labels: string[], prompt: (l: string) => string, negatives: string[], grid = 3): Promise<Hit[]> {
  const prompts = [...labels.map(prompt), ...negatives];
  const boxes = [{ x: 0, y: 0, w: 1, h: 1 }];
  const size = grid === 3 ? 0.45 : 0.6;
  const step = (1 - size) / (grid - 1);
  for (let gy = 0; gy < grid; gy++) for (let gx = 0; gx < grid; gx++) boxes.push({ x: gx * step, y: gy * step, w: size, h: size });
  const hits: Hit[] = [];
  for (const b of boxes) {
    const emb = await imageEmbedding(b.w === 1 ? c : crop(c, b));
    const probs = await zeroShot(emb, prompts);
    const ranked = labels.map((l, i) => ({ l, p: probs[i] })).sort((a, z) => z.p - a.p);
    const neg = Math.max(...probs.slice(labels.length));
    const [a, z] = ranked;
    if (a.p > neg) hits.push({ name: a.l, p: a.p, margin: a.p / Math.max(1e-6, z?.p || 1e-6), box: b });
  }
  return hits;
}

function aggregate(hits: Hit[], minP: number, minMargin: number) {
  const best = new Map<string, Hit & { tiles: number }>();
  for (const h of hits) {
    if (h.p < minP || h.margin < minMargin) continue;
    const cur = best.get(h.name);
    if (!cur) best.set(h.name, { ...h, tiles: 1 });
    else {
      cur.tiles++;
      if (h.p > cur.p) Object.assign(cur, { p: h.p, margin: h.margin, box: h.box });
    }
  }
  return [...best.values()].sort((a, b) => b.p * b.tiles - a.p * a.tiles);
}

export async function recognizeFlags(c: HTMLCanvasElement) {
  const hits = await tileZeroShot(c, COUNTRIES, (n) => `the national flag of ${n}`, ["a photo with no flag", "a crowd of people", "a building facade", "a sports field"]);
  return aggregate(hits, 0.32, 1.8).slice(0, 4);
}

export async function recognizeBrands(c: HTMLCanvasElement) {
  const hits = await tileZeroShot(c, BRANDS, (n) => `the ${n} logo`, ["a photo with no logo", "plain text", "a crowd of people", "a building", "a person"]);
  return aggregate(hits, 0.35, 2).slice(0, 6);
}
