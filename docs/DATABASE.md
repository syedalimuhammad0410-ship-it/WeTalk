# Database

PostgreSQL via Prisma. Schema: `prisma/schema.prisma`; migrations: `prisma/migrations/`.

```bash
npx prisma migrate deploy      # apply migrations (production & CI)
npx prisma migrate dev         # create a new migration while developing
npx prisma studio              # browse data
```

Main tables: `User`, `Session`, `Workspace`, `WorkspaceMember`, `Invitation`, `CompanyProfile`, `AutomationSettings`, `ComplianceSettings`, `IntegrationCredential`, `EmailAccount`, `SuppressionEntry`, `Business` (leads), `Contact`, `LeadStatusChange`, `WebsiteAudit`, `WebsiteFinding`, `Opportunity`, `GeneratedPrompt`, `PromptVersion`, `EmailTemplate`, `Campaign`, `CampaignLead`, `Conversation`, `EmailMessage`, `AiResponseDraft`, `FollowUp`, `Tag`, `LeadTag`, `Note`, `Notification`, `ActivityLog`, `Job`, `SavedFilter`, `AiUsage`, `RateLimitBucket`.

All tenant data carries `workspaceId` with foreign keys (`ON DELETE CASCADE` from the workspace). Frequently-filtered columns are indexed, and trigram GIN indexes (`pg_trgm`) back global search.

### Supabase
Use the direct connection string for migrations. Because the app talks to Postgres from the server only, apply `prisma/sql/supabase-rls.sql` to enable Row Level Security with **no** policies for the `anon`/`authenticated` roles — this blocks Supabase's auto-generated REST/GraphQL APIs from exposing any table. See [SECURITY.md](SECURITY.md).

### Safety
Destructive operations are explicit: deleting a lead/campaign/conversation needs confirmation; bulk deletes require typing the exact count; deleting a workspace requires typing its name and the Owner role. Suppression (do-not-contact) entries survive lead deletion.
