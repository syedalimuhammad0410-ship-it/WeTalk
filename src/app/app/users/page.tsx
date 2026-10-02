"use client";
import { useEffect, useState } from "react";
import { Check, KeyRound, Lock, RefreshCw, ShieldOff, Trash2, UserCheck } from "lucide-react";
import { api } from "@/lib/client/api";
import { Button, Dialog, Empty, Panel, Spinner, Toggle, cn, inputCls } from "@/components/ui";

interface Account {
  email: string;
  name: string;
  status: "pending" | "active" | "disabled";
  createdAt: string;
  approvedAt?: string;
  lastLoginAt?: string;
  loginCount: number;
}
interface LoginEvent {
  at: string;
  email: string;
  ok: boolean;
  reason?: string;
  ip: string;
  userAgent: string;
}

const fmt = (s?: string) => (s ? new Date(s).toLocaleString() : "—");

export default function UsersPage() {
  const [data, setData] = useState<{ accounts: Account[]; logins: LoginEvent[]; settings: { requireApproval: boolean; allowSignups: boolean } } | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [pw, setPw] = useState<{ email: string; value: string } | null>(null);
  const [confirmDel, setConfirmDel] = useState<string | null>(null);
  const load = () =>
    api
      .get<NonNullable<typeof data>>("/api/admin/users")
      .then(setData)
      .catch((e) => setError(e.message));
  useEffect(() => {
    void load();
  }, []);
  const act = async (body: Record<string, unknown>) => {
    try {
      await api.post("/api/admin/users", body);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };
  if (error && !data) return <Empty title="Users">{error}</Empty>;
  if (!data)
    return (
      <div className="grid flex-1 place-items-center">
        <Spinner />
      </div>
    );
  const pending = data.accounts.filter((a) => a.status === "pending");
  return (
    <div className="flex-1 overflow-y-auto">
      <div className="mx-auto max-w-6xl space-y-5 px-5 py-8 md:px-8">
        <div className="flex items-end justify-between">
          <div>
            <div className="label-mono text-cyan">Owner</div>
            <h1 className="mt-1 text-[26px] font-semibold tracking-tight">Users & sign-ins</h1>
            <p className="text-[12.5px] text-mute">
              {data.accounts.length} accounts · {pending.length} waiting for approval
            </p>
          </div>
          <Button onClick={load}>
            <RefreshCw className="size-4" /> Refresh
          </Button>
        </div>
        {error && <div className="rounded border border-alert/30 bg-alert/10 px-3 py-2 text-[13px] text-alert">{error}</div>}

        <Panel title="Sign-up settings">
          <div className="grid gap-3 p-4 sm:grid-cols-2">
            <Toggle label="Allow people to create accounts" checked={data.settings.allowSignups} onChange={(v) => act({ action: "settings", allowSignups: v })} />
            <Toggle label="New accounts need my approval" checked={data.settings.requireApproval} onChange={(v) => act({ action: "settings", requireApproval: v })} />
          </div>
        </Panel>

        <Panel title="Accounts">
          {!data.accounts.length ? (
            <div className="p-4 text-[13px] text-mute">No one has created an account yet. People can sign up at /signup.</div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-[12.5px]">
                <thead className="text-left text-mute">
                  <tr className="border-b border-line">
                    <th className="px-4 py-2 font-normal">Name</th>
                    <th className="px-2 font-normal">Email</th>
                    <th className="px-2 font-normal">Password</th>
                    <th className="px-2 font-normal">Status</th>
                    <th className="px-2 font-normal">Signed up</th>
                    <th className="px-2 font-normal">Last sign-in</th>
                    <th className="px-2 font-normal">Sign-ins</th>
                    <th className="px-2 font-normal" />
                  </tr>
                </thead>
                <tbody>
                  {data.accounts.map((a) => (
                    <tr key={a.email} className="border-b border-line/60">
                      <td className="px-4 py-2 font-medium">{a.name}</td>
                      <td className="px-2 font-mono">{a.email}</td>
                      <td className="px-2 text-mute" title="Passwords are stored as one-way hashes and cannot be viewed. Use 'Set password' to give the user a new one.">
                        <span className="inline-flex items-center gap-1">
                          <Lock className="size-3" /> encrypted
                        </span>
                      </td>
                      <td className="px-2">
                        <span className={cn("label-mono rounded-[3px] px-1.5 py-0.5 !text-[9px]", a.status === "active" ? "bg-ok/10 text-ok" : a.status === "pending" ? "bg-warn/10 text-warn" : "bg-alert/10 text-alert")}>{a.status}</span>
                      </td>
                      <td className="px-2 text-dim">{fmt(a.createdAt)}</td>
                      <td className="px-2 text-dim">{fmt(a.lastLoginAt)}</td>
                      <td className="px-2">{a.loginCount}</td>
                      <td className="px-2 py-1.5">
                        <div className="flex justify-end gap-0.5">
                          {a.status !== "active" && (
                            <Button size="sm" variant="ghost" onClick={() => act({ action: a.status === "pending" ? "approve" : "enable", email: a.email })} title="Approve / enable">
                              <UserCheck className="size-3.5 text-ok" /> {a.status === "pending" ? "Approve" : "Enable"}
                            </Button>
                          )}
                          {a.status === "active" && (
                            <Button size="sm" variant="ghost" onClick={() => act({ action: "disable", email: a.email })} title="Disable">
                              <ShieldOff className="size-3.5 text-warn" /> Disable
                            </Button>
                          )}
                          <Button size="sm" variant="ghost" onClick={() => setPw({ email: a.email, value: "" })} title="Set a new password">
                            <KeyRound className="size-3.5" /> Set password
                          </Button>
                          <Button size="sm" variant="ghost" onClick={() => setConfirmDel(a.email)} title="Delete account">
                            <Trash2 className="size-3.5 text-alert" />
                          </Button>
                        </div>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </Panel>

        <Panel title="Recent sign-in activity">
          <ul className="max-h-[420px] divide-y divide-line overflow-y-auto text-[12px]">
            {!data.logins.length && <li className="px-4 py-3 text-mute">No sign-ins recorded yet.</li>}
            {data.logins.map((l, i) => (
              <li key={i} className="flex flex-wrap items-center gap-x-4 gap-y-0.5 px-4 py-1.5">
                <span className="w-40 shrink-0 text-mute">{fmt(l.at)}</span>
                <span className={cn("w-16 shrink-0 font-medium", l.ok ? "text-ok" : "text-alert")}>{l.ok ? "success" : "failed"}</span>
                <span className="min-w-[200px] flex-1 font-mono">{l.email}</span>
                {!l.ok && <span className="text-warn">{l.reason}</span>}
                <span className="font-mono text-mute">{l.ip}</span>
                <span className="hidden max-w-[260px] truncate text-mute lg:inline">{l.userAgent}</span>
              </li>
            ))}
          </ul>
        </Panel>
        <p className="pb-6 text-[11.5px] text-mute">For security, passwords are stored only as one-way (scrypt) hashes and can never be displayed, not even to the owner. If someone forgets theirs, use “Set password” and send them the new one.</p>
      </div>

      <Dialog open={Boolean(pw)} onClose={() => setPw(null)} title={`Set a new password for ${pw?.email}`}>
        <input type="text" autoComplete="off" value={pw?.value || ""} onChange={(e) => setPw((p) => (p ? { ...p, value: e.target.value } : p))} placeholder="New password (min 8 characters)" className={inputCls} />
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setPw(null)}>
            Cancel
          </Button>
          <Button
            variant="primary"
            disabled={(pw?.value.length || 0) < 8}
            onClick={async () => {
              await act({ action: "set-password", email: pw!.email, password: pw!.value });
              setPw(null);
            }}
          >
            <Check className="size-4" /> Save password
          </Button>
        </div>
      </Dialog>
      <Dialog open={Boolean(confirmDel)} onClose={() => setConfirmDel(null)} title="Delete account?">
        <p className="text-[13.5px] text-dim">{confirmDel} will lose access immediately.</p>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" onClick={() => setConfirmDel(null)}>
            Cancel
          </Button>
          <Button
            variant="danger"
            onClick={async () => {
              await act({ action: "delete", email: confirmDel });
              setConfirmDel(null);
            }}
          >
            Delete
          </Button>
        </div>
      </Dialog>
    </div>
  );
}
