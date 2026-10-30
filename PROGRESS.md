# Emigeo Homes CRM — build progress

Backup: taken on the server by `scripts/backup-db.mjs`, wired into `npm start`
before migrations. Writes `../crm-backups/crm-<YYYY-MM-DD-HHMM>.sql.gz`,
keeping 14. The path is printed in the deploy log as `[start] backup …`.
The build environment has no route to the live database, so no dump could be
taken from here — see `DECISIONS.md`.

Last updated: 30 Oct 2026

A box is ticked only when the item is **built, tested and screenshotted**.

---

## Step 0 — Audit, backup, tracking
- [x] 0.1 Read the codebase: stack, schema, migrations, auth, routes, pages
- [x] 0.2 `docs/AUDIT.md`
- [x] 0.3 Backup script + wired into `npm start` before migrations
- [x] 0.4 Migration safety test (no destructive DDL reaches the live database)
- [x] 0.5 `PROGRESS.md`, `DECISIONS.md`, `SETUP_NEEDED.md`

## Step 1 — Foundations (C2, C3, C4, C5, C8)
- [x] 1.1 Design tokens audited against Part C2 — kept the approved teal
      `#00AFC8`; set the document language to `en-AE` so browsers stop
      formatting dates month-first
- [x] 1.2 Button, IconButton, Badge, StatCard, Skeleton, SkeletonRows
- [x] 1.3 Combobox, WhenField, PhoneInput, CurrencyInput, BudgetRange
- [x] 1.4 BottomSheet, Tabs, ConfirmDialog, TimelineItem, CountdownRing
- [x] 1.5 Toast with Undo — built in Step 8. This box was ticked in Step 1
      on the belief that `useToast` already supported an action; it did not,
      it took a message and nothing else. Corrected rather than left standing.
- [x] 1.6 EmptyState — `Empty` already had it
- [x] 1.7a Mobile bottom nav with the centre ＋ button
- [ ] 1.7b Sidebar order per C4 — **waits on Steps 7, 11 and 13**: My Leads,
      Follow-ups, Team Wall and Team Activity do not exist yet, so the order
      is set as each page lands rather than linking to nothing
- [x] 1.8 Sounds (new-lead, won, notify), synthesised, with a mute switch
- [x] 1.9 PWA — manifest, service worker and offline shell already existed;
      added the install prompt (asked once, on the second visit)
- [x] 1.10 `/dev/components` showcase, owner only, both themes

## Step 2 — Roles, permissions, data protection, audit (D1)
- [x] 2.1 Export, bulk delete, hard delete and audit read are now **owner
      only** — they were granted to `admin`
- [x] 2.2 Soft delete on contacts and opportunities (migration 0014), with
      restore and a bin to restore from. A deleted client who enquires again
      is revived with their history, because the phone number is still unique
- [x] 2.3 Phone masking in the contacts list — cosmetic by design; see
      `DECISIONS.md` for exactly what it does and does not protect
- [x] 2.4 Per-session rate limit (120/min) on the lead endpoints, and an
      owner alert when someone opens 200+ distinct leads in an hour
- [x] 2.5 Deactivation returns open leads to Incoming, tagged "From <name>
      (left)", clearing the sticky owner and cancelling their timers
- [x] 2.6 Every export audit-logged — already was
- [x] 2.7 Permission tests: the whole matrix written out independently, plus
      a guard that fails the build if any file hard-deletes a lead again

## Step 3 — Lead capture and dedupe (D3)
- [x] 3.1 One path for every source — `ingestLead()` already was it
- [x] 3.2 Normalisation — already done through libphonenumber on the server
- [x] 3.3 Re-inquiry attaches rather than duplicating (already); **a lead
      that comes back after being Lost now goes to Incoming** rather than back
      to the agent who closed the file. A past buyer is exempt
- [x] 3.4 Public `/api/public/leads` with `X-Site-Key`, a honeypot and a
      10/min limit, plus the `/embed/lead-form.js` snippet for homes.me. The
      HMAC endpoint is untouched
