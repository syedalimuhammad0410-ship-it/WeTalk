# Connecting Claude to WebScout

WebScout's **Claude Command Centre** (`/claude`) lets you queue research tasks that Claude carries out with
**your own Claude plan** (no API key), then sends real, sourced results back into your CRM.

## How it works

```
WebScout (command centre, CRM, checks)  ⇄  MCP over HTTPS  ⇄  Claude (Desktop or claude.ai)
                                                                  └─ web search / computer use
```

1. You create a task in WebScout → Claude (e.g. "Find 10 bakeries in Mississauga with no website").
2. In Claude you say **"Run my next WebScout task"**. Claude calls `get_next_task` and gets a full brief.
3. Claude researches public sources and reports back with `submit_businesses`, `submit_contacts`,
   `submit_facts`, `create_email_draft`, `report_progress` and `complete_task`.
4. WebScout validates everything, shows it live (activity feed + map), and audits new websites.

## Connecting (once)

Create a link in **WebScout → Claude → Connect Claude**. Then either:

- **Custom connector (recommended, no install):** Claude → Settings → Connectors → *Add custom connector* →
  name `WebScout AI`, URL = your link, no sign-in. Works in Claude Desktop and claude.ai.
- **Desktop extension (local companion):** download `webscout-ai.mcpb` from the same dialog, double-click it
  (or Claude Desktop → Settings → Extensions → install from file) and paste the link. Claude Desktop keeps
  the link in the OS secure store (Credential Manager / Keychain). While Claude Desktop is open the
  extension checks in every minute, so the Command Centre shows "Desktop open".

Optional: enable **computer use** in Claude Desktop so Claude can browse sites on your PC.
Claude Desktop must stay open (and the PC awake) while it works.

## Safety model

- The link is a secret token; only its SHA-256 hash is stored. Remove a connection to revoke it instantly.
- Every tool is limited to the one workspace the link belongs to.
- **Research** (public sites) and **internal changes** (leads, facts, drafts) are allowed and logged.
  **External actions are never performed by Claude**: emails are saved as drafts that a person approves
  and sends from WebScout (CASL checks, sender identity, mailing address and unsubscribe link included).
- Businesses need a source URL; duplicates are detected; chains/landmarks are rejected for small-business
  tasks; plan lead limits apply.
- Emails are saved only if WebScout finds them on the cited page; then CASL eligibility is evaluated.
- Facts are labelled `FACT` (with source; short values are checked on the page) or `ESTIMATE`.
  Revenue is only accepted from a public source.
- Retried submissions with the same `idempotency_key` return the first result (no duplicate leads).
- **Emergency stop** (Command Centre) or "pause all automation" makes every Claude tool call refuse work
  until resumed; individual tasks can be paused or cancelled the same way.

## Endpoints

| Path | Purpose |
|---|---|
| `POST /api/mcp/<token>` | MCP server (Streamable HTTP, stateless JSON) for custom connectors |
| `POST /api/mcp` + `Authorization: Bearer <token>` | Same server, token in a header (desktop extension) |
| `POST /api/claude/heartbeat` | Desktop extension check-in |
| `GET /api/claude/extension` | Download `webscout-ai.mcpb` (built from `companion/`) |
| `/api/claude`, `/api/claude/tasks`, `/api/claude/tasks/:id`, `/api/claude/connections` | Command Centre |
