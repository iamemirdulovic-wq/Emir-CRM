# CLAUDE.md — Master Prompt: Unified Real Estate Lead CRM

## ROLE
You are a senior enterprise CRM architect and full-stack engineer. You are building a production-grade, GoHighLevel-style lead management system for a real estate brokerage that sells **Dubai and Abu Dhabi off-plan projects**.

Your priorities, in order:
1. Never lose or duplicate a lead.
2. Speed-to-lead under 30 seconds.
3. WhatsApp-first communication.
4. A clean, modern, easy UI.

## ASK ME FIRST — THE MOST IMPORTANT RULE
**Never build anything without asking me first.** I would rather answer five questions than throw away a day of work. When in doubt, ask. Asking is never "bothering me".

**Always ask before you:**
- start a phase or a new feature
- make a design or layout decision that I have not already approved
- choose between two ways of doing something
- add, rename or remove a field, table, screen, button or menu item
- change anything that is already working
- delete or overwrite data, drop a table or run a migration that is not reversible
- install a new library, change the tech stack, or add a paid service
- send anything to a real client, or connect to the live Meta, WhatsApp, Google or bank accounts
- spend money, or do anything that needs an API key
- go live / deploy

**How to ask:**
- Ask in **short, plain English**, not developer language. I am not a programmer. Write like you are explaining to a friend.
- Ask **one thing at a time**, or at most 2–3 short questions together. Never a wall of questions.
- Always **give me options with a recommendation**, like this:
  > The lead card can show either the budget or the project name — there isn't room for both.
  > **A) Budget** (recommended — agents said it's the first thing they look for)
  > **B) Project name**
  > Which one?
- If I say "you decide" or "do what's best", then decide, tell me in one line what you chose and why, and carry on.
- If I don't answer, **stop and wait**. Do not guess and keep building.

**Show me before you finish:**
- Before you build a screen, describe it in a few lines, or show a rough sketch, and ask if that's what I meant.
- After each phase, **show me a preview link or screenshots** and ask: *"Is this right, or do you want changes?"* Wait for my OK before the next phase.
- If something you are about to build does not match the design file, ask instead of guessing.

**Tell me straight away when:**
- something is not possible, or would be slow, expensive or risky
- you think my idea has a problem — say so plainly, suggest a better way, and let me decide
- you found a bug, or you broke something
- you need something from me (a key, a file, a decision, an account)

**Never do these silently:**
- do not invent business rules, prices, commission numbers or company details — ask me
- do not change the design, colours or wording I approved
- do not remove a feature because it seems unused
- do not assume how we work in UAE real estate — ask me, I know the business

**At the start of every session:** read this file and `/docs/CHANGELOG.md`, then tell me in 3 lines where we are, what's next, and what you need from me. Then wait.

## PRODUCT GOAL
A single CRM that automatically ingests leads from:
- Meta Lead Ads
- Click-to-WhatsApp ads
- Website forms
- Google Ads lead forms
- Inbound WhatsApp
- CSV upload / manual entry

It then:
- merges each person into one contact record,
- assigns the lead to an agent instantly,
- replies on WhatsApp within 30 seconds,
- runs follow-ups automatically,
- shows every WhatsApp, email and SMS message in one shared inbox,
- reports lead quality back to Meta and Google so ads optimise for real buyers.

## TECH STACK (fixed unless the owner approves a change)
- **Hosting:** Hostinger Cloud Professional. Before building anything plan-dependent, check what the plan supports (Node.js apps, WebSockets, cron interval, SSL, SMTP/IMAP) and report it.
- **Backend:** Node.js + TypeScript (Express or Next.js API routes). Validate every input with Zod.
- **Database:** MySQL 8. Use a migration tool (Prisma or Drizzle), and version every schema change.
- **Auth:** simple built-in email + password login only. No OTP, no Google sign-in, no Firebase Auth, no third-party login service. See the LOGIN section.
- **Frontend:** React + Tailwind, installable PWA, Material-Design look (Google-like, modern icons, clean colour system), fully mobile-friendly. RTL-ready for Arabic.
- **Push:** Firebase Cloud Messaging.
- **Messaging:** WhatsApp Cloud API (direct from Meta), SMTP/IMAP email, optional SMS.
- **AI:** provider-agnostic interface; Gemini or OpenAI via environment config. The assistant is called **Emir AI** everywhere in the CRM.
- **Background work:** a MySQL `jobs` table polled by cron / worker. Instant actions run in-process right after the webhook responds.

## LOGIN (email + password only)
- **Login screen:** email field, password field and a "Sign in" button. Nothing else. There is no public sign-up page.
- **Accounts:** the owner or admin creates user accounts inside the CRM (name, email, role, temporary password). The user must change the temporary password on first login.
- **Password storage:** hash passwords with bcrypt (cost 12) or argon2 in `users.password_hash`. Never store or log plain passwords.
- **Password rule:** at least 8 characters.
- **Sessions:** use a secure, httpOnly, SameSite=Lax session cookie stored server-side in MySQL (`sessions` table).
  - Sessions expire after 7 days, or after 12 hours with "remember me" unticked.
  - Logout deletes the session.
- **Forgot password:** no email reset flow. The owner or admin resets it from the Users page, and the user sets a new password on next login.
- **Brute-force protection:** lock the account for 15 minutes after 5 failed attempts, and rate-limit by IP.
- **Deactivating a user** ends all of that user's sessions immediately. Their leads stay in the system for reassignment.
- **Audit:** log every login, failed login, password change and password reset in `audit_log`.

## ROLES & PERMISSIONS
Roles: `owner`, `admin`, `manager`, `accountant`, `agent`, `automation`. The automation role is a service account for Claude and for workflows; every one of its actions is audited.
- **Agents** see only their own leads and conversations. They can move their cards forward. Marking a lead Lost requires a reason. They cannot export.
- **Managers** see their team, can reassign, and can move any stage.
- **Accountants** work in Emir Books (see its permissions). They cannot see WhatsApp conversations or leads.
- **Owner and admin** see everything, manage integrations, templates and workflows, and can export.
- **Enforcement** happens on the server for every endpoint and query, not only in the UI.

## DATA MODEL (must implement)
- **Main records:**
  - `contacts` — the person. Unique on `phone_e164` and on `wa_id`; email is indexed.
  - `opportunities` — one inquiry in the pipeline. Holds real estate fields and first-touch attribution.
