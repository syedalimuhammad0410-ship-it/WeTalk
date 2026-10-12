# Email setup

WebScout never stores email passwords.

## Gmail (OAuth 2.0)
1. Google Cloud → enable **Gmail API**; configure the OAuth consent screen (scopes `gmail.send`, `gmail.readonly`, `openid`, `email`).
2. Create an OAuth client (Web). Authorized redirect URI: `${APP_URL}/api/auth/google/callback`.
3. Set `GOOGLE_CLIENT_ID` and `GOOGLE_CLIENT_SECRET`, restart.
4. Settings → Email → **Gmail**. Tokens are encrypted; refresh tokens are used automatically. Replies are polled about every 2 minutes (or **Check inbox**).

## Postmark
1. Create a server and a verified sender signature/domain.
2. Settings → Email → **Postmark**: from address, display name, server API token (encrypted).
3. Copy the inbound webhook URL shown once after connecting into Postmark → Inbound → Webhook. The URL contains a secret token (stored hashed).
4. Optional: enter your Postmark inbound address (e.g. `abc123@inbound.postmarkapp.com`). Outgoing mail then uses `Reply-To: abc123+<conversationId>@…` so replies match their conversation exactly.

## Sandbox
For development and demos: messages are stored and shown with a SANDBOX badge but **never delivered**; conversations offer **Simulate reply** to exercise the full reply pipeline. Disable with `ENABLE_EMAIL_SANDBOX=false`.

## Compliance controls (Settings → Compliance)
Daily/hourly limits, minimum minutes between sends, minimum days between contacts with the same business, maximum follow-ups, unsubscribe line, physical mailing address (CAN-SPAM/CASL), optional AI-assistance disclosure, blocking cold outreach to free personal email domains, and the suppression list. These are enforced inside the single send path for manual, bulk, follow-up and automatic emails, under a Postgres advisory lock so concurrent sends cannot exceed limits.

## Spam and unrelated email (Inbox → Filtered)

WebScout only fills your inbox with email related to your agency:

1. **Always kept:**
   - replies in threads WebScout sent (tracking hash, In-Reply-To, References, Gmail thread)
   - email from a lead's address or website domain
   - email from any address or company domain you've emailed before
2. **Skipped at the source:** Gmail's Promotions, Social and Forums tabs are never imported.
3. **Rules:**
   - Mailing-list or newsletter headers, no-reply or notification senders, receipts, security codes and sales email are filtered.
   - Email mentioning your company or name, or a reply about websites, is kept.
4. **AI:** anything still unclear is read by the connected AI (Gemini or Claude). It decides from text clues whether the email relates to your agency. An email is filtered only when the AI is at least 60% sure it's unrelated.
5. **Fallback:** if no AI is connected and the email is unclear, it's kept for review.

Filtered email appears under **Inbox → Filtered (not related)**, with the reason. It isn't analysed or answered and doesn't trigger notifications. Use **Move to inbox** to restore an email, which then gets analysed, or **Not related** to file one manually. **Clean up inbox** re-checks existing unmatched conversations that contain nothing you sent.
