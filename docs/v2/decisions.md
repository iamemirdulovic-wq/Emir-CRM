# Settled, and still open

The design research (`pages.md`, `rules.md`, `tester-rules.md`, `phone-shell.md`)
was produced by reading the design package on its own. Between them those files
raise about twenty "conflicts needing an owner decision".

Most are not open at all: the master prompt v3 (12 November 2026) already decides
them, and `CLAUDE.md` — which some of the research compares against — is the brief
for the CRM that is live today, not for this build. **Where the two disagree, v3
wins.**

This file is the ruling, so the same twenty questions are not asked twice.

---

## 1. Settled by the master prompt — do not ask again

| The research says | Settled | Where |
|---|---|---|
| Assistant is called "Ask AI" / "Homes AI" / "Emir AI" | **Homes AI** | v3 §12, "Decided already" |
| Pipeline has 7 stages with sub-statuses (CLAUDE.md) vs 6 without | **6: New → Called → Interested → Meeting → Offer → Won. Lost separate. No sub-statuses, no drag, no tap to change stage** | v3 §5, §6 `Pipeline` |
| Accent is teal (CLAUDE.md) / green (nova) / orange | **Orange `#FF5A2E`, one accent, nothing else** | v3 §1.1 |
| Finder key is Ctrl-K or `/` | **Ctrl-K** | v3 §4 |
| Sidebar is 248 px or 232 px | **248 px** (`--sb-w`) | `ui.css` tokens |
| Import is 6 steps or 7 | **6** | v3 §12, "Decided already" |
| A fifth status colour (blue) is undefined | **Defined: green good, amber warning, red late, blue outside, violet leave** | v3 §1.1 |
| No tablet or phone rules in the research | **Phone under 768 px from `design/screens/`; 768 px and up the computer layout, sidebar folded to icons between 768 and 1279** | v3 §4 |
| Floating AI button: nova deletes it, CLAUDE.md mandates it | **No floating button. Homes AI is a screen (`AskAI` / `homes-ai.html`)** | v3 §4, §6 |
| The phone design uses "EOI" | **Do not use it.** No jargon: no EOI, SPA, XP | v3 §11 |
| Inbox / Email / Templates missing from the sidebar | **Correct — they are LATER, shown greyed.** (But see §3.3 below: they are *built and working* today, which v3 does not address) | v3 §1, §6 |
| "Who has notifications on" has no screen | **Build it into `settings-team.html`** | v3 §7.8 |

### The sample-data "contradictions" are not contradictions

The research lists six: open-lead counts that disagree (Rocky 62 vs 14), a stage
strip that does not sum to its own total, Rocky both checked in and not checked in,
leads owned by different agents on different screens, different phone numbers for
the same person, a site visit with two different clients.

All six are artefacts of a prototype whose data was typed by hand. v3 §1 is explicit:
*"Sample data (names, numbers, prices, week/month totals, reply times) is invented;
use real data."* There is nothing to decide. Every number comes from the database,
computed once on the server (v3 §5, "one source of numbers"), which is also what
makes them agree by construction.

---

## 2. Decided by me, stated here so Emir can overrule

Small, and holding up work if asked. Each is the obvious reading of v3; say the word
and I will change any of them.

1. **A VIP lead's "must call within" beats the Automations default.** v3 §6 lets the
   owner pick 15 min / 30 min / 1 h / today per lead; §5 sets a default of 30 minutes
   "editable in Automations". So the per-lead choice wins where it is set, and the
   Automations value is the default for everything else.
2. **"Hot" comes from the meeting result, not a button.** v3 has a Hot leads tile and
   a "hot lead (ready to book)" alert, but no screen where an agent sets it. The only
   place interest is recorded is the meeting result (Hot / Warm / Cold). So: a lead is
   hot when its last meeting result says so, or when it reaches Offer.
3. **The top bar follows `sage.md`**, where nova and atlas disagree about whether it
   carries the page title, the avatar, a period switch or a clock.
4. **Where a count could mean two things, "open leads" means** leads not Won and not
   Lost and not deleted. One definition, server-side, used by every screen.
5. **The business card keeps its own link** exactly as the live tool makes it today.

---

## 3. Genuinely open — Emir decides

These change what gets built. I will not guess them.

### 3.1 WhatsApp
v3 §5: no WhatsApp API, each agent uses his own number, the agent presses send.
The live CRM has the WhatsApp Cloud API built and working: approved templates, the
24-hour window, delivery ticks, a shared inbox.
**Switch the API off and move everyone to their own phone, or keep both?**

### 3.2 Where leads come from
v3 §3: only three ways — owner hand-off, Excel import, agents add their own.
The live CRM also ingests Meta Lead Ads, website forms, Google and inbound WhatsApp.
**Switch those off, or leave them running?**

### 3.3 Inbox, Email, Templates
v3 marks them LATER and says to grey them out. They are **built and working today**,
and the same prompt (§4) says nothing the live CRM can do may be lost.
**Grey them out, or keep them working in the new look?**

### 3.4 The `manager` role
v3 §2 has three roles: Owner, Admin, Agent. The live CRM has a fourth, `manager`,
with its own permissions and live accounts.
**Does manager become Admin, become Agent, or stay?**

### 3.5 The rest of v3 §12
Address of the new version · office 16 or 12 on the card · "Emigeo" or "EMIGEO" ·
do owners check in before calling · take-back times · which transfers need approval ·
owner tools for the admin too · Telegram backup now or later.

---

## 4. The testers' seven disagreements, ruled on

