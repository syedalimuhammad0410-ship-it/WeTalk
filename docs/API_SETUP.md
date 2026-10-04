# Google Places & PageSpeed setup

1. In Google Cloud Console create a project and enable **Places API (New)** (required) and **PageSpeed Insights API** (optional — adds Lighthouse scores to audits).
2. Create an API key. Restrict it to those APIs. For server use, restrict by IP if your host has static egress.
3. Add it in **Settings → Business Discovery & AI keys** (tested before saving, stored encrypted) or set `GOOGLE_MAPS_API_KEY`.

How it's used:
- `places:searchText` with field mask `places.id, displayName, formattedAddress, addressComponents, location, nationalPhoneNumber, internationalPhoneNumber, websiteUri, rating, userRatingCount, regularOpeningHours.weekdayDescriptions, businessStatus, types, primaryType, primaryTypeDisplayName, googleMapsUri, nextPageToken` — only what the product displays.
- Google returns ≤ 20 results per page and ≤ 60 per query; comma-separated search terms run as separate queries.
- Google does **not** provide email addresses. WebScout only records emails publicly listed on a business's own website (with the source URL) or entered by you with a source.
- Errors are explicit: quota exceeded, permission denied (API not enabled / key restricted), invalid key, malformed responses — with how many businesses were saved before the error.
- Review Google Maps Platform terms for caching rules; `place_id` may be stored indefinitely, other fields should be refreshed periodically (Settings → Data).
