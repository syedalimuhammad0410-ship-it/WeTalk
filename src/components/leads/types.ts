/* eslint-disable @typescript-eslint/no-explicit-any */
export type LeadData = {
  business: any;
  audit: any | null;
  opportunity: any | null;
  draft: any | null;
  messages: any[];
  conversations: any[];
  followUps: any[];
  notes: any[];
  activity: any[];
  statusHistory: any[];
  prompt: { id: string; title: string; currentVersion: number; qualityScore: number | null; updatedAt: string; latest: { version: number; qualityScore: number | null; wordCount: number; createdAt: string; generator: string; content: string } | null } | null;
  members: { id: string; name: string }[];
  templates: { id: string; name: string }[];
  campaigns: { id: string; name: string }[];
  allTags: string[];
  playbook: { id: string; label: string; primaryConversion: string; primaryGoal: string; features: { key: string; priority: string; name: string }[] };
  typeEvidence: string[];
  businessTypes: { id: string; label: string }[];
  allFeatures: { key: string; name: string }[];
  emailAccount: { provider: string; emailAddress: string } | null;
  sendBlocker: string | null;
};
export type LeadPerms = { edit: boolean; status: boolean; del: boolean; audit: boolean; prompt: boolean; compose: boolean; send: boolean; reverseDnc: boolean };
