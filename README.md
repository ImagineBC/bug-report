# ImagineBC — Bug Report

Structured bug-report intake for ImagineBC testing sessions.

**Live:** [imaginebc.github.io/bug-report](https://imaginebc.github.io/bug-report/) (password-gated)

## What this is

A static, single-page tool for the ImagineBC testing team to:

- Run **testing sessions** — a logging block with tester name + start/close timestamps
- Log **findings** within each session — category, severity, location, repro steps, expected vs actual, console errors, auth context, and a screenshot
- **Save & resume** drafts at any time (auto-saved to your browser)
- **Download PDF** of the session at any point — even mid-session
- **Finalize** to publish the session JSON to this repo's `/sessions/` folder, where it appears on the shared dashboard for everyone (Erik, Michael, anyone with the URL)
- **Reopen** a closed session to make corrections; finalizing again overwrites

## Categories

| Category | What it covers |
|---|---|
| Visual glitch | Layout, spacing, alignment, colors, icons, z-index, overflow |
| Functional UI bug | Interactive element doesn't behave right |
| Data issue | Content shown is wrong/missing/stale |
| Backend error | API 4xx/5xx, timeout, unhandled exception |
| Mobile/responsive | Works one viewport, breaks another |
| Copy/translation | Text issues — typos, wrong translation key, fallbacks |
| Performance | Slow load, jank, sluggish interaction |

Severities (orthogonal): **Blocker** · **Major** · **Minor** · **Cosmetic**.

## Architecture

- **Static HTML/CSS/JS** — no build step, hosted on GitHub Pages
- **Soft-lock** with the team password; covers casual access only (it's client-side, not real auth)
- **Local drafts** in browser localStorage (auto-save)
- **Shared sessions** stored as JSON files in `/sessions/` directory in this repo
- **Read** uses anonymous GitHub Contents API (works on this public repo, ~60 req/hr)
- **Write** requires each tester to set their own GitHub Personal Access Token in the Settings panel (stays in their browser)
- **Screenshots** auto-compressed (max 1600px wide, JPEG q80) and stored inline as base64 in the session JSON
- **PDF** generated client-side via [html2pdf.js](https://github.com/eKoopmans/html2pdf.js) (CDN)

## First-run setup (testers)

1. Visit the URL → enter the team password
2. Click the gear icon → **Settings**
3. Follow the linked GitHub PAT setup (one-time, ~60 sec):
   - Fine-grained PAT scoped to `ImagineBC/bug-report`
   - Permission: `Contents` → **Read and write**
   - Click **Test connection**, then **Save**
4. (Optional) Set your default tester name so new sessions pre-fill it

Without a PAT, the form still works locally — drafts auto-save and PDFs export — they just won't appear on the shared dashboard.

## Storage math

Sessions are stored as JSON files; screenshots compressed to ~200–400 KB each.

- A 15-finding session ≈ 4–6 MB JSON
- GitHub repo soft-warning at 1 GB → ~200 sessions of headroom
- Hard file limit (100 MB per file) won't be hit at session granularity
- Pages bandwidth: 100 GB/month (effectively unlimited for this use)

## Files

```
.
├── index.html              # main app
├── css/style.css           # IR-aesthetic stylesheet
├── js/app.js               # app logic (vanilla JS, no framework)
├── sessions/               # finalized session JSONs (one per session)
│   └── .gitkeep
├── .nojekyll               # disable Jekyll processing on Pages
└── README.md               # this file
```

## Local development

Serve the directory with any static server:

```bash
python -m http.server 8080
# or
npx serve .
```

Open http://localhost:8080/ — the form runs the same as on Pages.

## Acknowledgements

Aesthetic inspired by [intentionalrealism.org](https://intentionalrealism.org/) — same family.

Built by Sage with Willow, May 2026.