- [x] 3.5 Meta lead ads webhook — already built, behind its token
- [x] 3.6 Google lead forms webhook — already built, behind `google_key`
- [x] 3.7 `score_reason` and `score_band` (migration 0015). The existing
      0–100 score is kept and now explains itself in words

## Step 4 — Incoming, routing, the 5-minute rule (D4)
- [x] 4.1 State machine — built with Incoming; `decideSla()` is the pure
      function and both endings now have integration tests
- [x] 4.2 **Not** a 30-second sweep: an exact-time job per lead. The deadline
      is known when the lead is assigned, so no polling and the bounce lands
      on the second. Deduped by key, so two workers produce one bounce
- [x] 4.3 The reminder now exists. It was a setting with nothing behind it —
      an owner could choose three minutes and no agent was ever nudged
- [x] 4.4 Quiet hours: the clock pauses overnight and starts in the morning.
      Clients still get their reply at any hour
- [x] 4.5 Downtime catch-up: three bounces in a minute become one summary
- [x] 4.6 Incoming page — built previously
- [x] 4.7 Owner routing settings screen, in plain words
- [x] 4.8 Tests: 18 for the quiet-hours arithmetic, 8 for the alert damper

## Step 5 — Notifications (D5)
- [x] 5.1 `notifications` table (migration 0016) and the bell — grouped by
      day, unread tinted, mark-one and mark-all. Recorded *then* pushed, so a
      face-down phone is no longer the reason an agent never learns
- [x] 5.2 New-lead alert card — built in an earlier step, with the countdown
- [x] 5.3 Push — **resolved, and not with VAPID.** FCM is already wired and
      is a Web Push transport underneath; a second stack would mean two
      subscriptions per device and two ways for an alert to go missing. What
      was actually missing was that push fails *silently* — no credentials,
      or an agent who never allowed notifications — and the lead bounces off
      somebody who was never told. Settings → Health now shows whether push
      is on and who has no device registered
- [x] 5.4 Assignment, reminder and bounce now all write a notification
- [x] 5.5 The types are defined; the ones with no source yet (deal_won,
      mention, followup_due) light up as Steps 7, 8 and 13 land

## Step 6 — Add Lead popup (D6)
- [x] 6.1 Three steps: Who · What they want · Where from. **The button was
      dead** — it navigated to `/contacts?new=1`, which no screen read
- [x] 6.2 Live duplicate check. An agent is told only that the client exists
      when the lead is someone else's; the server does not send the name
- [x] 6.3 An agent's own lead is theirs with no timer — they have already
      spoken to the client, so there is nothing to chase
- [x] 6.4 Confetti and the toast, then straight to the lead where the call
      buttons are. Adding a lead is never the goal; calling them is
- [x] 6.5 No automatic welcome template on a manual lead — somebody just
      spoke to this person

## Step 7 — My Leads, lead page, actions, next step (D7)
- [x] 7.1 My Leads at `/leads`; `/contacts` redirects there, and the sidebar
      leads with it under the Dashboard
- [x] 7.2 Six smart tabs with server-computed counts, all boundaries in
      Dubai time. 17 tests pin them, because a tab that is subtly wrong does
      not look like a bug — it looks like a lead that stopped appearing
- [x] 7.3 Search through the top bar (there were two search boxes on one
      screen); stage, source, project, band and agent filters on the API
- [x] 7.4 List view, with the phone and owner dropped on a narrow screen
- [ ] 7.5 Board view with drag between stages — **the existing Pipeline
      screen already is this.** Rebuilding it inside My Leads would mean two
      boards to keep in step; see DECISIONS
- [x] 7.6 All nine one-tap actions, each logging an activity, moving the
      stage and stopping the five-minute clock
- [x] 7.7 The "What's next?" rule — asked after anything that leaves a lead
      open with nothing promised, skippable, and the No next step tab is
      where a skipped one goes
- [x] 7.8 The action bar is on the lead page, replacing two links that
      recorded nothing
- [x] 7.9 Actions save on press and reload the view; there is no Save button

