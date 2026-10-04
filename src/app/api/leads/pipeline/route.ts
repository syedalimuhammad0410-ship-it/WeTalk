import { api, parseQuery } from "@/lib/server/api";
import { LeadFilters, pipelineColumns } from "@/lib/server/queries";

export const GET = api({}, async (req, ctx) => pipelineColumns(ctx.workspace.id, parseQuery(req, LeadFilters)));
