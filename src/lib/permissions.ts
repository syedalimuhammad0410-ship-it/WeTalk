// Role → permission matrix. Shared by server enforcement and client UI hints.
// The server is the source of truth; the client only hides controls.

export type RoleT = "OWNER" | "ADMIN" | "MEMBER" | "VIEWER";

export type Permission =
  | "leads.view"
  | "leads.edit"
  | "leads.changeStatus"
  | "leads.delete"
  | "leads.export"
  | "discovery.run"
  | "audits.run"
  | "prompts.edit"
  | "emails.compose"
  | "emails.send"
  | "drafts.approve"
  | "automation.manage"
  | "autoReplies.enable"
  | "integrations.manage"
  | "compliance.manage"
  | "users.manage"
  | "campaigns.manage"
  | "templates.manage"
  | "workspace.delete"
  | "doNotContact.reverse";

const VIEWER: Permission[] = ["leads.view"];
const MEMBER: Permission[] = [
  ...VIEWER,
  "leads.edit",
  "leads.changeStatus",
  "discovery.run",
  "audits.run",
  "prompts.edit",
  "emails.compose",
  "emails.send",
  "drafts.approve",
  "campaigns.manage",
  "templates.manage",
];
const ADMIN: Permission[] = [
  ...MEMBER,
  "leads.delete",
  "leads.export",
  "automation.manage",
  "autoReplies.enable",
  "integrations.manage",
  "compliance.manage",
  "users.manage",
  "doNotContact.reverse",
];
const OWNER: Permission[] = [...ADMIN, "workspace.delete"];

export const ROLE_PERMISSIONS: Record<RoleT, ReadonlySet<Permission>> = {
  VIEWER: new Set(VIEWER),
  MEMBER: new Set(MEMBER),
  ADMIN: new Set(ADMIN),
  OWNER: new Set(OWNER),
};

export const can = (role: RoleT | null | undefined, p: Permission) => (role ? ROLE_PERMISSIONS[role].has(p) : false);

export const ROLE_LABEL: Record<RoleT, string> = {
  OWNER: "Owner",
  ADMIN: "Admin",
  MEMBER: "Member",
  VIEWER: "Viewer",
};
