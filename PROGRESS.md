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
- [x] 1.5 Toast with Undo — `useToast` already had it
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
- [ ] 5.3 Web Push (VAPID) — **not done**: FCM is already wired and working,
      and running both would mean two subscriptions per device. Noted in
      DECISIONS; the generator script is there if Emir wants to switch
- [x] 5.4 Assignment, reminder and bounce now all write a notification
- [x] 5.5 The types are defined; the ones with no source yet (deal_won,
      mention, followup_due) light up as Steps 7, 8 and 13 land

## Step 6 — Add Lead popup (D6)
- [ ] 6.1 Three steps: Who · What · Source
- [ ] 6.2 Live duplicate check with agent-safe wording
- [ ] 6.3 Agent-created lead assigns to them with no timer
- [ ] 6.4 Confetti + toast; opens the lead with "Log first call"

## Step 7 — My Leads, lead page, actions, next step (D7)
- [ ] 7.1 Rename Contacts → My Leads / Leads, with 301 redirects
- [ ] 7.2 Smart tabs with server-computed counts (Dubai time)
- [ ] 7.3 Filters drawer + saved views
- [ ] 7.4 List view + mobile swipe to call
- [ ] 7.5 Board view with drag between stages
- [ ] 7.6 One-tap actions: Call, WhatsApp, No answer, Call back, Interested, Meeting, Problem, Lost, Won
- [ ] 7.7 The "What's next?" rule and the No next step tab
- [ ] 7.8 Lead page: header, key facts, Timeline / Notes / Emails tabs
- [ ] 7.9 Optimistic save everywhere, no Save button

## Step 8 — Notes (D8)
- [ ] 8.1 `lead_notes` table
- [ ] 8.2 Composer: types, quick text, Enter to save
- [ ] 8.3 Attachments and voice notes
- [ ] 8.4 @mentions + notification
- [ ] 8.5 Pin, edit, soft delete with undo
- [ ] 8.6 "Remind me" sets the lead's next step

## Step 9 — Bulk import (D9)
- [ ] 9.1 Batch tag, `undo_until` on the existing `imports` table
- [ ] 9.2 Column synonyms in auto-matching
- [ ] 9.3 Split evenly across chosen agents
- [ ] 9.4 "Start the 5-minute timer" toggle, default off
- [ ] 9.5 Undo within 24 h, skipping leads that have activity
- [ ] 9.6 Import history page

## Step 10 — Client email, templates, WhatsApp, campaigns (D10)
- [ ] 10.1 `email_templates`, `email_messages`, `email_campaigns`
- [ ] 10.2 Composer drawer with preview and merge fields
- [ ] 10.3 Branded layout + agent signature + unsubscribe
- [ ] 10.4 Provider adapter (brevo/resend/ses) behind `FEATURE_EMAIL_SENDING`
- [ ] 10.5 Test mode redirect
- [ ] 10.6 Tracking webhook → timeline activities
- [ ] 10.7 Opt-out blocks sending
- [ ] 10.8 Six system templates, written
- [ ] 10.9 WhatsApp click-to-chat with four greetings
- [ ] 10.10 Email campaigns: audience, content, schedule, report

## Step 11 — Dashboards and activity (D11)
- [ ] 11.1 Agent dashboard: greeting, today strip, "Do this now", my week, my rank
- [ ] 11.2 Owner dashboard: stats, sources + cost per lead, funnel, leaderboard, lost reasons, overdue
- [ ] 11.3 Session tracking: GeoIP, device, heartbeat, timeout, flags
- [ ] 11.4 Team Activity: live now, table, heatmap, session log, force logout
- [ ] 11.5 Audit log viewer (owner)
- [ ] 11.6 Owner daily summary email at 09:00 Dubai
- [ ] 11.7 AI insight card (flagged)

## Step 12 — Profiles and business card (D12)
- [ ] 12.1 `agent_profiles` table
- [ ] 12.2 Profile page with photo/cover crop, fields, status, availability
- [ ] 12.3 Six generated skyline covers (original SVG, no copyrighted photos)
- [ ] 12.4 Auto stats, badges shelf, level
- [ ] 12.5 Public business card + QR + vCard

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