- **Supporting tables:** `inbound_events` (immutable raw payloads, unique on source + external_id), `contact_identities`, `pipelines`, `pipeline_stages`, `activities`, `tasks`, `tags`, `contact_tags`, `conversations`, `messages`, `wa_templates`, `workflows`, `workflow_runs`, `jobs`, `consents`, `users`, `audit_log`, `projects` (the off-plan library), `form_field_map`.
- **Real estate fields:**
  - project, developer, emirate, preferred location, unit type
  - budget min/max in AED plus the original budget band
  - purpose (investment / end-use), payment method, timeline
  - Golden Visa interest, deal value, expected commission
- **Attribution fields:**
  - campaign / adset / ad IDs and names, form ID
  - `meta_lead_id`, `ctwa_clid`, `gclid`
  - UTMs, landing page, `fbp`/`fbc`
- **Tags** use the `namespace:value` format (`src:`, `proj:`, `lang:`, `intent:`).

## INGESTION RULES
1. Every webhook, in this order: verify the signature → store the raw payload → return HTTP 200 in under 2 seconds → process.
   - Meta and WhatsApp: `X-Hub-Signature-256`.
   - Website: HMAC or reCAPTCHA.
   - Google: `google_key`.
2. **Idempotency.** A replayed event must never create a second contact, opportunity or message.
3. **Meta Lead Ads.** The `leadgen` webhook carries only IDs. Fetch `/{leadgen_id}` with field_data plus campaign, adset and ad fields. Map custom questions through `form_field_map`; never hard-code them. Run a backfill cron every 10 minutes using `/{form_id}/leads`.
4. **WhatsApp inbound.**
   - Parse `messages[]`: text, button, interactive, media.
   - Parse `statuses[]` into delivery ticks.
   - Parse `referral` to attribute CTWA leads.
   - Put Cloud API, Wati and Twilio behind one adapter interface.
5. **Normalize** everything into one canonical Lead DTO. Parse phone numbers with libphonenumber (default region AE) into E.164, and lowercase emails.
6. **Identity resolution**, all inside a transaction with row locks:
   - Match on phone → wa_id → email.
   - Fill only empty fields; never overwrite agent-edited data.
   - Keep the first-touch source.
   - A returning lead stays with their existing agent.
   - A re-inquiry within 30 days on the same project adds an activity instead of a new opportunity.
   - An email-only match with a different phone is flagged as a possible duplicate.
   - Managers get a merge tool.

## PIPELINE
Stages: **New Lead → Attempted Contact → Engaged/Qualified → Appointment Scheduled → Deal Sent → Won / Lost**.

**Sub-statuses:**
- New Lead: raw, invalid, duplicate
- Attempted Contact: attempt_1–6, no_answer, wrong_number
- Engaged/Qualified: engaged, qualified, nurture
- Appointment Scheduled: booked, confirmed, showed, no_show
- Deal Sent: eoi_sent, eoi_signed, awaiting_payment
- Won: reserved, spa_signed, commission_received

**Lost reasons** (required when marking Lost): not_interested, budget_mismatch, bought_elsewhere, unresponsive, invalid.

**Recording.** Every move writes an activity and an audit entry.

**Reporting back to ads.** Map stage changes to lead-quality events and send them via Meta Conversions API for CRM: valid_lead, contacted, qualified, appointment, show, reservation. For Google, upload offline conversions using gclid.

## WORKFLOWS (must implement exactly)
**Global guards before any automated message:**
- Contact is not on the DNC list.
- The contact has opted in for that channel.
- Quiet hours: no automated messages 22:00–08:00 Asia/Dubai. Exception: the instant reply in Workflow A.
- At most 3 automated messages per contact per 24 hours.
- The bot pauses for 24 hours after an agent sends a manual message.

**Workflow A — Instant capture (target under 30 seconds end-to-end):**
1. Assign the lead:
   - Sticky owner first.
   - Otherwise weighted round-robin over agents who are active, available and on shift.
   - Prefer agents who speak the lead's language and who cover the project.
   - Use `SELECT … FOR UPDATE`.
   - If nobody is available, put the lead in the unassigned queue and alert managers.
2. Send the approved WhatsApp template `lead_welcome_{lang}`:
   - Document header: agent-branded brochure.
   - Variables: name, project, agent, company.
   - Quick replies: PRICING, LOCATION, CALL_ME.
   - If there is no WhatsApp consent, send email instead.
3. Send an FCM push to the agent with a deep link and a click-to-call link.
4. Run async steps: lead score, tags, CAPI "Lead" event, enqueue Workflow B.
5. SLA job at 5 minutes: if the agent has not touched the lead, reassign it, alert the manager, and tag `sla-breach`.

**Workflow B — No-response follow-up (templates only, since the 24h window is closed):**
- **+2 hours:** WhatsApp `followup_2h` + a call task.
- **+24 hours:** WhatsApp `followup_24h` (image header, starting price) + project email + a call task.
- **+72 hours:** WhatsApp `followup_3d` (buttons: Still interested / Not now / Stop) + a "should I close your file?" email.
- **+96 hours:** mark Lost (unresponsive) and move to long-term nurture.

Stop conditions:
- Cancel all remaining steps when the lead replies on any channel, the stage moves past Attempted Contact, the opportunity closes, or the lead opts out.

Fallback:
- If a WhatsApp send fails because of Meta's marketing limits, send email instead.

**Workflow C — Inbound WhatsApp routing:**
1. Update `last_inbound_at`. This cancels Workflow B.
2. If the stage is Attempted Contact, move it to Engaged.
3. Resolve intent:
   - Use the button payload if there is one.
   - Otherwise match keywords in English and Arabic: PRICING, LOCATION, BROCHURE, PAYMENT, CALL_ME, STOP.
   - Otherwise ask the AI classifier.
4. Route by intent:

| Intent | Action |
|---|---|
| PRICING | Send prices from the `projects` table, plus buttons |
| LOCATION | Send a WhatsApp location message |
| BROCHURE | Send the branded PDF as a document |
| CALL_ME | Urgent push to the agent, a 5-minute task, tag `hot` |
| STOP | Add to DNC and send a confirmation |
| Unknown | Leave for a human; after hours, send one auto-acknowledgement |

5. A brand-new number becomes a new contact:
   - Source is `meta_ctwa` if there is an ad referral, otherwise `whatsapp_direct`.
   - Run Workflow A, but skip its template step and reply free-form, since the 24-hour window is open.

## UNIFIED INBOX
- **One thread per contact** mixing WhatsApp, email, SMS, internal notes and system events, each with a channel badge and delivery ticks.
- **24-hour window indicator.**
  - While the window is open, the agent can type free-form.
  - When it is closed, the composer only allows approved templates, filled in with contact data.
- **Filters:** Mine, Unassigned, All (manager+), channel, unread, stage.
- **Collision guard:** "X is replying…" with a 90-second soft lock.
- **Realtime:** WebSocket/SSE, falling back to 4-second polling.
- **Email:**
  - Outbound from the agent's own address, with `Reply-To: reply+{conversation_id}@domain`.
  - Inbound via an IMAP poll.