`tester-rules.md` ends with seven places where two brokers wanted opposite
things. Five are already decided by v3; two are mine and small.

| The testers disagreed about | Settled | Where |
|---|---|---|
| Check-in: a hard lock before calling, or a question at the moment of the call | **A question at the moment of the call** — check in and call / I am working outside / call anyway (marked) | v3 §5 |
| How much of a colleague's book an agent may see | **Profiles and results, never their leads** | v3 §2 |
| Who may delete a plan on the team calendar | **Owners change team plans; agents can only hide them** | v3 §6 |
| Per-page numbers, or one number everywhere | **One number everywhere**, computed once on the server. (What counts as *open* / *won* / *booked* is still Emir's to define — v3 §12 q9) | v3 §5 |
| Native date controls or our own picker | **Real date and time pickers, 24-hour clock, everywhere** | v3 §5 |
| Toast cap: one at a time, or two | **Two, when one of them holds an Undo.** A cap of one can hide the Undo behind the next toast, and an Undo nobody can reach is not an Undo | mine |
| Dense rows, or full text that wraps | **Two lines on the phone; one line with the full value on hover on the computer.** The agents who wanted wrapping were on phones; the owner who slimmed the rows was on a wide screen. Both get what they asked for | mine |

### What the testers found that we must not repeat

Their findings are about the design prototype, not about the CRM that is live —
but v3 §1 says to treat them as real-use rules. Four of the seven worst are things
this CRM has done to Emir in the last week, which is reason enough to take them
seriously:

- **A link must carry its record.** Every route to a lead opened the same person.
  (This is exactly the "Next lead" bug of 11 Nov: it walked to the same lead for
  ever.)
- **A toast is not a record.** "Saved" on screen with nothing written down.
  Already a hard rule in v3 §5: never write "sent" for something the CRM did not send.
- **The CRM must remember what you just did** — results, calls and check-in time
  survive changing page.
- **Every number must open exactly the set it counted.** Click 456, get 456.
- **Role comes from the session, never the URL.** One tester reached an owner page
  and "became owner for the whole site". Our server checks roles server-side today;
  it gets a guard test in Phase 2 so it cannot regress.

---

## 5. "Office Wi-Fi found" — the design asks for something a browser cannot do

The attendance screens are worded around the phone noticing the office network:
*"OFFICE WI-FI FOUND · homes.me-Office"*, and the only centre-screen interrupt in
the whole design is *"Are you back in the office? Office Wi-Fi found"* when someone
marked outside rejoins it.

**A web page cannot read the Wi-Fi name.** No browser exposes the SSID, on any
platform, and none will.

This is not a blocker, because **the live CRM already solves it another way**: the
server compares the address the request arrives from against the office addresses
the owner saved (`ATT_OFFICE_IPS`, up to ten, set in Settings → Attendance). Connect
to the office Wi-Fi and your requests arrive from the office's address; connect to
mobile data and they do not. It has been working since 10 November.

So:

- **Keep the mechanism.** Office detection stays server-side on the request address.
  It cannot be faked from the phone, which matters more here than the wording does.
- **Change the words.** "Office Wi-Fi found" becomes **"You're on the office
  network"**, and the interrupt becomes **"Are you back in the office?"** with no
  claim about Wi-Fi. Saying "Wi-Fi" would be describing something we are not doing.
- **One limit to know, and to tell the team once:** anyone on the office network
  looks like they are in the office, including someone on it through a VPN from home.
  The alternative the design implies — a phone that proves where it is — is not
  available to a web app at all. If that matters later, the honest fix is a QR code
  at the door, not a different network check.

The "are you back?" interrupt works unchanged: the server already knows when a
request arrives from an office address, so it can ask once when someone marked
outside reappears on it.

---

## 6. The four open questions, decided

Emir, 12 November: *"just go ahead, don't ask me anything today, you just build it."*
So these are mine. Each is reversible, and each is written here to be overruled.

**1. WhatsApp — build it the v3 way: each agent's own number.**
v3 is the newer brief and it is explicit (§5): no API, the CRM opens WhatsApp with a
ready message, the agent presses send, the CRM logs the tap and asks what happened.
That is what v2 gets. The Cloud API code already in the repo is **not deleted** — it
stays, unreferenced by v2, so switching it back on later is a config change rather
than a rebuild. Deciding this way also costs nothing that is working today: the API
path needs Meta approvals that are not in place.

**2. Other lead sources — build the three v3 names, keep the rest alive.**
Owner hand-off, Excel import, agents add their own (§3). The Meta, website and Google
endpoints stay in the codebase and stay harmless: each is already inert without its
key, and none is set. Nothing is removed, nothing is advertised in v2's screens.

**3. Inbox, Email, Templates — keep them working, show them as "later".**
This is the one place v3 contradicts itself: §1 says grey them out, §4 says nothing
the live CRM does may be lost. Both can be true. The menu shows them greyed and
labelled "later", exactly as drawn — and the routes keep working for anyone who
opens them, in the old look, untouched. Nothing is lost and nothing is promised.

**4. The `manager` role — leave it exactly as it is.**
v3 names three roles; the live CRM has four, with real people in the fourth. Mapping
manager onto Admin would hand them every agent's leads, which is a privacy change I
should not make on my own. Mapping it onto Agent would take away the team they
manage. So: `manager` keeps today's meaning and today's permissions, and the "invite
someone" screen offers only Owner, Admin and Agent. Nobody's access changes, and
Emir can retire the role later with one decision instead of a migration.
