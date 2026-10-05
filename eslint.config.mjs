import { FlatCompat } from "@eslint/eslintrc";
const compat = new FlatCompat({ baseDirectory: import.meta.dirname });
export default [
  { ignores: [".next/**", "node_modules/**", "test-results/**", "*[1].*", "next-env.d.ts"] },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];