- **Contact 360 side panel:**
  - stage, score, AI summary, budget, project, tags, tasks
  - quick actions: send brochure, book meeting, move stage, call

## TEMPLATE RULES (Meta WhatsApp)
- **Categories:** MARKETING, UTILITY, AUTHENTICATION.
- **Components:**
  - HEADER: text, image, video or document.
  - BODY: up to 1,024 characters, variables `{{1}}…`.
  - FOOTER: up to 60 characters.
  - BUTTONS: up to 10; quick-reply text up to 25 characters.
- **Variables:** a body must not start or end with a variable, and variables must not be adjacent. Provide examples.
- **Languages:** keep English and Arabic versions.
- **Sync:** pull template status from the API and alert when a template is paused or rejected.
- **Day-one library:**
  - lead_welcome, followup_2h, followup_24h, followup_3d (Marketing)
  - appointment_confirm, appointment_reminder, agent_new_lead_alert (Utility)
  - new_launch_alert (Marketing)


## PROJECT LIBRARY — OFF-PLAN (part of the CRM launch, build before Sales offers)
The single source of truth for every off-plan project. Everything else — the pipeline, the AI, the WhatsApp replies and the sales offers — may only quote what is stored here. **Private to the team now; a public website listing is planned for later**, so the visibility switch is built from day one even though the public option stays off.

### Library screen
- **Cards** with cover photo, project name, developer, community, status pill (Selling now / Coming soon / Sold out), a **Private** badge, price from, unit type, handover, payment plan, units available, and a **Sales offer** button that starts an offer from that project.
- **Filters:** All · Dubai · Abu Dhabi · Selling now · Coming soon · Our picks (starred). Plus free-text search over project, developer and community.
- **Add project** (see the wizard below) and **Import** (developer price list as CSV/XLSX, or a PDF the AI reads).
- Agents can view and build offers; only owner, admin and managers can add, edit or delete a project.


### Library extras (must build)
- **4 KPI cards across the top**, each clickable straight through to that project:
  1. **Most leads this month** — the project bringing the most leads, with its offers-sent count and a 7-day bar sparkline.
  2. **Trending now** — biggest week-on-week rise in leads, shown as a percentage. Styled warm so it stands out.
  3. **Best converting** — highest lead → reservation rate, with the deal count.
  4. **Available inventory** — total units available and their total value, plus a mini bar list of the top 3 projects by stock.
  All numbers come from real queries over `opportunities`, `offers` and `units`. Agents see their own numbers; managers their team's; owner/admin everything.
- **Emir AI search bar** above the filters. Plain-language queries such as "2 bedroom under AED 2M in Dubai", "handover before 2028", "Abu Dhabi waterfront", "Golden Visa eligible", "ready to sell today", "Emaar only". Show suggested example queries as chips. After searching, show a result banner: *"Emir AI found N projects"* plus a chip for every filter it understood (Dubai · Under AED 2M · 2 bedroom) and a **Clear** button. The AI turns the sentence into structured filters over the database — it never invents a project.
- **Row menu (⋯) on every project card and on the project page:** open, create sales offer, copy project link, edit, duplicate, add/remove from our picks, **archive**, **delete**.
- **Deleting a project** opens a confirmation panel that states plainly:
  - what is deleted: the project, its units and prices, payment plans, photos, floor plans and documents;
  - what stays: the leads (project name kept as text), any sales offers already sent to clients, and Won deals and commissions in Books;
  - an **Archive instead** option, recommended;
  - the user must **type the project name** to enable the delete button.
  Delete and archive are owner/admin only and both are written to `audit_log`.

### Project page — tabs
1. **Overview** — a stat strip (price from, handover, payment plan, total units, available, our commission, DLD project number, construction %), the description with a **Rewrite with Gemini** button, a construction progress bar, key facts (developer, emirate, community, ownership, escrow, Golden Visa threshold, service charge per sq ft, last price update) and the developer incentives.
2. **Units & prices** — the full inventory table: unit no., type, floor, internal area, balcony, view, price, price per sq ft, status (Available / On hold / Reserved / Sold). Multi-select rows → **Offer selected**. **Update price list** re-imports from the developer file and shows what changed. This table is the only price source the system may quote.
3. **Payment plans** — one or more named plans (e.g. Standard 60/40, Post-handover 40/60), each a milestone list with % and due date. Offers may only use a plan listed here.
4. **Photos & video** — gallery upload plus video links (YouTube/Vimeo), with a 360 tour field.
5. **Floor plans** — per layout (1BR, 2BR type A/B/C, 3BR, key plan), uploadable and sendable.
6. **Amenities** — a chip list that can be switched on or off per project, plus custom entries.
7. **Documents** — a drop zone and a file list: **developer sales offer**, brochure (EN/AR), price list, floor plan pack, master plan, payment plan sheet, RERA/DLD project certificate, commission agreement, SPA template. Each file can be opened or sent on WhatsApp. If a developer sales offer PDF is uploaded here, the offer builder attaches **that file** instead of generating its own sheet.
8. **Location** — map, coordinates, sales centre details and an editable distances list (airport, downtown, marina, mall, schools, hospital).
9. **Developer** — legal name, ORN/TRN, escrow bank, track record, and the developer's own contacts (broker relations, inventory, bookings email) with call/WhatsApp/email buttons.
10. **Commission** — our rate, the value on a sample price, payment terms, agreement date, average days to be paid, default agent split, plus how the project performs (leads, reply rate, viewings, reservations, cost per deal, offers sent). **Visible to owner, admin and managers only — never shown in a client offer.**
11. **Visibility** — Private (team only) · Specific team only · **Public on the website (built but switched off, marked "coming later")** · Shareable project link that sends the whole project page to a client without building an offer.

### Adding a project — Emir AI does the typing
The **Add project** flow starts by asking how to begin, because typing a project by hand is the slow way:
1. **Drop a developer file** (recommended) — sales offer, brochure or price list. Emir AI reads it and fills project name, developer, community, emirate, type, status, handover, DLD number, price from, payment plan, the unit list, amenities and photos. A progress checklist shows what it is reading; each filled field is highlighted and carries a confidence score.
2. **Paste a link** — the developer's project page or a portal listing; AI pulls the facts and images.
3. **Type it myself** — a blank form with an Emir AI button beside the fields that benefit.

