import { TEMPLATE_VARIABLES } from "../../constants";

export type TemplateVars = Partial<Record<(typeof TEMPLATE_VARIABLES)[number], string>>;

/** Renders {{variable}} placeholders. Unknown variables are left visible so the user notices them. */
export function renderTemplate(tpl: string, vars: TemplateVars) {
  const missing = new Set<string>();
  const out = tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/g, (m, key: string) => {
    const v = vars[key as keyof TemplateVars];
    if (v === undefined || v === null || v === "") {
      missing.add(key);
      return m;
    }
    return v;
  });
  return { text: out, missing: Array.from(missing) };
}

export function extractVariables(tpl: string) {
  return Array.from(new Set(Array.from(tpl.matchAll(/\{\{\s*([a-z_]+)\s*\}\}/g)).map((m) => m[1]!)));
}

export function unknownVariables(tpl: string) {
  return extractVariables(tpl).filter((v) => !(TEMPLATE_VARIABLES as readonly string[]).includes(v));
}
