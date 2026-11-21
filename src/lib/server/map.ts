import "./guard";
import type { Prisma } from "@prisma/client";

/** Fields the live map needs for each business pin. */
export const MAP_POINT_SELECT = {
  id: true, name: true, latitude: true, longitude: true, category: true, city: true, region: true, website: true, phone: true, imageUrl: true,
  opportunityScore: true, websiteClass: true, websiteStatus: true, status: true, discoveredAt: true, rating: true, reviewCount: true, address: true,
} satisfies Prisma.BusinessSelect;

type Row = Prisma.BusinessGetPayload<{ select: typeof MAP_POINT_SELECT }>;

export const toPoint = (b: Row) => ({
  id: b.id, name: b.name, lat: b.latitude, lng: b.longitude, category: b.category, city: [b.city, b.region].filter(Boolean).join(", ") || null, address: b.address,
  website: b.website, phone: b.phone, imageUrl: b.imageUrl, score: b.opportunityScore, websiteClass: b.websiteClass ?? (b.websiteStatus === "NO_WEBSITE" ? "NO_WEBSITE" : null),
  status: b.status, rating: b.rating, reviews: b.reviewCount, discoveredAt: b.discoveredAt,
});
export type MapPoint = ReturnType<typeof toPoint>;