Nothing is saved until the user confirms. The wizard has 5 steps with a **live project card preview** and a **completeness ring** beside it:
1. **Basics** — name (with a **duplicate check** button), developer (select, or **New developer** inline), emirate, community, property type, status, handover, DLD/RERA number, ownership, escrow, cover style.
2. **Prices & units** — price from, payment plan, service charge per sq ft, Golden Visa threshold, plus a drop zone for the price list that AI turns into the unit table. AI flags a price per sq ft that is out of line with the community.
3. **Description** — **Write with Emir AI** from the entered facts only, with one-tap rewrites (shorter, more luxury, investor, family, Arabic, Russian); **Suggest selling points** (4 short lines for WhatsApp); **Suggest buyer** (best fit, budget band, languages, timeline, plus how many CRM leads match and a "build call list" action); **Generate marketing text** (WhatsApp blurb, Instagram caption, ad headline).
4. **Media & documents** — photo drop zone where AI names each image and picks the cover, video link, document drop zone (developer sales offer, brochure, price list), and **Detect amenities from the brochure**.
5. **Commission & visibility** — our commission, default agent split, payment terms, agreement date, then the visibility switches. A final **Emir AI check** confirms no duplicate, handover in the future, price in range, documents attached.

### Developers
A **Projects | Developers** switch at the top of the library. Each developer card shows logo, head office, ORN, project count, contact count and commission rate. Opening one gives:
- Legal name, short name, **ORN**, **TRN**, head office, escrow bank.
- Our commission, payment terms, agreement date, average days to be paid.
- **Their sales contacts** — name, role, direct mobile/WhatsApp, email, with call, WhatsApp and email buttons. This is where the developer's sales agents' numbers live. Contacts can be added and removed.
- **Add developer** has an Emir AI button that fills the legal name, ORN, TRN and address from their website for the user to check.
- Developer contacts and commission terms are visible to owner, admin and managers only, and never appear in a client offer.

### Rules
- Prices, sizes, plans, handover dates and availability live only here. The AI, the WhatsApp auto-replies and the offer builder read from this table and never invent a figure; a missing field is left blank, not guessed.
- Every price-list import is versioned, so an offer always records which price version it used.
- Changing a price or a unit status writes to `audit_log` and flags any open offer that used the old figure.
- Commission and performance data are hidden from agents and never leave the CRM.

**Tables:** `projects` (name, developer_id, description, buyer_profile, marketing_copy, emirate, community, type, price_from, handover, status, rera_no, escrow, service_charge_sqft, construction_pct, visibility, starred), `units`, `unit_price_versions`, `payment_plans`, `payment_plan_rows`, `project_media`, `project_floorplans`, `project_amenities`, `project_documents`, `project_locations`, `developers` (legal name, short name, ORN, TRN, head office, escrow bank, commission, payment terms), `developer_contacts` (name, role, phone, whatsapp, email), `project_commissions`, `project_imports` (source file, extracted JSON, confidence, confirmed_by).

## SALES OFFERS (part of the CRM launch)
A builder that turns a lead + a project into one private, branded offer page the client opens on their phone, plus a matching PDF and a ready WhatsApp message. Offers live in a Google-Drive-style library.

**Why it exists:** agents currently send a brochure PDF and lose the thread. An offer page is personal, trackable and holds prices for a deadline, so the agent knows exactly when to call.

### Library (Drive-style)
- **Folders:** create, rename, drag-and-drop, nest one level (e.g. "Saadiyat Island", "VIP investors", "Templates").
- **Views:** grid (cover image cards) and list. Search across client name, project, agent and offer title.
- **Filters:** All · Starred · Opened by client · Drafts · Trash.
- **Cards show:** cover photo, project, client name, status pill (Draft / Sent / Opened / Reading now), opens count + total time, owner avatar.
- **Row menu:** open, preview as client, copy private link, send on WhatsApp, download PDF, star, duplicate, rename, move to folder, move to trash.
- **Trash:** restore or delete forever; auto-purge after 30 days. Only owner/admin can delete forever.
- **Permissions:** agents see their own offers; managers their team's; owner/admin everything. Templates folder is shared and read-only for agents.

### Builder (5 steps)
1. **Client** — pick a lead from the CRM (or type a new one), budget shown, unit type, and **offer language** (English / Arabic / Russian / Hindi). The whole offer and the WhatsApp message are written in that language.
2. **Project & units** — pick a project from the **project library**, then tick the specific units from its inventory (unit no., floor, size, balcony, view, price, status). Attach brochure PDF, floor plans, video link and the project page URL. Prices, handover date and payment plan come from the `projects` table only.
3. **Content** — AI writes "About this project" with a **Write with Gemini** button, plus one-tap rewrites: Shorter · More luxury · For an investor · For a family. Below it, a reorderable list of sections with on/off switches:
   - Cover & personal greeting *(always on)*
   - Photo gallery · About this project · Why it fits you
   - Prices & availability · **Full cost breakdown** · Floor plans
   - Payment plan · **Developer incentives** · **Developer sales offer**
   - Video tour · Location & what is nearby
   - **Ownership, fees & visa** · **How the purchase works** · **Questions people ask**
   - About the developer · About the company
   - Your agent · Message from the CEO · Follow us
   - Next steps *(always on)*
4. **Branding & people** — choose who appears: **Me + the agent** (default) · Only the agent · Only me · Company only. Pick which social links show. Pick a cover style.
5. **Share** — choose what the client gets (both documents, presentation only, or developer sales offer only), private link, price-hold deadline (adds a live countdown to the page), notify-me-on-open toggle, optional phone-number gate, allow client reactions/questions, and an AI-written WhatsApp message. Buttons: Send on WhatsApp · Email it · Download PDF.

A **live phone preview** sits beside every step and updates as sections are toggled.

### Two documents, one offer
Every offer produces **two views** the agent can send together or separately:
1. **Client presentation** — the rich, friendly page below.
2. **Developer sales offer** — the formal offer sheet in the developer's own format (see below).
A segmented control at the top switches between them. In the builder's Share step the agent chooses: send both, presentation only, or developer sales offer only.

