# Agent handbook

The 8-page PDF agents are given: how to work a lead in this CRM, start to finish.

- `homes-me-crm-agent-handbook.pdf` — the file to hand out.
- `build.py` — generates `handbook.html`. Poppins and the logos are inlined as
  base64 so the HTML is self-contained and the PDF embeds real fonts.
- `topdf.mjs` — prints the HTML with Chromium (`preferCSSPageSize: true`, which
  is what stops Chromium scaling the pages down and adding white margins).

Rebuild after an edit to `build.py`:

```
python3 build.py && node topdf.mjs
```

Every fact in it was checked against the code — tab names, action-bar labels,
keyboard shortcuts, badge names. If a screen is renamed, the handbook is wrong
until someone re-reads it; it is not generated from the source.
