/**
 * What is still not switched on.
 *
 * Every one of these fails silently and separately. Email answers "SMTP is not
 * configured" inside a conversation nobody is reading; WhatsApp follow-ups
 * never send because no template was ever approved, so Workflows B and C show
 * zero runs and look idle rather than blocked; push has no devices registered,
 * so the five-minute rule only works while somebody has the CRM open; and Emir
 * AI answers every question with a key error.
 *
 * Each of those looked like a separate mystery. Together they are one list,
 * and this is it — counted from the same places the features themselves read,
 * so it cannot drift out of step with what actually happens at send time.
 *
 * Owner and admin only: an agent cannot act on any of it, and a checklist of
 * things they cannot fix is just noise on their morning.
 */
import { getPool, queryOne, type Executor } from '../db/client.js';
import { secret } from '../config/secrets.js';
import { env } from '../config/env.js';

export interface SetupItem {
  key: 'email' | 'whatsapp' | 'push' | 'ai';
  /** What it is, in the owner's words. */
  title: string;
  /** What does not work while it is off. */
  consequence: string;
  ready: boolean;
  /** Where to go and do something about it. */
  to: string;
}

export interface SetupChecklist {
  items: SetupItem[];
  /** How many are still off. Zero means nothing to show. */
  outstanding: number;
}

export async function setupChecklist(exec: Executor = getPool()): Promise<SetupChecklist> {
  const config = env();

  /* Email: a host is the one part with no default worth sending without. */
  /* Only ever set in the hosting panel — unlike the AI key, there is no
     encrypted-store path for it. */
  const smtpHost = config.SMTP_HOST;

  /*
   * WhatsApp: credentials are not enough. Outside the 24-hour window Meta
   * accepts nothing but an approved template, so a connected number with
   * sixteen drafts sends exactly as much as no number at all.
   */
  const approved = await queryOne<{ n: number }>(
    "SELECT COUNT(*) AS n FROM wa_templates WHERE status = 'APPROVED'",
    [],
    exec,
  );
  const waConnected = Boolean(config.WHATSAPP_ACCESS_TOKEN);

  /* Push: the service account, and at least one device that asked for it. */
  const fcm = Boolean(config.FCM_PROJECT_ID && config.FCM_CLIENT_EMAIL);
  const devices = await queryOne<{ n: number }>(
    'SELECT COUNT(*) AS n FROM push_tokens',
    [],
    exec,
  ).catch(() => ({ n: 0 }));

  const geminiKey = Boolean(await secret('GEMINI_API_KEY', exec));

  const items: SetupItem[] = [
    {
      key: 'email',
      title: 'Email sending',
      consequence: 'Follow-up emails are recorded as not sent. Nothing reaches the client.',
      ready: Boolean(smtpHost),
      to: '/settings?tab=health',
    },
    {
      key: 'whatsapp',
      title: 'WhatsApp templates',
      consequence: Number(approved?.n ?? 0) === 0 && waConnected
        ? 'The number is connected but no template is approved, so nothing can be sent once the 24-hour window closes.'
        : 'Automated WhatsApp follow-ups cannot be sent at all.',
      ready: waConnected && Number(approved?.n ?? 0) > 0,
      to: '/settings?tab=templates',
    },
    {
      key: 'push',
      title: 'Phone alerts',
      consequence: 'A new lead only shows while the CRM is open, so the five-minute rule depends on luck.',
      ready: fcm && Number(devices?.n ?? 0) > 0,
      to: '/settings?tab=health',
    },
    {
      key: 'ai',
      title: 'Emir AI',
      consequence: 'Every question comes back as an error, for everyone.',
      ready: geminiKey,
      to: '/settings?tab=ai',
    },
  ];

  return { items, outstanding: items.filter((item) => !item.ready).length };
}
