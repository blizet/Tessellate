# Tessellate

Tessellate is a Next.js app for generating packaging dielines and previewing them as interactive 3D mockups.

Contributors can use this README to install dependencies, configure local environment variables, and run the app.

## Requirements

- Node.js 20 or newer
- npm

## Setup

Install dependencies:

```bash
npm install
```

Create a local environment file:

```bash
cp .env.example .env.local
```

If `.env.example` does not exist, create `.env.local` manually with:

```bash
GEMINI_API_KEY=your_api_key_here
GEMINI_IMAGE_MODEL=gemini-3.1-flash-image-preview
```

`GEMINI_API_KEY` is optional for basic local UI work. Without it, the app can still fall back to a placeholder dieline.

## Run Locally

Start the dev server:

```bash
npm run dev
```

Open:

```text
http://localhost:3000
```

## Useful Commands

Run lint:

```bash
npm run lint
```

Create a production build:

```bash
npm run build
```

Start a production build:

```bash
npm run start
```

## App Structure

- `app/page.tsx` - main route
- `app/layout.tsx` - root layout and metadata
- `app/globals.css` - global theme styles
- `components/tessellate/TessellateApp.tsx` - main UI
- `components/tessellate/Preview3D.tsx` - interactive 3D preview
- `lib/constants/boxTypes.ts` - supported packaging templates
- `lib/server/geminiDieline.ts` - dieline generation logic
- `lib/server/buildGlb.ts` - GLB generation logic
- `app/api/*` - API routes

## Supported Templates

- Vertical box
- Horizontal box
- Bottle packaging box
- Trapezoid
- Cake box

## Notes

This project uses the Next.js App Router. Before changing Next.js-specific APIs or file conventions, check the local Next.js docs in:

```text
node_modules/next/dist/docs/
```