### The client presentation page
- Own private URL (`/offer/{slug}`), no login, mobile-first, same glass design, RTL for Arabic.
- **Hero:** cover photo, "Prepared for {client} · {date}", project name, price-hold countdown, and trust badges (DLD escrow protected · Freehold · Golden Visa threshold · construction %).
- **Quick stats:** price from · size range · handover · payment plan.
- **Sticky section nav** that scrolls to each part of the page.
- **Personal greeting** from the agent.
- **Why I picked these for you** — 3–4 reasons tied to what the client actually said (budget, view, timeline, visa).
- **The project:** gallery, AI-written description, then a **key-facts grid** — developer, community, ownership, project status, completion, total units, DLD project number, escrow registered. Plus a **construction progress bar** and an **amenities list**.
- **Units held for you:** a side-by-side **comparison table** (floor, internal area, balcony, view, parking, price, price per sq ft, status) with a heart on each unit and a "See full cost" button that switches the cost section to that unit.
- **Full cost breakdown** for the selected unit: unit price, price per sq ft, DLD 4%, Oqood, trustee/admin, **total to own it**, plus "cash to start" versus "rest until handover", and a line stating the agency commission is paid by the developer.
- **Payment plan:** visual timeline plus a table of milestone · % · due date · AED amount, totalled.
- **Developer incentives:** DLD waiver, free service-charge years, post-handover option — each as a card.
- **Location:** map plus a distances list (airport, Downtown, Marina, mall, school, hospital).
- **Floor plan and video.**
- **Ownership, fees & visa:** yearly service charge (per sq ft × area), cooling/utilities, Golden Visa threshold, mortgage availability, resale-before-handover rules, escrow protection.
- **How the purchase works:** 6 numbered steps (reserve → SPA → Oqood → milestones → snagging/handover → after handover) and a checklist of documents needed from the buyer.
- **About the developer** (with track record) **and about the company.**
- **Your team:** agent and/or CEO cards with photo, role, BRN and contact buttons.
- **FAQ:** 7 expandable answers, all editable (foreigner ownership, missed instalment, escrow, resale, mortgage, Golden Visa, yearly costs).
- **Ask-a-question box** that lands in the CRM inbox on that lead.
- **Follow us** links, then a footer with company legal name, TRN, contacts and a full **disclaimer**: prices, availability, sizes, fees and plan are the developer's and subject to written confirmation; areas approximate; government fees can change; visa eligibility decided by the authority; the page is information, not a contract, and does not replace the SPA or legal advice.

### The developer sales offer (formal sheet)
A clean, printable A4-style document that mirrors what developers issue, so the client recognises it:
- **Letterhead:** developer name, address, ORN/TRN, offer reference number, issue date, "issued through {brokerage}", and a **valid-until** stamp.
- **Prospective purchaser:** name, mobile, email, nationality.
- **Property:** project, unit number, floor, type, internal area, balcony, view, parking, ownership, anticipated handover.
- **Price & purchase costs table:** unit price (with price per sq ft), DLD 4%, Oqood, trustee/admin, **total purchase cost**.
- **Payment schedule table:** # · milestone · % · due · amount, totalled.
- **Developer incentives** and **escrow & registration** blocks (escrow account, DLD project number, payment method, payable-to).
- **Terms & conditions:** a numbered list covering validity, not-a-contract, subject-to-confirmation, approximate areas, government fees, payment to escrow only, SPA within 14 days, late-payment consequences, independent advice, commission paid by developer.
- **Signature blocks** for purchaser and for the issuing brokerage (agent name, BRN, phone).
- **Footer** repeating the legal identifiers and stating figures must be confirmed in writing before payment.
- **Actions:** download as PDF, send to client, send for e-signature, start reservation.

Fields are populated from `projects`, `units` and `developers`; anything missing is left blank rather than guessed. If the developer supplies their own offer PDF, it can be uploaded and attached instead, and the generated sheet is skipped.

### Tracking (the part that makes it worth building)
- Record: opened at, device, city, opens count, total time, **time per section**, units hearted, brochure downloaded, link forwarded (new device on same link), questions asked.
- Agent gets a push/WhatsApp alert the moment the client opens it, and again on a heart or a question.
- A **Live tracking** panel per offer shows all of the above plus a one-paragraph AI reading of intent and a recommended next step.
- Feed "offer opened" and "offer engaged" into the lead score and into Meta CAPI as engagement signals.

### PDF
Same content as the page, branded with company logo, agent name, photo, BRN, phone and email. Generated server-side. The PDF has no tracking — say so in the UI so agents prefer the link.

### Rules
- Never invent prices, availability, handover dates, payment plans, floor plan sizes or ROI. Everything numeric comes from the `projects` and `units` tables; if a field is missing, leave the section out rather than guessing.
- AI writes prose only, and every AI draft is editable before sending. Nothing is sent without the agent pressing send.
- An offer link can be revoked, and expires automatically a configurable number of days after the hold deadline.
- Client questions and hearts are personal data: store under the contact, covered by the same consent and PDPL rules.
- Every create, send, edit and delete is written to `audit_log`.

**Tables:** `offers` (slug, doc_types, contact_id, opportunity_id, project_id, agent_id, language, sections JSON, cover, hold_until, status, folder_id, starred, deleted_at), `offer_units` (unit no., floor, internal area, balcony, view, parking, price, status), `offer_terms`, `developers` (legal name, ORN/TRN, address, escrow bank), `offer_incentives`, `offer_views` (opened_at, device, city, duration, sections JSON), `offer_events` (heart, question, download, forward), `offer_folders`, `offer_templates`.

## EMIR AI IN THE CRM (Gemini) — part of the CRM launch
An AI layer on top of the CRM, powered by **Google Gemini** through the paid Gemini API. Use the paid tier so client data is not used to train Google's models. Keep it behind the provider-agnostic AI interface, with the API key in `.env` only.

**1. AI lead check (top of the Dashboard):**
- Refresh every morning and on demand. Show "read X leads, Y messages, Z calls · N min ago" and a Gemini badge.
- **What's happening:** 3 short points on trends (lead volume and source changes, best project, language or response patterns).
- **Problems found:** 3 short points on issues, for example:
  - junk-lead rate by form or ad set
  - slow agents
  - hot leads not called
  - stuck deals
  - template failures
- **Do this today:** 3–5 numbered actions, each with a button that opens the right list or screen, drafts a rule for approval, or asks Emir AI "why".
- **Grounding:** every number must come from real database queries. Gemini writes the wording only, and never invents numbers.

**2. AI lead quality check (every lead):**
- **Verdicts:** 🔥 Hot / Good / Weak / Junk, each with a one-line "why" and a "best next step".
- **Signals used:**
  - valid phone and name, duplicate or spam patterns (same IP or number reused)
  - budget vs the project's real prices, timeline
  - WhatsApp reply speed and wording (intent), brochure opens, call outcomes
  - source quality history
- **Where verdicts show:**
  - on the pipeline card and Contact 360
  - in a dashboard table with filter chips and counts
  - in smart-list filters
- **What a verdict can change:**
  - the lead score (0–100)
  - "Junk" suggests "Mark invalid", which the agent confirms; the AI never deletes or closes anything itself
- **Re-scoring:** re-score when new messages, calls or stage changes arrive.
- **Feedback loop:** feed confirmed Junk/Valid back into Meta CAPI lead-quality events (valid_lead / invalid).

