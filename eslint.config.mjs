import { FlatCompat } from "@eslint/eslintrc";

const compat = new FlatCompat({ baseDirectory: import.meta.dirname });

const eslintConfig = [
  {
    ignores: [
      ".next/**",
      ".next-stale-*/**",
      ".seq-backup-*/**",
      "node_modules/**",
      "next-env.d.ts",
      "public/**",
      "src/imports/**",
    ],
  },
  ...compat.extends("next/core-web-vitals", "next/typescript"),
];

export default eslintConfig;
