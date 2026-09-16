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
   8. Emir Books app: ledger & settings → invoices & commissions → AI inbox & expenses → payroll → payouts → office & rent → marketing spend → banking → VAT & reports → automations → AI copilot & Ask Books
   9. Hardening
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
