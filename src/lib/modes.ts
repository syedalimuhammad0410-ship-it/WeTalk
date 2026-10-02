import type { InvestigationMode } from "./types";

export const MODES: { id: InvestigationMode; label: string; blurb: string }[] = [
  { id: "quick", label: "Quick Scan", blurb: "Fast, low-cost first pass" },
  { id: "deep", label: "Deep Investigation", blurb: "All branches, falsification, AI" },
  { id: "visual", label: "Visual Match", blurb: "Focus on image comparison" },
  { id: "location", label: "Location Finder", blurb: "Focus on geolocation" },
  { id: "document", label: "Document Analysis", blurb: "OCR + publication research" },
  { id: "sports", label: "Sports Venue", blurb: "Courts, fields, arenas" },
  { id: "building", label: "Building ID", blurb: "Architecture, businesses" },
  { id: "historical", label: "Historical", blurb: "Dates & historical records" },
  { id: "custom", label: "Custom", blurb: "Tell TRACE what to look for" },
];
