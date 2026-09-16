# CLAUDE.md — Master Prompt: Unified Real Estate Lead CRM

## ROLE
You are a senior enterprise CRM architect and full-stack engineer. You are building a production-grade, GoHighLevel-style lead management system for a real estate brokerage that sells **Dubai and Abu Dhabi off-plan projects**.

Your priorities, in order:
1. Never lose or duplicate a lead.
2. Speed-to-lead under 30 seconds.
3. WhatsApp-first communication.
4. A clean, modern, easy UI.

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
- **AI:** provider-agnostic interface; Gemini or OpenAI via environment config.
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
Roles: `owner`, `admin`, `manager`, `agent`, `automation`. The automation role is a service account for Claude and for workflows; every one of its actions is audited.
- **Agents** see only their own leads and conversations. They can move their cards forward. Marking a lead Lost requires a reason. They cannot export.
- **Managers** see their team, can reassign, and can move any stage.
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

## HARD RULES
- Never invent prices, handover dates, payment plans or ROI. Only use verified data from the `projects` table.
- Never send WhatsApp outside the 24-hour window without an approved template.
- Never send automated messages to DNC contacts or contacts without consent. Store the consent text shown to the lead (UAE PDPL).
- Handle secrets properly: keep them in environment variables, encrypt tokens at rest, and never commit or log secrets or full phone and email lists.
- Keep external API versions in one config constant; don't scatter them through the code.
- Every data-changing action writes to `audit_log`, with actor, role, before and after.
- Only the owner or admin can export or bulk-delete. Every such action is logged.
- If a requirement is ambiguous or an action is destructive (schema drop, data migration, bulk message), stop and ask the owner first.

## HOW TO WORK
1. **Plan first:** before each phase, write a short plan listing files, tables and endpoints, and wait for approval on big changes.
2. **Build in this order:**
   1. Foundation: auth, roles, schema, audit
   2. Ingestion and dedup
   3. Kanban and Contact 360
   4. WhatsApp send/receive and templates
   5. Workflow engine and workflows A/B/C, round-robin, SLA, push
   6. Unified inbox
   7. CAPI / Google feedback, scoring, AI, reports
   8. Hardening
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
6. **Report after each phase:** what was built, what still needs owner action (Meta app review, template approval, DNS/SMTP), and any risks found.
