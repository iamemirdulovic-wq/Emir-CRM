import { closePool, execute, query, queryOne } from './client.js';
import { newId } from '../lib/ids.js';
import { logger, errorContext } from '../lib/logger.js';
import { hashPassword } from '../auth/password.js';
import { normalizeLead } from '../ingestion/normalize.js';
import { ingestLead } from '../ingestion/ingest.js';
import { handleInboundMessage } from '../ingestion/whatsapp-inbound.js';
import { parseWhatsAppWebhook } from '../ingestion/sources/whatsapp.js';
import { runWorkflowA } from '../workflows/workflow-a.js';
import { runWorkflowC } from '../workflows/workflow-c.js';
import { moveStage } from '../services/opportunities.js';
import { SYSTEM_ACTOR } from '../audit/audit.js';
import { seed } from './seed.js';

/**
 * Demo data for a development or demonstration environment.
 *
 * It drives the real pipeline — ingestion, assignment, workflows — rather than
 * inserting rows directly, so what you see is what the system actually does.
 *
 * Refuses to run against NODE_ENV=production.
 */

const AGENTS = [
  { name: 'Layla Hassan', email: 'layla@emircrm.local', languages: ['en', 'ar'], projects: ['Emaar Beachfront'], weight: 15 },
  { name: 'Omar Farouk', email: 'omar@emircrm.local', languages: ['ar'], projects: ['Damac Lagoons'], weight: 10 },
  { name: 'Priya Nair', email: 'priya@emircrm.local', languages: ['en'], projects: [], weight: 10 },
];

const PROJECTS = [
  {
    slug: 'emaar-beachfront',
    name: 'Emaar Beachfront',
    developer: 'Emaar',
    emirate: 'dubai',
    area: 'Dubai Harbour',
    startingPrice: 1_850_000,
    paymentPlan: '80/20 until handover',
    handover: 'Q4 2027',
    goldenVisa: 1,
    lat: 25.094,
    lng: 55.144,
    label: 'Dubai Harbour, Dubai',
  },
  {
    slug: 'damac-lagoons',
    name: 'Damac Lagoons',
    developer: 'Damac',
    emirate: 'dubai',
    area: 'Dubailand',
    startingPrice: 1_450_000,
    paymentPlan: '75/25 with 1% monthly',
    handover: 'Q2 2028',
    goldenVisa: 1,
    lat: 25.023,
    lng: 55.26,
    label: 'Dubailand, Dubai',
  },
  {
    slug: 'al-reem-shams',
    name: 'Shams Abu Dhabi',
    developer: 'Aldar',
    emirate: 'abu_dhabi',
    area: 'Al Reem Island',
    startingPrice: 1_200_000,
    paymentPlan: '60/40 on handover',
    handover: 'Q1 2027',
    goldenVisa: 0,
    lat: 24.4966,
    lng: 54.4088,
    label: 'Al Reem Island, Abu Dhabi',
  },
];

const LEADS = [
  { name: 'Sara Al Mansoori', phone: '+971501234567', email: 'sara@example.com', project: 'Emaar Beachfront', budget: 'AED 1M - 2M', timeline: '1-3 months', purpose: 'Investment', lang: 'en', source: 'meta_lead_ads' as const },
  { name: 'Omar Haddad', phone: '+971559876543', email: 'omar.h@example.com', project: 'Damac Lagoons', budget: '2M - 3M', timeline: 'Immediately', purpose: 'End use', lang: 'ar', source: 'meta_ctwa' as const },
  { name: 'Fatima Noor', phone: '+971551112233', email: 'fatima@example.com', project: 'Shams Abu Dhabi', budget: 'Up to 3M', timeline: '3-6 months', purpose: 'Investment', lang: 'en', source: 'google_ads' as const },
  { name: 'Ahmed Khalil', phone: '+971509876543', email: 'ahmed@example.com', project: 'Emaar Beachfront', budget: '3.5M', timeline: '6-12 months', purpose: 'End use', lang: 'en', source: 'website' as const },
  { name: 'Rania Aziz', phone: '+971502223344', email: 'rania@example.com', project: 'Damac Lagoons', budget: '800k - 1.2m', timeline: 'Just looking', purpose: 'Investment', lang: 'ar', source: 'website' as const },
  { name: 'David Chen', phone: '+971544455566', email: 'david@example.com', project: 'Emaar Beachfront', budget: '5M+', timeline: 'Immediately', purpose: 'Investment', lang: 'en', source: 'meta_lead_ads' as const },
];

async function ensureAgents(): Promise<void> {
  for (const agent of AGENTS) {
    const existing = await queryOne<{ id: string }>('SELECT id FROM users WHERE email = ?', [agent.email]);
    if (existing) continue;
    const { hash, algo } = await hashPassword('DemoAgent2026!');
    await execute(
      `INSERT INTO users (id, name, email, role, password_hash, password_algo, must_change_password, is_active,
                          languages, projects_covered, routing_weight)
       VALUES (?, ?, ?, 'agent', ?, ?, 0, 1, ?, ?, ?)`,
      [newId(), agent.name, agent.email, hash, algo, JSON.stringify(agent.languages), JSON.stringify(agent.projects), agent.weight],
    );
  }
  logger.info('demo agents ready', { count: AGENTS.length, password: 'DemoAgent2026!' });
}

