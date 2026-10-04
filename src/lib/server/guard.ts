// Imported by every server module. Fails loudly if server code (and therefore
// secrets or database access) is ever bundled into browser JavaScript.
if (typeof window !== "undefined") {
  throw new Error("Server-only module imported in the browser. This is a security bug.");
}
export {};
