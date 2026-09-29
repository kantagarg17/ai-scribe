# AI-Scribe frontend

A mobile-first web app for the patient's AI scribe. React + Vite + TypeScript, no UI framework - just a small, hand-styled component set.

## Design

The look draws on two products:

- **Wispr Flow** - voice-first capture. A large, calm record button, consent-first, with a text fallback for when a mic isn't available.
- **Granola** - a clean notepad. The visit summary reads as plain notes with a checklist of next steps and a shareable caregiver update; the Ask tab is "perfect memory" over the patient's own record.

Palette (in `src/styles.css`): warm paper `#faf6f1`, deep plum ink `#2b1830`, coral accent `#e8836b`. Type: Fraunces (headings) + Inter (body).

## Screens

- **Record** (home) - the unified record with filter tabs (All, Visit notes, Labs, Scans, Discharge) and the latest visit summary up top.
- **Capture** - consent-first ambient capture. Records audio via `MediaRecorder`, or type/paste a transcript.
- **Ask** - grounded chat. Answers cite the source document as a chip ("From your Sep 22 visit").

## Develop

```bash
npm install
npm run dev      # http://localhost:5173
```

The dev server proxies `/api` and `/health` to the backend on `http://localhost:8000`, so start the backend first (see the root README).

## Build

```bash
npm run build    # type-checks then builds to dist/
npm run preview  # serve the production build
```
