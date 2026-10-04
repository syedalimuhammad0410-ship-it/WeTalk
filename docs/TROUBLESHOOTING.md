# Troubleshooting

| Symptom | Fix |
|---|---|
| “Connect … to enable this feature” | Add the integration in Settings (Business Discovery & AI keys, or Email) |
| “APP_ENCRYPTION_KEY is missing…” | Set a ≥ 32-character key and restart |
| Discovery: “quota exceeded” / “denied” | Check billing/quota and that **Places API (New)** is enabled for the key |
| Audit result “Manual review / Blocked” | The site disallows bots (robots.txt), shows a CAPTCHA/login or refused the request. WebScout does not bypass this — review manually |
| Gmail: “access was revoked or expired” | Reconnect Gmail in Settings → Email |
| Jobs stay “Queued” | No runner: with `JOB_RUNNER=external` start `npm run worker`; see Admin → System health |
| Emails not sending: “limit reached” / “Minimum delay” | Settings → Compliance limits; bulk sends wait automatically |
| Reply not matched to a lead | Open the conversation and use **Link to lead**; for Postmark set the inbound address for exact matching |
| Prompt quality < 85 | Usually missing business information; the notes on the version explain which dimensions are weak |
