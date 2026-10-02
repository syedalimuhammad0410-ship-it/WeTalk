import "server-only";
import { z } from "zod";

export const CandidateBody = z.object({
  entities: z.array(z.object({ id: z.string().max(64), name: z.string().max(200), type: z.string().max(40), wikidataId: z.string().regex(/^Q\d+$/).optional(), matchQuality: z.string().max(20) })).max(60),
  texts: z.array(z.object({ text: z.string().max(300), confidence: z.number().min(0).max(100), origin: z.enum(["ocr", "ai", "cloud-vision", "user", "logo"]), clueId: z.string().max(64).optional() })).max(200),
  sceneHints: z.array(z.string().max(40)).max(20),
  exif: z.object({ lat: z.number().min(-90).max(90).optional(), lng: z.number().min(-180).max(180).optional(), takenAt: z.string().max(40).optional() }).optional(),
  landmarks: z.array(z.object({ name: z.string().max(200), lat: z.number().optional(), lng: z.number().optional(), score: z.number() })).max(10).optional(),
  mode: z.string().max(30),
  maxCandidates: z.number().int().min(1).max(20).optional(),
});
