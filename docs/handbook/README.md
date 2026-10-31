# Agent handbook

The 21-page PDF agents are given: how to work a lead in this CRM, start to
finish, with a screenshot of every screen it talks about.

| File | What it is |
|---|---|
| `homes-me-crm-agent-handbook.pdf` | The file to hand out. A4, 21 pages. |
| `build.py` | Generates `handbook.html`. Poppins and the logos are inlined as base64, so the HTML is self-contained. |
| `topdf.mjs` | Prints the HTML with Chromium. |
| `shots.mjs` | Regenerates every screenshot in `img/`. |
| `check.mjs` | Fails the pages that overflow or are half empty. |
| `img/` | The screenshots, 256-colour PNG. |

## Rebuilding

Text or layout only:

```
python3 build.py && node topdf.mjs && node check.mjs
```

Screenshots as well, after a UI change:

```
npm --workspace web run build:preview
cd web && npx vite preview --config vite.config.preview.ts --port 5182 &
cd ../docs/handbook && node shots.mjs
python3 build.py && node topdf.mjs && node check.mjs
```

## Two things not to undo

**The screenshots come from the preview build, never from production.** The
preview carries its own fixture data and talks to no database. This document is
printed and handed around; a shot of the live CRM would put real clients' names
and phone numbers into it. `shots.mjs` points at the preview on purpose.

**They are shot as an agent, not the owner.** An agent is who reads this, and
their sidebar is shorter than the owner's. `emir.previewRole` is set to `agent`
in the init script for that reason.

## Keeping it true

Every fact in it was checked against the code — tab names, action-bar labels,
keyboard shortcuts, badge names, the 24-hour window wording. It is **not**
generated from the source, so renaming a screen makes the handbook wrong until
someone re-reads it. `check.mjs` catches layout breakage, not stale wording.
