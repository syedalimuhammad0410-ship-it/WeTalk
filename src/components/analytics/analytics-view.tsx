"use client";
/* eslint-disable @typescript-eslint/no-explicit-any */
import { useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { Bar, BarChart, CartesianGrid, Legend, Line, LineChart, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Table2, LineChart as LineIcon } from "lucide-react";
import { Card, CardHeader, Stat, EmptyState } from "../ui/misc";
import { Tabs } from "../ui/tabs";
import { Input, Select } from "../ui/form";
import { Button } from "../ui/button";
import { formatNumber, formatPercent } from "@/lib/utils";
import { INTENT_META } from "@/lib/constants";

const S1 = "var(--series-1)", S2 = "var(--series-2)", S3 = "var(--series-3)";
const axis = { stroke: "rgb(var(--faint))", fontSize: 12, tickLine: false, axisLine: false } as const;

function ChartTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-lg border border-border bg-surface px-3 py-2 text-xs shadow-pop">
      <div className="mb-1 font-medium">{label}</div>
      {payload.map((p: any) => (
        <div key={p.dataKey} className="flex items-center gap-2 text-muted"><span className="h-2 w-2 rounded-full" style={{ background: p.color }} aria-hidden />{p.name}<span className="ml-auto pl-3 font-medium tabular-nums text-fg">{formatNumber(p.value)}</span></div>
      ))}
    </div>
  );
}

function ChartCard({ title, description, table, children, empty }: { title: string; description?: string; table: { head: string[]; rows: (string | number)[][] }; children: React.ReactNode; empty?: boolean }) {
  const [asTable, setAsTable] = useState(false);
  return (
    <Card>
      <CardHeader title={title} description={description} action={<Button size="sm" variant="ghost" onClick={() => setAsTable((v) => !v)} aria-pressed={asTable}>{asTable ? <LineIcon className="h-4 w-4" /> : <Table2 className="h-4 w-4" />}{asTable ? "Chart" : "Table"}</Button>} />
      <div className="p-4">
        {empty ? <EmptyState title="No data in this period" /> : asTable ? (
          <div className="max-h-72 overflow-auto"><table className="table-base"><thead><tr>{table.head.map((h) => <th key={h}>{h}</th>)}</tr></thead><tbody>{table.rows.map((r, i) => <tr key={i}>{r.map((c, j) => <td key={j} className={j ? "text-right tabular-nums" : ""}>{c}</td>)}</tr>)}</tbody></table></div>
        ) : <div className="h-72">{children}</div>}
      </div>
    </Card>
  );
}

