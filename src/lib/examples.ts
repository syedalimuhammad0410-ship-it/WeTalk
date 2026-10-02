import type { InvestigationMode } from "./types";

/**
 * Example investigations use REAL, openly licensed photographs from Wikimedia Commons.
 * The server downloads them on demand (with attribution) and the full pipeline runs on
 * them exactly as on a user upload. Nothing about the result is pre-scripted.
 */
export interface ExampleCase {
  id: string;
  label: string;
  blurb: string;
  mode: InvestigationMode;
  file: string; // Commons file title (without "File:")
  featured?: boolean;
}

export const EXAMPLES: ExampleCase[] = [
  { id: "basketball", label: "Basketball court", blurb: "Pro game, team logo on the floor, partial arena signage", mode: "sports", file: "Atlanta Hawks v Milwaukee Bucks 03 2010.jpg", featured: true },
  { id: "arena", label: "Sports arena", blurb: "Wide interior shot with scoreboard text", mode: "sports", file: "State Farm Arena - Bulls VS Hawks NBA Game.jpg" },
  { id: "street", label: "City street", blurb: "A single street-name sign", mode: "location", file: "Broadway Street Sign 002.jpg" },
  { id: "hotel", label: "Hotel", blurb: "Neon hotel sign, Art Deco facade", mode: "building", file: "Boulevard Hotel (Neon sign), Miami Beach.jpg" },
  { id: "restaurant", label: "Restaurant", blurb: "Neon restaurant sign and storefront", mode: "building", file: "Senator Restaurant neon sign and storefront - Toronto, Canada.jpg" },
  { id: "university", label: "University building", blurb: "Campus building entrance", mode: "building", file: "Chrysler Hall North entrance, University of Windsor, Windsor, Ontario, 2026-04-26.jpg" },
  { id: "newspaper", label: "Historical newspaper", blurb: "1912 front page — document mode", mode: "document", file: "Times-Advocate-Front-Page-1912-08-22.jpg" },
];
