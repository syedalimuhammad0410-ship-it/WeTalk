#!/usr/bin/env node
/*
 * WebScout AI — Claude Desktop extension (local companion).
 * Bridges Claude Desktop's local MCP connection (stdio) to your WebScout workspace over HTTPS,
 * and tells WebScout that Claude Desktop is open on this computer. It has no tools of its own:
 * no shell, no file access — only the WebScout tools your workspace exposes.
 */
"use strict";
const readline = require("node:readline");
const os = require("node:os");

const VERSION = "1.0.0";
const LINK = (process.env.WEBSCOUT_CONNECTION_LINK || "").trim();
const log = (...a) => process.stderr.write(`[webscout] ${a.join(" ")}\n`);

function parseLink(link) {
  try {
    const u = new URL(link);
    const m = u.pathname.match(/\/api\/mcp\/(wsc_[A-Za-z0-9_-]{30,80})\/?$/);
    if (u.protocol !== "https:" && !/^(localhost|127\.0\.0\.1)$/.test(u.hostname)) return null;
    return m ? { endpoint: `${u.origin}/api/mcp`, heartbeat: `${u.origin}/api/claude/heartbeat`, token: m[1] } : null;
  } catch {
    return null;
  }
}
const target = parseLink(LINK);
const SETUP = "WebScout isn't set up yet: in Claude Desktop open Settings → Extensions → WebScout AI and paste your connection link (WebScout → Claude → Connect Claude).";

const write = (msg) => process.stdout.write(`${JSON.stringify(msg)}\n`);
const fail = (msg, code, message) => msg && msg.id !== undefined && write({ jsonrpc: "2.0", id: msg.id, error: { code, message } });

/** Without a link the extension still starts (so Claude can explain what to do) but offers no tools. */
function offline(msg) {
  if (msg.method === "initialize") return write({ jsonrpc: "2.0", id: msg.id, result: { protocolVersion: (msg.params && msg.params.protocolVersion) || "2025-06-18", capabilities: { tools: {} }, serverInfo: { name: "webscout-ai", version: VERSION }, instructions: SETUP } });
  if (msg.method === "tools/list") return write({ jsonrpc: "2.0", id: msg.id, result: { tools: [] } });
  if (msg.method === "ping") return write({ jsonrpc: "2.0", id: msg.id, result: {} });
  return fail(msg, -32001, SETUP);
}

async function forward(msg) {
  if (!target) return Array.isArray(msg) ? msg.forEach(offline) : offline(msg);
  try {
    const res = await fetch(target.endpoint, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json, text/event-stream", Authorization: `Bearer ${target.token}`, "User-Agent": `WebScout-Desktop-Extension/${VERSION}` },
      body: JSON.stringify(msg),
    });
    if (res.status === 202) return;
    const text = await res.text();
    let body;
    try {
      body = JSON.parse(text);
    } catch {
      return Array.isArray(msg) ? msg.forEach((m) => fail(m, -32603, `WebScout returned an unexpected response (HTTP ${res.status}).`)) : fail(msg, -32603, `WebScout returned an unexpected response (HTTP ${res.status}).`);
    }
    if (Array.isArray(body)) return write(body);
    if (!Array.isArray(msg) && msg.id !== undefined) write({ ...body, id: msg.id });
  } catch (e) {
    const m = `Couldn't reach WebScout (${e && e.message ? e.message : e}). Check your internet connection.`;
    if (Array.isArray(msg)) msg.forEach((x) => fail(x, -32603, m));
    else fail(msg, -32603, m);
  }
}

async function heartbeat() {
  if (!target) return;
  try {
    await fetch(target.heartbeat, { method: "POST", headers: { "Content-Type": "application/json", Authorization: `Bearer ${target.token}` }, body: JSON.stringify({ device: os.hostname().slice(0, 80), platform: process.platform, version: VERSION }) });
  } catch (e) {
    log("heartbeat failed:", e && e.message ? e.message : String(e));
  }
}

const rl = readline.createInterface({ input: process.stdin, crlfDelay: Infinity });
rl.on("line", (line) => {
  const t = line.trim();
  if (!t) return;
  let msg;
  try {
    msg = JSON.parse(t);
  } catch {
    return write({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } });
  }
  forward(msg);
});
rl.on("close", () => process.exit(0));

if (!target) log(LINK ? "The connection link doesn't look right." : "No connection link configured.", SETUP);
heartbeat();
setInterval(heartbeat, 60_000).unref();