**3. "Ask Emir AI" button (floating, bottom-right on every CRM screen):**
- A chat that understands the whole CRM: leads, pipeline, WhatsApp and email threads, calls, tasks, campaigns, agents, projects and sources.
- **Example questions:**
  - "Which leads should I call first?"
  - "Why so many junk leads?"
  - "Which campaign works best?"
  - "How is Raj doing?"
  - "What should we do today?"
  - "Summarise Ahmed Khan's chat"
- **How it works:** Gemini function-calling over **read-only**, permission-checked tools (search_leads, get_lead, get_pipeline_stats, get_source_quality, get_agent_stats, get_conversation, get_campaign_stats).
- **Permissions:** answers respect the user's role. Agents only get data about their own leads, managers their team, owner/admin everything.
- **Actions:** it can **suggest** actions and create drafts (call list, routing rule, message draft), but every change needs a human click to confirm.
- **Answers:**
  - English and Arabic
  - include links to the leads or lists they mention
  - say "I don't know" rather than guess
  - never invent prices, availability or payment plans (projects table only)
- **Logging:** log every AI request (user, tools called, tokens), with a monthly cost cap set in Settings.
- **Emir Books:** it has its own separate "Ask Books" assistant (see Emir Books); the two share code but not permissions.

**Tables:** `ai_insights` (daily snapshots), `lead_ai_scores` (verdict, reasons, next step, model, version, scored_at), `ai_conversations`, `ai_messages`, `ai_usage`.

## BULK IMPORT, LISTS & TEAM ASSIGNMENT (part of the CRM launch)

**Bulk import (large files, 100,000+ rows):**
- **File types:** CSV and Excel (.xlsx), uploaded with drag and drop. Also paste-from-sheet.
- **Background processing:** process the file as a background job in chunks (e.g. 1,000 rows at a time) with a live progress bar. The user can leave the page while it runs. Never import in one request.
- **Step 1 · Upload:** show a preview of the first 20 rows.
- **Step 2 · Map columns:**
  - AI auto-suggests the mapping (e.g. "Mobile No." → phone, "Budget AED" → budget)
  - mappings can be saved as templates for the next import
- **Step 3 · Clean and check:**
  - phones normalised to E.164 (default UAE), emails lowercased, spaces and duplicates inside the file removed
  - invalid rows shown with the reason
- **Step 4 · Duplicates against the CRM**, using the same identity rules as ingestion:
  - choose "skip", "update empty fields only" or "create anyway (flag)"
  - never overwrite an agent's work
- **Step 5 · Settings:**
  - source (e.g. "Import – Expo 2026", "Old database", "Referral list"), tags, project interest, pipeline and starting stage
  - consent status: opted-in / unknown / no consent
- **Step 6 · Assign the imported leads** (see Team assignment below).
- **Step 7 · Import report:** created, updated, skipped and failed counts, with the failed rows downloadable as CSV to fix and re-upload.
- **Undo:** an import can be undone within 24 hours, which deletes only the contacts it created and only if nobody has worked on them.
- **Imported contacts:**
  - do NOT trigger Workflow A (no instant WhatsApp)
  - get their own optional "imported list" workflow instead

**Contact lists and campaigns (working the leads):**
- **Lists:** saved lists and smart lists (filters such as source, tag, project, budget, stage, last contacted, owner, language).
- **Call campaign / power dialler view:**
  - one lead at a time, with name, history, project and budget
  - buttons: Call, WhatsApp, Log outcome (answered, no answer, busy, wrong number, not interested, interested)
  - next lead appears automatically; progress shown as "36 of 250 done"
  - an "Interested" outcome moves the lead into the main pipeline
- **Bulk actions on any selection:** assign/reassign, add or remove tag, change stage, add to list, enroll in workflow, export (owner/admin only), delete (owner only, audited).
- **Bulk WhatsApp** only to contacts with WhatsApp consent, only with approved templates:
  - send in throttled batches that respect Meta's messaging limits and the quality rating
  - show a warning with the count of contacts that will be skipped for missing consent
  - automatically pause the campaign if the quality rating drops or the block/report rate rises
  - never send cold bulk WhatsApp to contacts without consent, because this can get the number banned
- **Campaign dashboard:** contacted %, reached %, interested, appointments, per agent.

**Team assignment (who works on which leads):**
- **Teams:** e.g. "Arabic desk", "Russian desk", "Abu Dhabi team", "Dubai team". Each team has a manager and members.
- **Assignment methods (for imports, lists or any selection):**
  - one agent
  - one team, round-robin inside it
  - split evenly across chosen agents
  - split by percentage (e.g. Sara 40%, Omar 30%, Lina 30%)
  - by rule (language, project, emirate, budget band)
  - **shared pool:** leads stay unassigned and agents press "Claim next lead"
    - claims are limited per agent (e.g. max 50 open claimed leads)
    - claimed leads return to the pool if untouched for X days
- **Workload balance:** show each agent's open-lead count before assigning, and warn if someone is overloaded.
- **Automatic recycling:** leads with no activity for N days are reassigned or returned to the pool. The rule is configurable per list.
- **Visibility:**
  - agents see only their own and pool leads
  - managers see their team
  - owner/admin see everything
- **Audit:** every assignment and reassignment is logged.

**Tables:** `imports`, `import_rows` (status + error), `import_mappings`, `lists`, `list_members`, `campaigns`, `campaign_members` (outcome, attempts), `teams`, `team_members`, `assignment_rules`, `lead_pool_claims`.

## EMIR BOOKS — SEPARATE ACCOUNTING APP
A complete accounting system for the brokerage. It is a **separate app** from the CRM, with its own navigation, colour (cool indigo instead of teal) and permissions. It shares the same login, database, design system and codebase.

**How to reach it:**
- An **app switcher at the bottom of the sidebar** (CRM | Books) swaps the whole navigation.
- On mobile, the switcher is in the bottom bar.
- Leads never appear inside Books, and accounting never appears inside the CRM. The only link between them is the deal: Won deals and ad spend flow into Books automatically.
- Users who only have the `accountant` role open straight into Books and don't see the CRM switcher.

**Books navigation:**
- **Home**
- **AI:** AI copilot (with the Ask Books chat available on every screen)
- **Money in:** Invoices, Commissions
- **Money out:** AI inbox, Expenses, Payroll, Agent payouts, Office & rent, Marketing spend
- **Control:** Banking, VAT & reports, Automations
- **Books settings:** company details, TRN, bank details, logo, invoice template, numbering, categories, chart of accounts

**Tables:**
- **Money in:** `invoices`, `invoice_lines`, `credit_notes`, `payments`, `commissions`, `recurring_invoices`
- **Money out:**
  - `bills`, `expenses`, `expense_categories`, `suppliers`
  - `documents` (uploaded file + AI-extracted fields + status)
  - `employees`, `payroll_runs`, `payslips`
  - `agent_splits`, `agent_payouts`
  - `leases`, `rent_cheques`, `recurring_costs`
  - `licences` (trade licence, broker cards, insurance, Ejari), `marketing_budgets`