## Step 8 — Notes (D8)
- [x] 8.1 `lead_notes` table — one row per note, with an author, a type and a
      pin. The old `note` activities stay in the timeline untouched.
- [x] 8.2 Composer: six types, six quick phrases, Enter saves and
      Shift+Enter is a new line
- [x] 8.3 Attachments and voice notes — photos and PDF, plus a recorder that
      works on a phone in a car park. `note_files` table, streamed to disk,
      served only through a permission check.
- [x] 8.4 @mentions + notification — matched longest name first, and it
      refuses to guess between two people who share a first name
- [x] 8.5 Pin, edit, soft delete with undo — the undo is a real toast action,
      which the toast did not have until now
- [x] 8.6 "Remind me" sets the lead's next step, so a note saying "call him
      Thursday" puts Thursday somewhere
- [x] 8.7 The client's own words from the ad form are shown above the notes.
      They arrived with every lead and had never been displayed anywhere.

## Step 9 — Bulk import (D9)
- [x] 9.1 Batch tag — `batch:expo-2026-30oct-a3f2`, unique per upload, shown
      on the import with a link to exactly those leads. `undo_deadline_at`
      was already on the table from the original build.
- [x] 9.2 Column synonyms — already built: an alias table covering "Mobile
      No.", "mobile_no", "MOBILE NO" and the Arabic headers, scored so
      "budgetmin" is not swallowed by "budget". Checked, not rebuilt.
- [x] 9.3 Split evenly across chosen agents — already built as the
      `split_even` method in the assignment picker. Checked, not rebuilt.
- [x] 9.4 "Start the 5-minute timer" toggle, default off — and capped at 200
      rows, refused rather than warned about, re-checked on the server
- [x] 9.5 Undo within 24 h skipping leads with activity — already built,
      and it is a soft delete. Checked, not rebuilt.
- [x] 9.6 Import history page — already built at /imports. Checked, not
      rebuilt; the batch tag panel is new.
- [x] 9.7 A tag filter on My Leads, because a batch tag nothing can filter by
      is not a way of finding anything
- [x] 9.8 The import wizard works in the preview at all — the paste and
      upload calls had no mock, so the whole wizard was undemonstrable

## Step 10 — Client email, templates, WhatsApp, campaigns (D10)
- [x] 10.1 `email_templates`, `email_campaigns`, `email_campaign_members`,
      `email_events`. Deliberately NO `email_messages`: a sent email is a row
      in `messages` beside the WhatsApp, because the unified inbox is one
      thread per contact and two tables would drift.
- [x] 10.2 Composer drawer — templates, merge-field chips inserted at the
      cursor, and a live preview rendered by the server through the same code
      that sends it
- [x] 10.3 Branded layout, agent signature with BRN, unsubscribe link, and a
      plain-text alternative. Tables and inline styles, because that is what
      email clients agree on.
- [x] 10.4 Provider adapter — SMTP, Brevo, Resend — behind
      `FEATURE_EMAIL_SENDING`, which is off by default and stays off even
      when an API key is present
- [x] 10.5 Test mode: every message to one address, the real recipient in the
      subject. Half-configured test mode refuses to send rather than falling
      through to the client.
- [x] 10.6 Tracking webhook → `email_events` → timeline activities, signed and
      refused when unsigned
- [x] 10.7 Opt-out blocks sending — consent row, suppression on the address
      itself, and the campaign counter, all three
- [x] 10.8 Six system templates, written to be sent and tested for it: no
      prices, no dates, no invented scarcity, one clear ask
- [x] 10.9 WhatsApp click-to-chat with four openings, filled in from the
      project the lead actually asked about
- [x] 10.10 Email campaigns: audience with who is skipped and why, throttle,
      self-pausing on bounces, and a report
- [x] 10.11 A check that reads every SQL statement in the server against the
      schema the migrations describe — written because a query in this step
      asked `users` for a column that does not exist

## Step 11 — Dashboards and activity (D11)
- [x] 11.1 Agent dashboard: greeting by Dubai time, this week's strip, a loose
      standing rather than a rank number, and "Do this now" — up to six cards
      ordered by what costs most to leave undone, each an instruction with a
      button to exactly those leads. Nothing is counted twice.
