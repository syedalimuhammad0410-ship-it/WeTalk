# Deployment

Any Node host (Vercel, Render, Fly.io, Railway, a VM) + PostgreSQL.

```bash
npm ci
npx prisma migrate deploy
npm run build
npm start                      # PORT defaults to 3000
```

Checklist
- Set `APP_URL` to the public HTTPS URL and a strong `APP_ENCRYPTION_KEY`.
- Never set `AUDIT_ALLOW_PRIVATE_HOSTS` in production.
- Consider `ENABLE_EMAIL_SANDBOX=false`.
- Serverless platforms (e.g. Vercel) don't keep a process alive: set `JOB_RUNNER=external` and run `npm run worker` on a small always-on instance (or container) pointing at the same database.
- Configure Gmail OAuth redirect URI / Postmark inbound webhook with the production `APP_URL`.
- Back up the database (point-in-time recovery recommended).