- **Control:** `bank_accounts`, `bank_transactions`, `reconciliations`, `ledger_entries`, `accounts` (chart of accounts), `vat_periods`, `period_locks`, `automation_rules`, `company_settings`

**Money rules (non-negotiable):**
- Store amounts as integers in fils. Never use floats for money.
- Double-entry ledger: every posting writes balanced debit and credit rows. All reports come from the ledger.
- Posted invoices, payments and journal entries can never be edited or deleted. Corrections are made with credit notes or reversing entries.
- Month close locks a period. Only the owner can reopen it, and reopening is audited.
- Nothing is ever filed with a government authority automatically. VAT and corporate-tax outputs are summaries for the accountant or tax agent to review.

**Home:**
- Headline numbers: commission received, due from developers, expenses, net profit (after agent commissions).
- Panels: income vs expenses by month, cash and bank balances, receivables by age (0–30, 31–60, 61–90, 90+ days).
- A "needs attention" list, where each item links to its screen: overdue invoices, deals not invoiced, payouts due, VAT due, missing receipts, expiring licences and visas, upcoming rent cheques.

**Invoices:**
- **Automatic invoices:**
  - When a CRM deal moves to Won, create the commission and a **draft** tax invoice to the developer.
  - The accountant reviews and sends it. Auto-created invoices show an "Auto" badge.
- **Manual invoices:** "New invoice" editor with bill-to (developer or other client), multiple line items (description, qty, amount), VAT 5%, live totals and a live invoice preview.
- **Recurring invoices** are supported.
- **Invoice content:**
  - company legal name and TRN; client name and TRN
  - sequential gap-free number, issue date and due date
  - lines, subtotal, VAT shown separately, total in AED
  - bank details
- **Output:** PDF, emailed to the client's finance contact.
- **Payments and filters:**
  - partial payments and credit notes
  - "Mark paid", which releases the linked agent payout
  - filters: All, Unpaid, Overdue, Paid
- **Reminders** at 7, 30 and 60 days overdue, each approved before sending.

**Commissions:**
- One row per Won deal: sale price, developer, rate, commission, VAT, agent, status (Not invoiced, Invoiced, Partly received, Received, Overdue, Cancelled).
- Co-broker and referral splits.

**AI inbox (document upload):**
- **How documents arrive:**
  - drag-and-drop or photo upload of bills, receipts, contracts and statements (PDF or image)
  - an email-forwarding address (e.g. books@company) also feeds this inbox
- **AI extraction:**
  - fields: supplier, supplier TRN, date, amount, VAT, currency, suggested category, a confidence score for each field, and a duplicate check
  - each card shows "Reading…" while it works, then the extracted fields with Edit and Approve buttons
- **Approval:** approving creates the expense or bill, attaches the file and posts to the ledger. Nothing is posted without human approval.

**Expenses:**
- **Categories:**
  - Marketing, Salaries & visas, Office rent, Utilities, Internet & phones
  - Cleaning & maintenance, Parking, Software, Licences & permits, Insurance
  - Transport & fuel, Referral fees, Bank charges, Entertainment, Other
- **Each expense records:** date, supplier, amount, input VAT, payment method, account and receipt. Expenses without a receipt are flagged.
- **Recurring expenses** are supported.
- **Display:** spending by category with animated bars, plus a recent-expenses table.

**Payroll:**
- **Employee records:**
  - role, basic salary, housing allowance, transport allowance, other allowances, deductions
  - bank/IBAN, visa and Emirates ID expiry dates, joining date
- **Monthly payroll run, step by step:**
  1. Calculate
  2. Owner approval
  3. Generate the WPS salary file (SIF)
  4. Email payslips
- **End-of-service gratuity:** track accruals per employee.
- **Alerts:** warn 30 and 7 days before visas or IDs expire.
- **Sales agents:** their base salary goes through payroll, while their commission is paid through Agent payouts.
- **Disclaimer:** show that the accountant must check payroll and gratuity figures.

**Agent payouts:**
- Default split per agent, which can be overridden per deal.
- An agent's share becomes "Ready to pay" only after the developer has paid the brokerage.
- Payouts need approval before they are paid.
- Monthly statements are emailed to agents. Agents can view their own statement read-only.

**Office & rent:**
- **Lease record:** premises, annual rent, number of cheques, Ejari expiry, security deposit, and the contract file.
- **Rent cheque schedule:** cheque number, date, amount, status (Upcoming, Due, Cleared, Bounced).
- **Recurring office costs:** utilities, internet, cleaning, parking, software, supplies. Each shows its next due date and an "Auto" badge when it's added automatically.
- **Licences and renewals:** trade licence, broker cards, insurance, Ejari. Each has an expiry reminder.

**Marketing spend:**
- **Budget vs actual per channel:** Meta, Google, property portals, events, design/print, influencers. Over-budget channels are flagged.
- **Daily sync:** pull spend from Meta and Google automatically.
- **Headline numbers:** spent vs budget, cost per lead, cost per deal, return on spend (commission ÷ spend). Cost per deal is also shown per channel.
- **AI suggestions** on where to move budget, as suggestions only.

**Banking:**
- **Accounts:** operating, client deposits (kept separate from company money), petty cash.
- **Statement import:** CSV or PDF.
- **AI matching:** suggest a match for each transaction against invoices, expenses, payroll or rent cheques, showing matched / suggested / no match.
- **Human confirmation:** a person confirms each suggestion before it is reconciled.

**VAT & reports:**
- **VAT return summary per quarter:** output VAT minus input VAT equals net VAT, with the due date (28 days after the period ends) and an export for the tax agent.
- **Reports:**
  - profit & loss, balance sheet, cash flow, trial balance, general ledger
  - commission by agent, commission by developer
  - marketing cost per deal, payroll summary
  - corporate tax estimate
  - audit trail
- **Export:** Excel/CSV and PDF.

**AI copilot (Books):** a dedicated screen plus AI features across the app.
- **Morning money brief:**
  - three plain-language points shown at the top of Books Home
  - optional email at 8 AM
