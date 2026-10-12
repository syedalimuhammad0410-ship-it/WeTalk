import "../guard";

/**
 * Keeps discovery focused on small, independent local businesses (the ones a
 * website or simple software actually helps) and skips landmarks, attractions,
 * public institutions, big-box stores and national chains.
 */

/** Google place types that are never a small-business lead. */
const EXCLUDED_TYPES = new Set([
  // attractions & landmarks
  "tourist_attraction", "historical_landmark", "historical_place", "monument", "cultural_landmark", "observation_deck",
  "museum", "art_gallery", "aquarium", "zoo", "amusement_park", "water_park", "theme_park", "botanical_garden", "planetarium",
  "stadium", "arena", "sports_complex", "casino", "convention_center", "event_venue", "performing_arts_theater", "opera_house", "concert_hall", "movie_theater",
  "park", "national_park", "state_park", "city_park", "dog_park", "garden", "hiking_area", "beach", "marina", "ski_resort", "campground", "plaza", "bridge", "visitor_center",
  // transport & infrastructure
  "airport", "international_airport", "train_station", "transit_station", "bus_station", "subway_station", "light_rail_station", "ferry_terminal", "parking", "rest_stop", "gas_station", "electric_vehicle_charging_station",
  // public & institutional
  "city_hall", "local_government_office", "government_office", "courthouse", "embassy", "police", "fire_station", "post_office", "library",
  "hospital", "general_hospital", "university", "primary_school", "secondary_school", "school", "school_district",
  "church", "mosque", "synagogue", "hindu_temple", "place_of_worship", "cemetery",
  // big-box & corporate
  "shopping_mall", "department_store", "warehouse_store", "supermarket", "hypermarket", "bank", "atm", "wholesaler",
]);

/** National/international chains and franchises (matched on whole words at the start of the name). */
const CHAINS = [
  "tim hortons", "starbucks", "mcdonald's", "mcdonalds", "subway", "burger king", "wendy's", "a&w", "kfc", "popeyes", "harvey's", "dairy queen", "taco bell", "chipotle",
  "pizza pizza", "domino's", "pizza hut", "little caesars", "papa john's", "pizza nova", "241 pizza", "boston pizza", "swiss chalet", "the keg", "montana's", "east side mario's", "kelseys", "denny's", "applebee's", "olive garden", "mary brown's", "osmow's", "freshii", "second cup", "booster juice", "mr. sub", "mr sub", "quesada", "st-hubert", "five guys", "chick-fil-a", "panera",
  "walmart", "costco", "canadian tire", "home depot", "the home depot", "lowe's", "rona", "home hardware", "ikea", "best buy", "staples", "dollarama", "dollar tree", "giant tiger", "winners", "marshalls", "homesense", "sport chek", "indigo", "chapters", "the brick", "leon's", "sleep country", "structube",
  "shoppers drug mart", "rexall", "loblaws", "no frills", "metro", "sobeys", "food basics", "freshco", "fortinos", "zehrs", "real canadian superstore", "superstore", "farm boy", "longo's", "whole foods", "t&t supermarket", "lcbo", "the beer store", "beer store",
  "rbc", "royal bank", "td bank", "td canada trust", "bmo", "scotiabank", "cibc", "national bank", "desjardins", "tangerine",
  "petro-canada", "esso", "shell", "ultramar", "pioneer", "husky", "circle k", "couche-tard", "7-eleven", "mac's",
  "rogers", "bell", "telus", "fido", "koodo", "virgin plus", "freedom mobile", "the source",
  "h&r block", "great clips", "first choice haircutters", "supercuts", "fantastic sams", "midas", "mr. lube", "mr lube", "jiffy lube", "kal tire", "speedy auto", "active green + ross", "uniglobe",
  "pet valu", "petsmart", "petland", "goodlife fitness", "planet fitness", "anytime fitness", "orangetheory", "f45", "la fitness", "fit4less",
  "remax", "re/max", "royal lepage", "century 21", "coldwell banker", "sutton group", "keller williams", "exp realty",
  "marriott", "hilton", "holiday inn", "best western", "sheraton", "fairmont", "hyatt", "days inn", "comfort inn", "super 8", "travelodge", "westin", "ramada",
  "lifelabs", "dynacare", "apple", "sephora", "lululemon", "gap", "old navy", "h&m", "zara", "uniqlo", "nike", "adidas", "foot locker", "sport check",
  "u-haul", "enterprise rent-a-car", "budget car rental", "hertz", "avis", "national car rental", "canada post", "fedex", "ups store", "the ups store", "purolator",
];
const CHAIN_RE = new RegExp(`^(the\\s+)?(${CHAINS.map((c) => c.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")).join("|")})(\\b|\\s|$)`, "i");

/** Above this many Google reviews a place is almost always a landmark, chain flagship or large operation. */
export const MAX_SMALL_BUSINESS_REVIEWS = 1500;

export type SmallBusinessVerdict = { ok: true } | { ok: false; reason: string };

export function smallBusinessCheck(b: { name: string; types: string[]; reviewCount: number | null }): SmallBusinessVerdict {
  const excluded = b.types.find((t) => EXCLUDED_TYPES.has(t));
  if (excluded) return { ok: false, reason: `${excluded.replace(/_/g, " ")} (not a small business)` };
  const name = b.name.trim().replace(/[’‘]/g, "'");
  if (CHAIN_RE.test(name)) return { ok: false, reason: "national chain or franchise" };
  if ((b.reviewCount ?? 0) > MAX_SMALL_BUSINESS_REVIEWS) return { ok: false, reason: `${b.reviewCount} reviews (large business or attraction)` };
  return { ok: true };
}

/** Name without branch/location suffixes, used to spot chains with several locations in one search. */
export function brandKey(name: string) {
  return name.toLowerCase().replace(/[’‘]/g, "'").split(/\s[-–—|@(]\s?|\s+at\s+|,/)[0]!.replace(/[^a-z0-9& ]/g, "").replace(/\s+/g, " ").trim();
}
