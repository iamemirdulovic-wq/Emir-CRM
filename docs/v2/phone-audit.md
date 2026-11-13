# The phone, audited — 59 screens

*13 Nov 2026. Every phone prototype in `design/screens/` opened at 390 × 844
and held against the v2 build at the same width. Five readers, one group each;
their files are `phone-audit-1.md` … `phone-audit-5.md` and this is the
summary. Colour is not audited — the prototypes are in the retired green
palette, which `docs/v2/phone-shell.md` says at the top and the master prompt
§1.1 maps to orange. Layout, order, wording and missing buttons are.*

## What it found

| | |
|---|---|
| Screens read | **59** |
| Layout **Same** as the design | **15** |
| Layout **Different** | **41** |
| **No address in the build at all** | **3** — `PersonalInfo`, `Security`, and `Colleague` as a full screen an agent can reach |
| Things on a phone screen and missing from the build | **≈460** |
| Places the phone design and the computer design disagree | **44** |

Fifteen of fifty-nine is the honest answer to "is the phone built from the
phone screens". The frame is: the floating bar, its five items, the dial
button and the 108px gutter were read from the prototypes properly. What sits
inside the frame is the computer design reflowed, which is what the 12 November
instruction asked for and what these 41 rows are.

## The ten worst, in order

1. **An agent cannot change their password.** `PersonalInfo` and `Security`
   are full screens in the design and exist nowhere in v2. Settings links both
   to `/v2/me`, which is not a route — it falls through to Not Found.
2. **The calendar is 26 pixels wide at 390px.** `.v2 .p-calendar
   .d-cal-layout` is three classes and the phone override was two, so a month
   cell computes to 9px and week and day show only the hour gutter. *(Fixed in
   the shell: every phone rule now carries `.v2.v2-phone`.)*
3. **Eleven tools had no thumb path.** More was built from the computer
   sidebar, so Best of Homes, Team live, the full dashboard, Manage projects,
   the feedback inbox and six others could only be reached by typing in the
   search box — and an agent could not report a bug at all. *(Fixed: More is
   tiles from the whole menu, and there is a Sign out.)*
4. **Settings hides eleven of fourteen sections behind a blind sideways
   scroll** — 1,845px of nav in a 358px window, no arrow, no fade.
5. **Team and roles lost every action.** No invite, no password reset, no sign
   out of every phone, no deactivate — and a single `<select>` can promote
   somebody to Owner in one gesture.
6. **Follow-ups and the messaging report scroll the whole page sideways**, and
   the follow-up period tabs compute to zero width.
7. **Import steps 1 and 4 cannot be used with a thumb** — two desktop columns
   that never collapse, with the Project field drawn on top of the paragraph
   beside it.
8. **A chat is three screens stacked** — the app header, the thread's own
   header, and the whole Contact 360 panel below the composer.
9. **"Are you back in the office?" does not exist**, and neither does the
   calendar's "new plan" flow: its three buttons point at query strings nothing
   reads.
10. **The profile is the wrong screen.** `Profile` is a hub with nine menu rows
    and Log out; `Colleague` is a results page. The build renders the colleague
    shape for both, so all nine rows are gone.

## What the audit changed before any screen was touched

Four findings were the shell's, not a screen's, and are already fixed —
`3a556f2` and the commit before it:

- every phone rule needs three classes to beat a page style;
- each screen gets its own header action and subtitle, so "Add lead" stopped
  appearing on a business card;
- `/logout` was a dead link and the phone had no way out at all;
- three addresses had no name, so the header read "homes.me".

## The 44 disagreements

Where the phone design and `design/web/` disagree, the owner has said the
computer design wins. Each case is listed in its group's file under a line
beginning `DISAGREEMENT:`. The ones that change behaviour rather than wording:

- **Attendance asks for an IP address, not a Wi-Fi name.** Both designs draw a
  network name; no browser will tell a web page what Wi-Fi it is on. Deliberate,
  and already written up in `decisions-to-confirm.md` §3.
- **Tasks and Follow-ups are two screens on the phone and two tabs on the
  computer.** The computer wins, so they stay tabs — but the phone's back
  targets were read from the prototypes and are wrong in the build.
- **Best of Homes is weekly in both designs and "last 30 days" in the build.**
- **`Login.dc.html` carries a dashed "DESIGN DEMO ONLY" box.** That is
  prototype scaffolding and must not be built. The EN / العربية switch below
  it is outside the box and is real.

## One thing about the prototypes themselves

`design/screens/support.js` is referenced by all 59 files and is not in the
repository, so their `sc-if` / `sc-for` runtime never runs. A screenshot of a
prototype therefore shows every conditional state at once — a sheet open over
the screen behind it, several versions of the same card. Read the `<body>` and
the `<script type="text/x-dc">` block, not only the picture. Every reader was
told this and worked that way.

## Added after the merge: the check-in gate

Group 1's report landed after the summary above was written. Its largest
finding was not one screen but a rule missing from sixty-three:

> The attendance gate is on one screen out of twelve. `design/screens`
> puts it on the way to the dialler from all of them — 64 of the 68
> prototypes carry it — and it is the only thing in the phone design that
> stops an agent working. We ask on `/v2/calling` only, as a centred box,
> and the sentence that says when it does **not** apply is implemented in
> code and never printed, so an agent cannot tell a lock from a bug.

Fixed in the shell before the build agents started, because it is shell
work and four agents would otherwise each have copied the old shape:

- the gate now hangs off the dial button, so it covers every screen that
  has one, rather than the single screen that was carrying it;
- it is a bottom sheet with the design's three answers, their sub-lines
  and their colours, wording taken from the prototypes verbatim;
- the exemption is printed: *"After 18:00, on weekends and holidays, calls
  open directly. Owners and admin are not asked."*

`e2e/phone.mjs` asserts all three answers, the consequence line and the
exemption from a real browser, from `/v2/leads` rather than `/v2/calling`.