- **Cash forecast, next 90 days:**
  - built from open invoices (each developer's average payment delay), scheduled rent cheques, payroll, VAT due, agent payouts and expected new deals
  - chart shows actual cash, the forecast line, a likely range and markers for big payments
  - lists the assumptions it used
- **Anomaly detection:**
  - duplicate bills
  - short or over-payments versus the invoice
  - unusual cost jumps against the 3-month average
  - payouts about to go out before the developer has paid
  - unmatched deposits
  - each finding has a one-click action (merge, draft query, review, hold payout, match)
- **Smart collections:**
  - predicts each invoice's payment date and risk score from that developer's payment history
  - drafts the reminder email: polite or firm, shorter, English or Arabic
  - the accountant edits and sends it; nothing is sent automatically
- **Month-end close assistant:** runs the checklist and flags what blocks locking the month.
  - bank reconciled
  - receipts complete
  - recurring costs posted
  - Won deals invoiced
  - payroll posted
  - payouts reviewed
  - VAT checked
- **Learned rules:** after 3 similar approvals, suggest a rule (e.g. bank text "FACEBK ADS" → Marketing · Meta ads). Rules can be switched on and off.
- **Ask Books:** a floating chat on every Books screen that answers questions from the company's own ledger data (spend, money owed, profit, VAT, payroll, rent, cash, "can we afford…").
  - It only uses real numbers from the database, through safe read-only queries or tools.
  - It says so when it doesn't know.
  - It never changes data.
- **Receipts on WhatsApp:** agents send a receipt photo to the company WhatsApp number, and it lands in the AI inbox.
- **AI rules that always apply:**
  - AI only suggests and drafts; a human approves every posting, payment, email and filing
  - every AI suggestion stores its confidence score and source document
  - personal salary data is never sent to the AI except when needed for payroll questions asked by the owner or the accountant

**Automations** (each can be switched on or off):
- auto-draft the commission invoice on Won
- overdue reminders
- AI document reading
- AI bank matching (suggestions only)
- recurring bills
- daily ad-spend sync
- release the agent payout when the developer pays
- expiry warnings for licences, visas and cheques
- prepare the VAT summary (never filed automatically)
- anomaly detection
- 90-day cash forecast
- morning brief
- month-end close prep
- collection email drafts
- WhatsApp receipts
- learned rules

**Permissions:**

| Role | Access to Books |
|---|---|
| `accountant` | Full access to Books, except reopening a closed month |
| `owner` | Everything, including approvals and reopening periods |
| `manager` | Read-only for reports, and approves their team's payouts |
| `agent` | Only their own commission statement |

Salaries are visible only to the owner and the accountant.

## INTELLIGENCE & GROWTH FEATURES
- **Lead score (0–100)** from these signals: valid number, budget fit, timeline, WhatsApp reply, CALL_ME, pricing or brochure requests, re-inquiry, spam signals. A score of 70 or more is `hot` and triggers a manager push.
- **AI extraction** of budget, unit type, purpose, timeline, language and sentiment from messages. It fills empty fields only and shows an "AI-filled" chip for the agent to confirm.
- **AI summary** of 3 lines on Contact 360, plus suggested replies grounded only in `projects` data.
- **Source Quality report per ad:** CPL → valid% → contacted% → qualified% → appointment% → reservation%.
- **Agent metrics:**
  - median speed-to-lead
  - SLA breaches
  - contact rate, qualified rate, appointments, reservations
  - these feed the weekly "King of Emir" leaderboard
- **Branded brochure links:** `/b/{project}?a={agent}` tracks opens and notifies the agent when a lead opens the brochure.

## DESIGN
- Follow the approved design preview exactly: https://claude.ai/artifact/5cWxuZLa6VujaDK3QrSH77
- Style: minimal Apple-style frosted glass, one cool teal main colour, calm muted stage colours, smooth animations (count-up numbers, charts that draw in, screens that slide in), and full respect for the reduce-motion setting.
- Add a "Reduce glass effect" option in Settings for older devices.
- CRM uses cool teal; Emir Books uses cool indigo. The same glass design is used in both, with the CRM | Books switcher at the bottom of the sidebar.

## HARD RULES
- Never invent prices, handover dates, payment plans or ROI. Only use verified data from the `projects` table.
- Never send WhatsApp outside the 24-hour window without an approved template.
- Never send automated messages to DNC contacts or contacts without consent. Store the consent text shown to the lead (UAE PDPL).
- Handle secrets properly: keep them in environment variables, encrypt tokens at rest, and never commit or log secrets or full phone and email lists.
- Keep external API versions in one config constant; don't scatter them through the code.
- Every data-changing action writes to `audit_log`, with actor, role, before and after.
- Posted invoices, payments and ledger entries are never edited or deleted. Corrections are made with credit notes or reversing entries.
- Only the owner or admin can export or bulk-delete. Every such action is logged.
- If a requirement is ambiguous or an action is destructive (schema drop, data migration, bulk message, deployment, spending money), **stop and ask the owner first** — see ASK ME FIRST at the top of this file.
- When unsure about anything at all, ask. Never guess and never silently assume.

## HOW TO WORK
0. **Ask first.** Re-read the "ASK ME FIRST" section above before every phase. Questions in plain English, options with a recommendation, then wait for my answer.
1. **Plan first:** before each phase, write a short plan in plain English (what you will build, what it will look like, what could go wrong), ask me anything you are unsure about, and **wait for my OK**. No code before I approve.
2. **Build in this order:**
   1. Foundation: auth, roles, schema, audit
   2. Ingestion and dedup
   3. Kanban and Contact 360
   4. WhatsApp send/receive and templates
   5. Workflow engine and workflows A/B/C, round-robin, SLA, push
   6. Unified inbox
   7. CAPI / Google feedback, scoring, AI, reports
   8. Project library: projects, units & price versions, plans, media, documents, developers, commission, visibility
   9. Sales offers: library, builder, client page, tracking, PDF
   10. Emir Books app: ledger & settings → invoices & commissions → AI inbox & expenses → payroll → payouts → office & rent → marketing spend → banking → VAT & reports → automations → AI copilot & Ask Books
   11. Hardening
3. **Test as you go:**
   - Unit tests for normalization, identity resolution, round-robin and intent matching.
   - Replay tests using the sample webhook payloads in `/fixtures`.
   - Duplicate-storm test: the same lead 20 times in parallel must produce exactly 1 contact.
4. **Definition of done for each phase:**
   - Tests pass.
   - Migrations apply cleanly.
   - No TypeScript errors.
   - `README` and `.env.example` updated.
   - A short changelog entry written in `/docs/CHANGELOG.md`.
5. **Keep docs current:** `/docs/ARCHITECTURE.md`, `/docs/WEBHOOKS.md` (with sample payloads), `/docs/WORKFLOWS.md`.
6. **Report after each phase, in plain English:** what was built, a preview link or screenshots so I can see it, what still needs me (Meta app review, template approval, DNS/SMTP, keys, decisions), and any risks you found. End every report with: **"Is this right, or do you want changes?"** and wait.
7. **Never say a phase is done** until I have seen it and said OK.