export function AnalyticsView({ data, responses, range, from, to, initialTab }: { data: any; responses: any; range: string; from: string; to: string; initialTab: "overview" | "responses" }) {
  const router = useRouter();
  const pathname = usePathname();
  const [tab, setTab] = useState(initialTab);
  const [f, setF] = useState(from);
  const [t, setT] = useState(to);
  const go = (q: string) => router.push(`${pathname}?${q}&tab=${tab}`);
  const r = data.rates;
  const series = data.series.map((d: any) => ({ ...d, day: d.day.slice(5) }));
  const hasActivity = series.some((d: any) => d.sent || d.responses);

  return (
    <div className="space-y-5">
      <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <Tabs value={tab} onChange={(v) => setTab(v)} tabs={[{ id: "overview" as const, label: "Overview" }, { id: "responses" as const, label: "Responses" }]} className="border-0" />
        <div className="flex flex-wrap items-center gap-2" role="group" aria-label="Date range">
          <Select value={range} onChange={(e) => e.target.value !== "custom" && go(`range=${e.target.value}`)} className="h-9 w-auto py-1" aria-label="Preset range">
            <option value="7">Last 7 days</option><option value="30">Last 30 days</option><option value="90">Last 90 days</option><option value="365">Last 12 months</option><option value="custom">Custom</option>
          </Select>
          <Input type="date" value={f} onChange={(e) => setF(e.target.value)} className="h-9 w-auto" aria-label="From" />
          <Input type="date" value={t} onChange={(e) => setT(e.target.value)} className="h-9 w-auto" aria-label="To" />
          <Button size="sm" variant="outline" onClick={() => go(`from=${f}&to=${t}`)}>Apply</Button>
        </div>
      </div>

      {tab === "overview" ? (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Rates">
            <Stat label="Lead generation" value={`${r.leadGenerationPerDay.toFixed(1)}/day`} hint={`${formatNumber(data.totals.leads)} leads`} />
            <Stat label="Website opportunity rate" value={formatPercent(r.websiteOpportunityRate)} hint="Opp ≥ 70 of scored leads" />
            <Stat label="Email delivery rate" value={formatPercent(r.deliveryRate)} hint={`${data.totals.emailsSent} sent · ${data.totals.failed} failed`} />
            <Stat label="Response rate" value={formatPercent(r.responseRate)} hint={`${data.totals.replied}/${data.totals.contacted} contacted`} />
            <Stat label="Positive response rate" value={formatPercent(r.positiveResponseRate)} />
            <Stat label="Meeting rate" value={formatPercent(r.meetingRate)} hint={`${data.totals.meetings} meetings`} />
            <Stat label="Conversion rate" value={formatPercent(r.conversionRate)} hint={`${data.totals.won} won`} />
            <Stat label="Avg response time" value={r.avgResponseHours == null ? "—" : r.avgResponseHours < 48 ? `${r.avgResponseHours.toFixed(1)}h` : `${(r.avgResponseHours / 24).toFixed(1)}d`} />
            <Stat label="Average lead score" value={r.avgLeadScore == null ? "—" : Math.round(r.avgLeadScore)} />
            <Stat label="Websites analyzed" value={formatNumber(data.totals.audits)} />
          </section>
          <div className="grid gap-5 xl:grid-cols-2">
            <ChartCard title="Outreach over time" description="Emails sent, responses and interested replies per day" empty={!hasActivity} table={{ head: ["Day", "Sent", "Responses", "Interested"], rows: data.series.map((d: any) => [d.day, d.sent, d.responses, d.interested]) }}>
              <ResponsiveContainer><LineChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="day" {...axis} minTickGap={24} /><YAxis {...axis} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgb(var(--faint))", strokeDasharray: "3 3" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="sent" name="Sent" stroke={S1} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "rgb(var(--surface))" }} />
                <Line type="monotone" dataKey="responses" name="Responses" stroke={S2} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "rgb(var(--surface))" }} />
                <Line type="monotone" dataKey="interested" name="Interested" stroke={S3} strokeWidth={2} dot={false} activeDot={{ r: 5, strokeWidth: 2, stroke: "rgb(var(--surface))" }} />
              </LineChart></ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Responses by business type" description="Businesses contacted vs. businesses that replied" empty={!data.byCategory.length} table={{ head: ["Type", "Contacted", "Replied"], rows: data.byCategory.map((c: any) => [c.category, c.contacted, c.responses]) }}>
              <ResponsiveContainer><BarChart data={data.byCategory.slice(0, 10)} margin={{ top: 8, right: 8, left: -16, bottom: 0 }} barGap={2}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="category" {...axis} interval={0} tickFormatter={(v: string) => (v.length > 12 ? `${v.slice(0, 11)}…` : v)} /><YAxis {...axis} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgb(var(--subtle))" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="contacted" name="Contacted" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={28} />
                <Bar dataKey="responses" name="Replied" fill={S2} radius={[4, 4, 0, 0]} maxBarSize={28} />
              </BarChart></ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Responses by campaign" empty={!data.byCampaign.length} table={{ head: ["Campaign", "Contacted", "Replied"], rows: data.byCampaign.map((c: any) => [c.name, c.contacted, c.responses]) }}>
              <ResponsiveContainer><BarChart data={data.byCampaign} layout="vertical" margin={{ top: 8, right: 16, left: 8, bottom: 0 }} barGap={2}>
                <CartesianGrid horizontal={false} stroke="var(--grid)" />
                <XAxis type="number" {...axis} allowDecimals={false} /><YAxis type="category" dataKey="name" {...axis} width={120} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgb(var(--subtle))" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Bar dataKey="contacted" name="Contacted" fill={S1} radius={[0, 4, 4, 0]} maxBarSize={20} />
                <Bar dataKey="responses" name="Replied" fill={S2} radius={[0, 4, 4, 0]} maxBarSize={20} />
              </BarChart></ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Conversion funnel" description="Unique businesses at each stage in this period" empty={!data.totals.contacted} table={{ head: ["Stage", "Businesses"], rows: [["Contacted", data.totals.contacted], ["Replied", data.totals.replied], ["Positive", data.totals.positive], ["Meeting", data.totals.meetings], ["Won", data.totals.won]] }}>
              <ResponsiveContainer><BarChart data={[{ s: "Contacted", n: data.totals.contacted }, { s: "Replied", n: data.totals.replied }, { s: "Positive", n: data.totals.positive }, { s: "Meeting", n: data.totals.meetings }, { s: "Won", n: data.totals.won }]} margin={{ top: 16, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="s" {...axis} /><YAxis {...axis} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgb(var(--subtle))" }} />
                <Bar dataKey="n" name="Businesses" fill={S1} radius={[4, 4, 0, 0]} maxBarSize={48} label={{ position: "top", fontSize: 12, fill: "rgb(var(--muted))" }} />
              </BarChart></ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      ) : (
        <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5" aria-label="Response metrics">
            <Stat label="Total responses" value={formatNumber(responses.total)} href="/inbox" />
            <Stat label="Response rate" value={formatPercent(responses.responseRate)} />
            <Stat label="Interested" value={formatNumber(responses.interested)} href="/inbox?section=interested" />
            <Stat label="Not interested" value={formatNumber(responses.notInterested)} />
            <Stat label="Questions" value={formatNumber(responses.questions)} />
            <Stat label="Meetings requested" value={formatNumber(responses.meetings)} />
            <Stat label="AI drafts" value={formatNumber(responses.aiDrafts)} />
            <Stat label="Awaiting approval" value={formatNumber(responses.awaitingApproval)} href="/inbox?section=draft" />
            <Stat label="Human review required" value={formatNumber(responses.humanReview)} href="/inbox?section=review" />
          </section>
          <div className="grid gap-5 xl:grid-cols-2">
            <ChartCard title="Responses over time" empty={!hasActivity} table={{ head: ["Day", "Responses", "Interested"], rows: data.series.map((d: any) => [d.day, d.responses, d.interested]) }}>
              <ResponsiveContainer><LineChart data={series} margin={{ top: 8, right: 8, left: -16, bottom: 0 }}>
                <CartesianGrid vertical={false} stroke="var(--grid)" />
                <XAxis dataKey="day" {...axis} minTickGap={24} /><YAxis {...axis} allowDecimals={false} />
                <Tooltip content={<ChartTooltip />} cursor={{ stroke: "rgb(var(--faint))", strokeDasharray: "3 3" }} />
                <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 12 }} />
                <Line type="monotone" dataKey="responses" name="Responses" stroke={S1} strokeWidth={2} dot={false} />
                <Line type="monotone" dataKey="interested" name="Interested leads" stroke={S2} strokeWidth={2} dot={false} />
              </LineChart></ResponsiveContainer>
            </ChartCard>
            <ChartCard title="Reply intents" description="How replies in this period were classified" empty={!Object.keys(data.intents).length} table={{ head: ["Intent", "Replies"], rows: Object.entries(data.intents).map(([k, v]) => [INTENT_META[k]?.label ?? k, v as number]) }}>
              <ResponsiveContainer><BarChart data={Object.entries(data.intents).map(([k, v]) => ({ k: INTENT_META[k]?.label ?? k, n: v })).sort((a: any, b: any) => b.n - a.n)} layout="vertical" margin={{ top: 8, right: 24, left: 8, bottom: 0 }}>
                <CartesianGrid horizontal={false} stroke="var(--grid)" />
                <XAxis type="number" {...axis} allowDecimals={false} /><YAxis type="category" dataKey="k" {...axis} width={120} />
                <Tooltip content={<ChartTooltip />} cursor={{ fill: "rgb(var(--subtle))" }} />
                <Bar dataKey="n" name="Replies" fill={S1} radius={[0, 4, 4, 0]} maxBarSize={18} label={{ position: "right", fontSize: 12, fill: "rgb(var(--muted))" }} />
              </BarChart></ResponsiveContainer>
            </ChartCard>
          </div>
        </>
      )}
    </div>
  );
}