- [x] 11.2 Owner dashboard — the stats, sources, funnel, leaderboard and lost
      reasons were already built; the new part is the counted-facts card at
      the top, which leads with what went wrong rather than the total
- [x] 11.3 Session tracking: device from the user agent, optional GeoIP that
      the CRM works without, a heartbeat that only counts while the tab is
      visible, and flags for a new device, a new country, the middle of the
      night and two countries too close together to have flown between
- [x] 11.4 Team Activity: live now with what screen each person is on, the
      sign-in log with the unusual ones marked, a heatmap endpoint, and force
      sign-out with a required reason
- [x] 11.5 Audit log viewer (owner only), collapsed to one line a row with
      before and after side by side when opened
- [x] 11.6 Owner daily summary at 09:00 Dubai — problems first, no
      congratulating, and "yesterday" means the Dubai day so an evening's work
      lands in the right report
- [x] 11.7 Insight card — real counted figures, and it says so. The AI layer
      may rephrase the lines and never sees a number it could change.
- [x] 11.8 The new-lead alert no longer covers the toolbar's right-hand
      control, which it did on every screen that has one
- [x] 11.9 The preview can be opened as an agent (`?as=agent`), because the
      CRM looks genuinely different to an agent and to an owner

## Step 12 — Profiles and business card (D12)
- [x] 12.1 `agent_profiles` table, separate from `users` so the query that
      serves a public card cannot reach a password hash
- [x] 12.2 Profile page — headline, bio, languages, what they sell, job title,
      BRN, cover, and the switch that makes the card public (off by default)
- [x] 12.3 Six generated skyline covers, drawn in SVG from a handful of
      numbers. No photograph: a stock skyline is either licensed or stolen.
      Each under 10 KB and identical on every render.
- [x] 12.4 Stats counted from the CRM and ten badges earned from them — none
      that anybody can hand out, several reachable in a first month — plus a
      level that is a word rather than a number
- [x] 12.5 Public business card at `/card/{slug}`: server-rendered HTML with
      no bundle and no session, a QR code generated in this repository, and a
      vCard that saves on one tap
- [x] 12.6 A QR encoder written here rather than installed or fetched from a
      free QR image service — those work by being told the URL, which for a
      business card means handing a named person at a named brokerage to a
      third party on every page load

## Step 13 — Team Wall, kudos, points, badges (D13)
- [ ] 13.1 Wall tables
- [ ] 13.2 Composer: media, polls, mentions, types
- [ ] 13.3 Post card: media grid, lightbox, reactions, threaded comments
- [ ] 13.4 Auto-posts: deal won, birthday, anniversary, welcome
- [ ] 13.5 XP rules + anti-gaming
- [ ] 13.6 Kudos, 5 per week
- [ ] 13.7 Sidebar: leaderboard, who's online, upcoming, kudos left
- [ ] 13.8 Badges + unlock modal
- [ ] 13.9 Streak with Sunday skipped
- [ ] 13.10 Best of Homes Monday 09:00 + crown
- [ ] 13.11 Moderation (pin, delete, mute, show deal value)

## Step 14 — Palette, shortcuts, tour, AI (C9, C10, D14)
- [ ] 14.1 Command palette (Cmd+K) over leads, projects, pages, actions
- [ ] 14.2 Keyboard shortcuts + `?` help
- [ ] 14.3 Five-step guided tour, replayable
- [ ] 14.4 Notes summary, next-step suggestion, nightly score refinement

## Step 15 — Owner settings (D15)
- [ ] 15.1 All sections, each change audit-logged

## Step 16 — The great polish pass
- [ ] 16.1 Every screen, desktop + mobile, light + dark, screenshotted and fixed

## Step 17 — Final
- [ ] 17.1 Full test run green
- [ ] 17.2 `FINAL_REPORT.md`
- [ ] 17.3 `SETUP_NEEDED.md` complete
- [ ] 17.4 `CLAUDE.md` and `.env.example` updated
