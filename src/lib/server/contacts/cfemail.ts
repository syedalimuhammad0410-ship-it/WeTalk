/**
 * Cloudflare "email protection" hides published addresses as hex (data-cfemail / #hex links) and browsers
 * decode them on load. Decoding them here lets us read what any visitor sees — it is not bypassing anything.
 */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^\s@<>"]+@[^\s@<>"]+\.[a-z]{2,}$/i.test(out) ? out : null;
}

/** Replaces Cloudflare-protected addresses in a page with the plain addresses a browser would show. */
export function revealCloudflareEmails(html: string): string {
  if (!/cfemail|email-protection#/i.test(html)) return html;
  return html
    .replace(/<(a|span)\b[^>]*\bdata-cfemail="([0-9a-f]+)"[^>]*>[\s\S]*?<\/\1>/gi, (m, _tag: string, hex: string) => decodeCfEmail(hex) ?? m)
    .replace(/\/cdn-cgi\/l\/email-protection#([0-9a-f]+)/gi, (m, hex: string) => {
      const email = decodeCfEmail(hex);
      return email ? `mailto:${email}` : m;
    });
}
