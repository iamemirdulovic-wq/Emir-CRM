# The leads screens — a brief for a designer

*Emigeo Homes Real Estate · brand **homes.me** · CRM at **crm.homes.me***
*Written 14 November 2026. Everything in `images/` is a photograph of the real
running screen, not a mock-up.*

---

## 1. Who this is for and what they are doing

Ten people, selling **Dubai and Abu Dhabi off-plan property**. Leads arrive from
Meta ads, click-to-WhatsApp ads, the website, Google Ads, inbound WhatsApp and
bulk imports. The database currently holds about **2,000 open leads**.

Three kinds of person open these screens:

| Who | What they are trying to do | Where they are |
|---|---|---|
| **Agent** (most of the team) | "Who do I ring next, and what do I say?" | Phone, mostly. Standing up, often in a car or a sales centre |
| **Manager / owner** | "Who is sitting on leads? What is going cold? Who is not calling?" | Laptop, 1440px |
| **Agent at a desk** | Working a list of 50–100 in one sitting | Laptop |

**The business rule that shapes everything:** a new lead must be contacted
within **5 minutes**. The CRM measures it, and an agent who misses it loses the
lead automatically. So every screen is really answering *"what is late, and
what do I do about it right now"*.

## 2. What is in the images folder

| File | Screen | Who sees it |
|---|---|---|
| `01-owner-all-leads-computer.png` | **All leads** — every agent's book | Owner, admin, manager |
| `02-agent-my-leads-computer.png` | **My leads** — one agent's own | Agent |
| `03-agent-my-leads-narrow.png` | The same at 1180px — a smaller laptop | Agent |
| `04-lead-page-computer.png` | **One lead**, the whole record | Everyone |
| `05`–`07` | The same three on a **390px phone** | Everyone |
| `08-add-lead-computer.png` | **Add a lead** by hand | Everyone |
| `09`, `10` | **Dark theme** | Everyone |

## 3. What is already decided, and should not be redesigned

These are not preferences; they are rules the business or the law puts on us.

- **One accent colour, orange** (`--accent`, `#FF4000`). Stage colours are
  deliberately muted so the orange stays the only thing that shouts.
- **24-hour time, everywhere.** No AM/PM. The office is international and the
  owner asked for this by name.
- **Dubai time, always** — UTC+4, no daylight saving. "Today" means today in
  Dubai even if the laptop is set to London.
- **Never show a number the database cannot prove.** If a field is empty it
  stays empty, or says so in words. A plausible-looking guess is worse than a
  blank — the whole CRM is built on this and it is not negotiable.
- **Every design token already exists** in `design/web/ui.css`. Please work in
  those tokens rather than introducing new colours, radii or shadows.
- **Dark theme is not optional.** Every screen has one and it is used.
- **RTL (Arabic) is coming**, so avoid layouts that only work left-to-right.

## 4. What the owner has said, in his own words

Collected over the last two days, unedited:

> *"Our all leads should be like move right left, same like sheet — too many
> data, it looks not good."*

> *"I don't like this one, that whole shadow please."*

> *"Make it more modern, a bit bigger, and nice way."*

> *"We need country based leads, language based leads, add also with flag, so
> our agents can see easily which country they can filter."*

> *"In the leads page before they open, it should be showing like simple nice
> way — this lead from where and which country, and when it's a good time to
> call. One short information about the lead."*

And from one of his agents, which started the last two days of work:

> *"Brother, there is one issue — you need to put dates on the leads once they
> assign, so we know which one is today leads, which one is yesterday, and
> which one is day before yesterday."*

## 5. What was fixed in the last two days

So you know what is fresh and why it looks the way it does:

- **Day bands down the list** — Today / Yesterday / Wednesday 12 Nov — each
  with the real count, and the hand-out time on every lead. Older than today
  turns warm orange with how long it has been sitting.
- **The table scrolls sideways like a sheet**, the lead's name pinned on the
  left. Before this a long name was cut off halfway, with no way to read the rest.
- **"Who has had this lead"** on the lead page — who first gave it out and
  every transfer since, with the reason the agent chose.
- **Lost and Won moved out of the working list** into their own tabs.
- **Every Call and WhatsApp button records before it opens the phone.**

## 6. The honest problems a designer could help with

This is the real ask. None of these are bugs; they are things that work and
still are not good enough.

1. **Density versus calm.** An owner's book is 2,041 rows with twelve possible
   columns. We made it scroll sideways, which solved the clipping and did not
   make it *pleasant*. What should a list of two thousand look like?
2. **Nothing is visually ranked.** A lead eight days cold and a lead that came
   in twenty minutes ago are the same size, the same weight, the same grey. The
   5-minute rule is the most important thing in this company and the design
   does not say so.
3. **The phone is where the work happens**, and the phone card currently carries
   name, project, stage, the hand-out time, the client's local time, a "good
   time to call" line, and two buttons. That is a lot for 390px.
4. **Empty and partial states are everywhere.** Half these leads have no
   project, no budget, no name — imports are messy. A row with four blanks
   should not look broken.
5. **The country and language filters** (chips with flags, counts, a moon when
   it is the middle of the night there) are being built now and are the newest,
   least-designed part.
6. **Dark theme has had less attention** than light.

## 7. What we can and cannot change

**Can:** any layout, spacing, hierarchy, typography scale, how a row is built,
what goes on a card, how filters are presented, empty states, motion.

**Cannot, without a conversation:** the orange, the 24-hour clock, the Dubai
clock, showing anything the data cannot support, or removing a field an agent
relies on. If a field looks pointless, ask — several of them are there because
somebody lost a deal without them.

## 8. Practical

- **Everything is a real screenshot** at 2× on a 1440px laptop and a 390px
  phone, light and dark.
- The design system is `design/web/ui.css` in the repository — tokens, type
  scale, spacing, the lot. Ask for it and it can be shared.
- Figma, Sketch, annotated screenshots, or a written critique are all fine. The
  team works from pictures; a clickable prototype is a bonus, not a
  requirement.
- **The one thing that matters most:** an agent opening this on a phone,
  standing up, with four minutes left on the clock, should know who to ring
  without reading.
