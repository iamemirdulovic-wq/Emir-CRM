/**
 * The six emails the CRM ships with.
 *
 * Written to be sent, not to be a placeholder. The rules they follow are the
 * ones that actually decide whether a UAE property email gets a reply:
 *
 * - **Short.** These are read on a phone, usually at work. Anything past
 *   about 120 words is skimmed and deleted.
 * - **One question at the end.** An email that asks nothing gets no reply.
 *   An email that asks three gets no reply either.
 * - **No prices, no handover dates, no payment plans in the copy.** Those
 *   come from the projects table and go in an offer, where they are
 *   versioned. A number typed into a template is a number nobody updates and
 *   a promise the brokerage has to keep.
 * - **No pressure and no invented scarcity.** "Only 2 units left" written
 *   into a template is a lie the moment it is saved.
 *
 * They are seeded on first run and are editable afterwards. Editing one does
 * not bring the original back on the next deploy — the seed only inserts what
 * is missing, so an owner's wording is never overwritten by a release.
 */

export interface SystemTemplate {
  key: string;
  name: string;
  category: 'first_reply' | 'follow_up' | 'project' | 'appointment' | 'offer' | 'nurture';
  subject: string;
  previewText: string;
  body: string;
}

export const SYSTEM_TEMPLATES: SystemTemplate[] = [
  {
    key: 'first_reply',
    name: 'First reply',
    category: 'first_reply',
    subject: 'About {{project}} — {{agent_first_name}} from {{company}}',
    previewText: 'Thanks for your enquiry. A quick question so I send the right thing.',
    body: `Hi {{first_name}},

Thanks for your enquiry about {{project}}. I'm {{agent_name}}, and I look after buyers for this one.

I'd rather send you something useful than a generic brochure, so one quick question: are you buying to live in it or to invest?

Tell me that and I'll come back with the layouts and the current availability that actually fit.`,
  },

  {
    key: 'after_no_answer',
    name: 'After a call they did not answer',
    category: 'follow_up',
    subject: 'Tried to reach you about {{project}}',
    previewText: 'Happy to work around you — what time suits?',
    body: `Hi {{first_name}},

I tried to call you earlier about {{project}} — I know the timing might not have suited.

Nothing urgent, and no pressure. If you'd still like the details, just tell me a time that works and I'll call then. Evenings are fine.

If you've moved on or bought elsewhere, tell me that too and I'll stop chasing you.`,
  },

  {
    key: 'project_details',
    name: 'Sending project details',
    category: 'project',
    subject: '{{project}} — the details you asked for',
    previewText: 'Layouts, the payment plan and what is available right now.',
    body: `Hi {{first_name}},

Here are the details for {{project}}, as promised.

I've attached the brochure and the floor plans. The current prices and what's still available are in the link below — that comes straight from the developer's list, so it is what it is today rather than what it was last month.

Have a look and tell me which layout you prefer. If one of them is close but not quite right, say what's wrong with it and I'll find you something better.`,
  },

  {
    key: 'viewing_confirmation',
    name: 'Confirming a viewing',
    category: 'appointment',
    subject: 'Confirmed — {{project}} viewing',
    previewText: 'Here is where to meet and what to bring.',
    body: `Hi {{first_name}},

Your viewing at {{project}} is confirmed. I've put the time and the location in the calendar invite attached to this email.

Bring your Emirates ID or passport — the sales centre will ask for it at the door. Nothing else is needed.

If anything changes, call or WhatsApp me on {{agent_phone}} and I'll move it. No notice needed.`,
  },

  {
    key: 'after_viewing',
    name: 'After a viewing',
    category: 'follow_up',
    subject: 'Good to meet you at {{project}}',
    previewText: 'What did you think — and what would you change?',
    body: `Hi {{first_name}},

Good to meet you at {{project}}. Thanks for making the time.

What did you think honestly? If something about it didn't work — the layout, the floor, the view, the numbers — tell me what it was. That's more useful to me than a polite yes, and it's how I find you the right one rather than the next one.

If you did like it, let me know and I'll put together the full costs so you can see the real number.`,
  },

  {
    key: 'quiet_lead',
    name: 'Checking in on a quiet lead',
    category: 'nurture',
    subject: 'Still looking in {{emirate}}?',
    previewText: 'One line back is all I need.',
    body: `Hi {{first_name}},

It's been a while since we spoke about {{project}}, so I thought I'd check in rather than keep guessing.

Are you still looking, or has this gone on the back burner for now? Either answer is fine — I just don't want to keep sending you things you're not interested in.

If you are still looking and something has changed about what you want, tell me and I'll start again from there.`,
  },
];

/** Looked up when seeding, and by anything that sends a named template. */
export function systemTemplate(key: string): SystemTemplate | undefined {
  return SYSTEM_TEMPLATES.find((template) => template.key === key);
}
