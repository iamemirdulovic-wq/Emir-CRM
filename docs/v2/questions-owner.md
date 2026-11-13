# The owner's home and dashboard — what the design asks for and the database cannot give

*Written while rebuilding `/v2` from `design/web/owner-home.html` and
`/v2/dashboard` from `design/web/dashboard.html`, 13 November 2026.*

The rule for this rebuild was Emir's own: **every number comes from a real
query, and a figure the database cannot produce is left out rather than
guessed.** This is the list of what was left out, what it would need, and the
handful of places where the design was followed to the letter even though
something one layer away has to change before it means anything.

Nothing here is a bug in the screens. Each line is a decision waiting on
Emir or on a file this slice did not own.

---

## 1. Things the design shows that nothing records

| The design draws | Where | What it would need |
|---|---|---|
| **"Oldest waits 75 min" counts a bug report** | Needs you now, hero chip | A blocking bug's wait is counted from `feedback_tickets.created_at`, which is right. Nothing else is missing here — this row works. |
| **"Bassam had 30 min · now back in Incoming"** | Needs you now, VIP row | Built, and it reads the real handoff. But when the lead is *still* with the agent past its deadline the row says "still with them" instead, because `vip_handoffs` does not record the bounce separately from the deadline passing. If the five-minute rule is meant to take the lead back automatically, that is a workflow decision, not a screen one. |
| **A "now" marker that moves between refreshes** | Calls today | The marker is placed once, when the page loads, from the server's Dubai clock. It does not creep across the chart while the screen is open. Nothing is wrong on screen; it is simply not live until the next load. |
| **"Telegram" in the calls chart** | Calls today | The bars count calls only (`call_logs`). WhatsApp and Telegram are counted in the line beside the number (`message_taps`) but not drawn as their own columns — the design's chart has one series and so does this. |
| **A money figure on every booked unit** | Meetings and units | `opportunities.deal_value_aed` is often empty. When it is, the line names the agent and the project and leaves the money off rather than printing `AED 0.0M`. Filling it in is a habit question for the sales team, not a code one. |

## 2. Links that lead to the right page but not yet to the right list

Both of these are built exactly as the design writes them. The screen on the
other end has to learn one parameter before the link does anything useful, and
both of those screens belong to another slice.

### `?show=office|late|outside|leave|absent` on attendance

The attendance proportion bar and its legend now carry `?show=` on the owner's
home **and** on the dashboard, which is what `dashboard.html` and
`owner-home.html` both write. `web/src/v2/Attendance.tsx` does not read search
parameters at all, so today the link opens attendance unfiltered.

**What is needed:** `Attendance.tsx` reads `?show=` and opens on that group.
Five values: `office`, `late`, `outside`, `leave`, `absent`.

### A "going cold" list

The design's watch list and its Going cold card both point at
`all-leads.html?tab=going-cold` — open leads with no contact for seven days.
The leads list has no such tab: `TABS` in `web/src/v2/Leads.tsx` offers
`today · new · overdue · no_next_step · vip · lost · all`, and the server
validates the tab it is sent.

So both links go to `/v2/leads?tab=overdue`, which is a different list — the
nearest true thing rather than an error page. **The count beside them is
right**: it is the real seven-day figure, counted in `dashboard.ts` and
`home.ts` from `last_contact_at`.

**What is needed:** a `going_cold` tab in `server/src/leads/tabs.ts` and in
`Leads.tsx`, defined as `status='open' AND (last_contact_at IS NULL OR
last_contact_at < NOW() - 7 days)`. Then the two links change to it. One line
each.

## 3. Things the design draws that were deliberately not built here

| The design has | What was built instead | Why |
|---|---|---|
| **A "Give to an agent" dialog on the owner's home** | The row's button opens `/v2/incoming`, where giving a lead out is already a built screen with the agent list, the open-lead counts and the "must call within" choice on it | Incoming is that dialog, at full size. Building a second copy on the home screen is two places to keep in step. **Ask Emir** whether he wants it inline as well. |
| **A leave-requests dialog (Approve / Refuse plus three refusal reasons)** | The row opens `/v2/attendance`, where leave is answered | Same reason. The endpoint (`POST /api/v2/leave/:id`) already takes the decision and the reason. |
| **An absent-agent side panel** (three stats, the last eight working days, "Phone Bassam", "Move his 44 leads", "Mark as leave") | The row opens `/v2/attendance` | The "Move his leads" half of it is now the Move dialog on the dashboard, which does the same work. **Ask Emir** which of the two he would rather press. |
| **Undo on the "leads moved" message** | A toast that says what happened, and the move is in `audit_log` | Undo would have to remember which lead went to whom and put each one back. Worth doing; it is a job of its own. |

## 4. The desk maximum

The Open column on both screens now draws the agreed maximum, from the `desks`
table (`max_open_leads`) through `desk_members`. Somebody on two desks is held
to the **lower** of the two.

**If no desk has a maximum set, the column says "no max" and the bar is not
drawn** — which is what it looks like today on a database where desks have been
created but not given numbers. The design's own footer names three ("Dubai
off-plan 60 · Arabic desk 50 · Abu Dhabi 40"); the real names and numbers come
from the table, and the footer says "No desk has one set yet" when there are
none. Set them in Settings → Desks and both screens fill in.

## 5. One line that is not the screens' to fix

Every v2 page on the computer has lost the grey sub-line under its title that
the design gives all 44 of them — "Wednesday, 11 November 2026 · shift 09:00 –
18:00". It lives in the shared top bar (`web/src/v2/Shell.tsx`), which this
slice did not own.

Because of it, the owner's home keeps its own greeting **on a phone only**,
where `design/screens/OwnerHome.dc.html` draws one. On the computer the design
has no greeting in the page body — the top bar carries the name and the date —
so the page starts on the period switch, and the date is currently nowhere on
the screen except inside "Live · 14:55".
