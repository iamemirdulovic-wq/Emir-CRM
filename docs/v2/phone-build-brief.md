# Building a phone screen

*The brief every group of the phone build works from. Written 13 Nov 2025,
after the audit in `phone-audit.md` and after the shell in `phone-shell.md`
was built and tested.*

The job: under 768px the CRM must feel like a phone app built from the phone
design, not the computer pages made smaller. The shell is done. Each group
takes a list of screens and makes each one match its prototype.

---

## 1. Read the design file. Not the spec, not the API.

This was got wrong once, at length. Ten screens were built from the written
spec and the endpoints, came out in the right colours with invented layouts,
and the owner stopped the build over it on 12 November. **The prototype is
the source of truth for layout, order, wording and what buttons exist.**

Each screen is one file: `design/screens/<Name>.dc.html`, drawn at 390×844.
Read two things in it:

- the `<body>` — the markup and the page's own `<style>`;
- the `<script type="text/x-dc">` block — the behaviour and the wording of
  every state, which the markup alone does not show.

**`design/screens/support.js` is referenced by all 59 files and is not in
this repository.** So `sc-if` and `sc-for` never run: a screenshot of a
prototype shows every conditional state at once, stacked. Read the x-dc
block to find out which state belongs when. A screenshot alone will mislead
you into building three states as one screen.

`Dark_*` and `Web_*` files are not phone screens. Ignore them.

## 2. The colours in the prototypes are the old look.

The phone files are in the old green palette. The mapping to the current
orange is in the master prompt §1.1, and the tokens are already in
`v2-tokens.css`. **A colour difference between the prototype and your build
is expected and is not a finding.** Use the existing `d-` classes and the
tokens; never hard-code a hex that is not already a token.

## 3. Where the two designs disagree, the computer design wins.

`design/web/*.html` is the computer design and it is newer. If a phone
prototype and the computer page disagree on a rule, a field, a stage name or
a piece of wording, **follow the computer design**, and write the case down —
one line, what the phone says, what the computer says, what you did — in
your group's questions file (`docs/v2/phone-questions-<letter>.md`). The
owner reads those.

Same file for anything the design leaves unclear: follow the design file,
write the question, do not invent.

## 4. Never invent data.

A hard rule of this repository. Prices, handover dates, payment plans, unit
sizes, ROI and availability come from the database and nowhere else. If a
prototype shows a figure the server has no field for, **leave it out and
write it in your questions file.** A blank is correct; a plausible number is
a lie an agent will send to a client.

Same for whole features: do not add a screen, a tab or a button the design
does not draw.

## 5. The shell is built. Use it; do not rewrite it.

`web/src/v2/phone.tsx` and `web/src/styles/v2-phone.css` already give you:

- **The bottom bar** — Home, Leads, Calendar, Tasks, More, and the round
  orange dial button. It hides itself on the four full-attention screens.
  You do not place it; it is in the shell.
- **The header** — avatar or back button, search, bell, the screen's title
  and an optional subtitle and one round action. You set the last two with
  `usePhoneHead`, from inside your screen:

  ```tsx
  usePhoneHead({ sub: '12 to call today', action: { icon: 'plus', label: 'Add lead', to: '/v2/leads/new' } });
  ```

  One action per screen, or none. Do not build your own header row: the
  shell draws it, and a second one appears as a double title.
- **Every dialog is a bottom sheet.** `.d-dialog` and `.d-panel` are already
  turned into sheets under 768px, with the grab handle, the dim behind, the
  swipe-down to close and the tap-outside to close. So **build a dialog the
  ordinary way** with the classes the rest of the app uses and it arrives as
  a sheet. Do not write a new sheet component.
- **The rise-in** — cards stagger up as a screen opens, and stop when the
  phone asks for reduced motion. Automatic; nothing to call.
- **The check-in gate** — the dial button asks it. Nothing to call.

### Shared files you must not change

`web/src/v2/Shell.tsx` · `web/src/v2/phone.tsx` · `web/src/v2/check-in.tsx` ·
`web/src/v2/nav.ts` · `web/src/styles/v2-phone.css` ·
`web/src/styles/index.css` · `web/src/styles/v2-tokens.css` ·
`web/src/styles/v2-shell.css` · `web/src/styles/v2-ui.css` (generated) ·
`web/src/styles/v2-home.css` (generated) · `scripts/port-design-css.mjs` ·
`e2e/phone.mjs` · `web/src/v2/phone.test.ts` · `scripts/phone-proof.mjs` ·
another group's screens or stylesheet.

