/**
 * PostCSS Configuration
 *
 * Tailwind CSS v4 is wired up here via `@tailwindcss/postcss` so Next.js
 * can compile Tailwind styles without a Vite plugin.
 */
const postcssConfig = {
  plugins: {
    "@tailwindcss/postcss": {},
  },
};

export default postcssConfig;
