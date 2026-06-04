# Immersive Parallax App

This is a code bundle for Immersive Parallax App, converted to **Next.js (App Router)**. The original design is available at https://www.figma.com/design/QI4gsiO0Jqo5EG2JE2Bn27/Immersive-Parallax-App.

## Running the code

Install dependencies:

```bash
npm install
```

Start the dev server:

```bash
npm run dev
```

Build for production:

```bash
npm run build
npm start
```

## Project layout

- `app/` – Next.js App Router (root layout + page).
- `src/components/` – React components, including the shadcn/ui set and the `ImmersiveParallax` client component.
- `src/imports/` – Generated Figma assets (SVGs, images).
- `src/styles/` – Global styles, Tailwind v4 entry, theme variables, fonts.