async function ensureProjects(): Promise<void> {
  for (const project of PROJECTS) {
    await execute(
      `INSERT INTO projects (id, slug, name, developer, emirate, area, starting_price_aed, payment_plan,
                             handover_date, golden_visa_eligible, brochure_url, location_lat, location_lng,
                             location_label, is_active, verified_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 1, NOW(3))
       ON DUPLICATE KEY UPDATE verified_at = NOW(3)`,
      [
        newId(),
        project.slug,
        project.name,
        project.developer,
        project.emirate,
        project.area,
        project.startingPrice,
        project.paymentPlan,
        project.handover,
        project.goldenVisa,
        `https://cdn.example.ae/${project.slug}.pdf`,
        project.lat,
        project.lng,
        project.label,
      ],
    );
  }
  logger.info('demo projects verified', { count: PROJECTS.length });
}

/** Approve the templates so the welcome actually sends in a demo. */
async function approveTemplates(): Promise<void> {
  await execute(`UPDATE wa_templates SET status = 'APPROVED'`);
}

async function createLeads(): Promise<Array<{ contactId: string; opportunityId: string; conversationId: string; lang: string }>> {
  const created = [];
  for (const lead of LEADS) {
    const dto = normalizeLead({
      source: lead.source,
      externalId: `demo-${lead.phone}`,
      mapped: {
        full_name: lead.name,
        phone: lead.phone,
        email: lead.email,
        project: lead.project,
        budget_band: lead.budget,
        timeline: lead.timeline,
        purpose: lead.purpose,
        language: lead.lang,
      },
      consent: { whatsapp: true, email: true, sms: false, text: 'Demo consent: agreed to be contacted about property offers.' },
    });
    const result = await ingestLead(dto);
    await runWorkflowA({ opportunityId: result.opportunityId, contactId: result.contactId });
    created.push({ ...result, lang: lead.lang });
  }
  logger.info('demo leads ingested', { count: created.length });
  return created;
}

/** Give a few leads a conversation and move them along the pipeline. */
async function simulateConversations(
  leads: Array<{ contactId: string; opportunityId: string; conversationId: string }>,
): Promise<void> {
  const replies = [
    { index: 0, text: 'What is the price for a 2 bedroom?' },
    { index: 1, text: 'كم السعر؟' },
    { index: 3, text: 'Please send the brochure' },
    { index: 5, text: 'Call me please' },
  ];

  for (const reply of replies) {
    const lead = leads[reply.index];
    if (!lead) continue;
    const contact = await queryOne<{ wa_id: string | null; full_name: string | null }>(
      'SELECT wa_id, full_name FROM contacts WHERE id = ?',
      [lead.contactId],
    );
    if (!contact?.wa_id) continue;

    const parsed = parseWhatsAppWebhook({
      object: 'whatsapp_business_account',
      entry: [
        {
          id: 'demo',
          changes: [
            {
              field: 'messages',
              value: {
                messaging_product: 'whatsapp',
                metadata: { phone_number_id: 'demo' },
                contacts: [{ profile: { name: contact.full_name ?? 'Lead' }, wa_id: contact.wa_id }],
                messages: [
                  {
                    from: contact.wa_id,
                    id: `wamid.demo.${newId()}`,
                    timestamp: String(Math.floor(Date.now() / 1000)),
                    type: 'text',
                    text: { body: reply.text },
                  },
                ],
              },
            },
          ],
        },
      ],
    });

    const stored = await handleInboundMessage(parsed.messages[0]!);
    await runWorkflowC({
      contactId: stored.contactId,
      conversationId: stored.conversationId,
      messageId: stored.messageId,
      opportunityId: lead.opportunityId,
      text: reply.text,
      buttonPayload: null,
    });
  }

  // Push two leads further down the funnel so the board is not all one column.
  const deeper = [
    { index: 1, to: 'appointment_scheduled' as const, subStatus: 'booked' },
    { index: 5, to: 'deal_sent' as const, subStatus: 'eoi_sent' },
  ];
  for (const step of deeper) {
    const lead = leads[step.index];
    if (!lead) continue;
    await moveStage({
      opportunityId: lead.opportunityId,
      to: step.to,
      subStatus: step.subStatus,
      actor: { ...SYSTEM_ACTOR, role: 'automation' },
      actingUserId: null,
    }).catch((err) => logger.warn('demo stage move failed', errorContext(err)));
  }

  // And close one as lost, so the Lost column and the funnel report have data.
  const lost = leads[4];
  if (lost) {
    await moveStage({
      opportunityId: lost.opportunityId,
      to: 'lost',
      lostReason: 'budget_mismatch',
      lostNote: 'Budget is below the current inventory.',
      actor: { ...SYSTEM_ACTOR, role: 'automation' },
      actingUserId: null,
    }).catch(() => undefined);
  }
}

export async function loadDemoData(): Promise<void> {
  if (process.env.NODE_ENV === 'production') {
    throw new Error('Refusing to load demo data into a production environment');
  }
  await seed();
  await ensureAgents();
  await ensureProjects();
  await approveTemplates();
  const leads = await createLeads();
  await simulateConversations(leads);

  const counts = await query<{ contacts: number; opportunities: number; messages: number }>(
    `SELECT (SELECT COUNT(*) FROM contacts) AS contacts,
            (SELECT COUNT(*) FROM opportunities) AS opportunities,
            (SELECT COUNT(*) FROM messages) AS messages`,
  );
  logger.info('demo data loaded', counts[0] ?? {});
  process.stdout.write('\n  Demo agents can sign in with the password: DemoAgent2026!\n\n');
}

const invokedDirectly = process.argv[1] && process.argv[1].endsWith('demo.ts');
if (invokedDirectly) {
  loadDemoData()
    .then(async () => {
      await closePool();
      process.exit(0);
    })
    .catch(async (err) => {
      logger.error('demo data failed', errorContext(err));
      await closePool().catch(() => undefined);
      process.exit(1);
    });
}