If a screen of yours needs one of these changed, **stop and ask** — report it
and carry on with the rest. Four people editing the shell at once is how a
build loses a day.

## 6. Your stylesheet

`web/src/styles/v2-phone-<letter>.css`, already created and imported. Two
rules, both enforced by `web/src/v2/phone.test.ts`:

1. **Every rule inside `@media (max-width: 767px)`.** The promise is that the
   computer layout does not change. A rule outside the media query lands on
   every screen in the company and nothing in the code looks wrong.
2. **Every selector starts `.v2.v2-phone`.** The ported page styles are
   `.v2 .p-leads .d-card` — three classes. `.v2-phone .d-card` is two, so it
   loses, and the box computes to the wrong size with the code reading
   correctly. The audit found exactly that on the calendar grid: 26 pixels
   wide at 390px. `.v2.v2-phone` ties at three and wins on source order.

New class names of your own carry a `v2-<letter>-` prefix, so two groups
cannot define the same bare class — which broke the pipeline board once.

**Prefer a `d-` class the design already has over a new rule of your own.**
If a `d-` class is in no stylesheet it styles nothing and looks right in the
code; `design-classes.test.ts` fails on it.

## 7. What a phone screen looks like

From `docs/v2/phone-shell.md`, which is the careful reading of the
prototypes. Read §1.1 to §1.6 before your first screen, and §5 for the
patterns.

- **A list is cards, not a table.** A `<table>` at 390px either scrolls
  sideways — which is forbidden — or crushes its columns. The prototypes draw
  a stack of cards with the two or three facts that matter. §5.4.
- **Nothing scrolls sideways.** Ever. A horizontal scroller the design draws
  on purpose (a row of chips) is fine; a table that overflows is a bug.
- **Tap targets at least 44px.**
- **On the lead page and the calling screen the phone number is the biggest
  text on the screen.** The owner's instruction, and the prototypes draw it
  that way: an agent's job is to call.
- **Safe areas.** `env(safe-area-inset-*)` is already handled in the shell
  for the bar and the header; if you pin something yourself, respect it.

## 8. Look at it in a browser. Twice.

A green test suite cannot see a layout bug. Every screen in this build that
went wrong, went wrong with the tests passing.

Each group has its own preview, so builds do not clobber each other:

```bash
cd web
PREVIEW_OUT=dist-preview-<letter> npx vite build --config vite.config.preview.ts
PREVIEW_OUT=dist-preview-<letter> npx vite preview --config vite.config.preview.ts --port 519<N> &
```

Ports: A 5191, B 5192, C 5193, D 5194. The preview uses **HashRouter**, so a
URL is `http://127.0.0.1:519N/?as=agent#/v2/leads` — `?as=owner` for an
owner screen. Stand-in data is in `web/src/preview/mock-api.ts`; if a screen
of yours needs a shape that is not mocked, add it there **and check the real
endpoint's response shape in `server/src/routes/` first** — a mock that
disagrees with the server is worse than none.

Then shoot it at 390×844 and **read the picture**:

```bash
node -e '
const { chromium } = require("playwright");
(async () => {
  const b = await chromium.launch();
  const p = await b.newPage({ viewport: { width: 390, height: 844 }, deviceScaleFactor: 2 });
  await p.goto("http://127.0.0.1:519N/?as=agent#/v2/leads", { waitUntil: "networkidle" });
  await p.waitForTimeout(1200);
  await p.screenshot({ path: "/tmp/x.png", fullPage: true });
  await b.close();
})()'
```

Open the prototype the same way with a `file://` URL and compare them side by
side. Check, every time: is anything wider than 390? is any text cut off? is
every button from the design present? is the order the same? is the wording
the same?

## 9. Before you report

```bash
cd web && npx tsc -b --noEmit && npx vitest run
cd .. && npm run phone            # the shell's 32 browser checks, still green
```

All of it must pass. `npm run phone` proves you did not break the shell.

## 10. Report

Per screen: **Done**, **Partly** (what is missing and why), or **Not done**
(why). Plus: the files you changed, the disagreements you wrote down, and
anything you need from the owner. Keep it short — a table and a few lines.
