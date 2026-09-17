import { z } from 'zod';

/**
 * All configuration comes from the environment. Secrets are never logged and
 * never committed — `.env.example` documents the shape only.
 */
const boolish = z
  .union([z.boolean(), z.string()])
  .transform((v) => (typeof v === 'boolean' ? v : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase())));

const envSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().positive().default(3000),
  APP_URL: z.string().url().default('http://localhost:3000'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error']).default('info'),

  // --- Database -----------------------------------------------------------
  DATABASE_URL: z.string().optional(),
  DB_HOST: z.string().default('127.0.0.1'),
  DB_PORT: z.coerce.number().int().positive().default(3306),
  DB_USER: z.string().default('root'),
  DB_PASSWORD: z.string().default(''),
  DB_NAME: z.string().default('emir_crm'),
  DB_POOL_SIZE: z.coerce.number().int().positive().default(10),

  // --- Security -----------------------------------------------------------
  /** 32-byte key, hex or base64, used for AES-256-GCM encryption of tokens at rest. */
  ENCRYPTION_KEY: z.string().optional(),
  SESSION_COOKIE_NAME: z.string().default('emir_sid'),

  // Uploaded import files. Local disk, as the owner chose: Hostinger gives us
  // a persistent filesystem and an object store would be a second dependency
  // for files we delete within days.
  UPLOAD_DIR: z.string().default('./var/uploads'),
  /** Largest import file accepted, in megabytes. 100k rows is roughly 12 MB. */
  MAX_UPLOAD_MB: z.coerce.number().int().min(1).max(512).default(64),
  COOKIE_SECURE: boolish.default(false),
  TRUST_PROXY: boolish.default(true),

  // --- Meta (Lead Ads, WhatsApp Cloud API, Conversions API) ---------------
  META_APP_SECRET: z.string().optional(),
  META_VERIFY_TOKEN: z.string().optional(),
  META_PAGE_ACCESS_TOKEN: z.string().optional(),
  META_SYSTEM_USER_TOKEN: z.string().optional(),
  META_AD_ACCOUNT_ID: z.string().optional(),
  META_DATASET_ID: z.string().optional(),
  META_CAPI_ACCESS_TOKEN: z.string().optional(),
  META_CAPI_TEST_EVENT_CODE: z.string().optional(),

  // --- WhatsApp -----------------------------------------------------------
  WHATSAPP_PROVIDER: z.enum(['cloud', 'wati', 'twilio', 'log']).default('log'),
  /**
   * Lets production run with the `log` WhatsApp provider, which never reaches
   * the network. Off by default and refused unless set, because the failure it
   * prevents is silent and expensive: an agent seeing a welcome message in the
   * inbox and not calling a lead who was never actually contacted.
   *
   * With it on, those messages are recorded as not sent and say so, so the
   * CRM can be used for calls and imports before WhatsApp is connected.
   */
  ALLOW_FAKE_WHATSAPP: boolish.default(false),
  WHATSAPP_PHONE_NUMBER_ID: z.string().optional(),
  WHATSAPP_BUSINESS_ACCOUNT_ID: z.string().optional(),
  WHATSAPP_ACCESS_TOKEN: z.string().optional(),
  WATI_BASE_URL: z.string().optional(),
  WATI_ACCESS_TOKEN: z.string().optional(),
  TWILIO_ACCOUNT_SID: z.string().optional(),
  TWILIO_AUTH_TOKEN: z.string().optional(),
  TWILIO_WHATSAPP_FROM: z.string().optional(),

  // --- Google Ads ---------------------------------------------------------
  GOOGLE_LEAD_FORM_KEY: z.string().optional(),
  GOOGLE_ADS_DEVELOPER_TOKEN: z.string().optional(),
  GOOGLE_ADS_CUSTOMER_ID: z.string().optional(),
  GOOGLE_ADS_REFRESH_TOKEN: z.string().optional(),
  GOOGLE_ADS_CLIENT_ID: z.string().optional(),
  GOOGLE_ADS_CLIENT_SECRET: z.string().optional(),
  GOOGLE_ADS_CONVERSION_ACTION: z.string().optional(),

  // --- Website form -------------------------------------------------------
  WEBSITE_FORM_HMAC_SECRET: z.string().optional(),
  RECAPTCHA_SECRET: z.string().optional(),

  // --- Email --------------------------------------------------------------
  SMTP_HOST: z.string().optional(),
  SMTP_PORT: z.coerce.number().int().positive().default(587),
  SMTP_SECURE: boolish.default(false),
  SMTP_USER: z.string().optional(),
  SMTP_PASSWORD: z.string().optional(),
  MAIL_FROM: z.string().optional(),
  MAIL_REPLY_DOMAIN: z.string().optional(),
  IMAP_HOST: z.string().optional(),
  IMAP_PORT: z.coerce.number().int().positive().default(993),
  IMAP_SECURE: boolish.default(true),
  IMAP_USER: z.string().optional(),
  IMAP_PASSWORD: z.string().optional(),

  // --- Push (FCM) ---------------------------------------------------------
  FCM_PROJECT_ID: z.string().optional(),
  FCM_CLIENT_EMAIL: z.string().optional(),
  FCM_PRIVATE_KEY: z.string().optional(),

  // --- AI -----------------------------------------------------------------
  AI_PROVIDER: z.enum(['gemini', 'openai', 'none']).default('none'),
  AI_MODEL: z.string().optional(),
  GEMINI_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),

  // --- Workers ------------------------------------------------------------
  WORKER_ENABLED: boolish.default(true),
  WORKER_POLL_MS: z.coerce.number().int().positive().default(2000),
  WORKER_BATCH_SIZE: z.coerce.number().int().positive().default(10),
  WORKER_ID: z.string().optional(),
})
  .superRefine((value, ctx) => {
    // A production server that silently swallows every WhatsApp message is the
    // worst of both worlds: it looks like it is working. Refuse to start.
    // A session cookie without Secure is sent over plain http. On a live CRM
    // that is one café network away from someone else's leads and WhatsApp
    // threads, so it is a refusal rather than a warning.
    if (value.NODE_ENV === 'production' && !value.COOKIE_SECURE) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['COOKIE_SECURE'],
        message:
          'must be true in production: without it the session cookie is sent over plain http, ' +
          'and anyone on the same network can read it. Serve the CRM over HTTPS and set ' +
          'COOKIE_SECURE=true.',
      });
    }

    if (value.NODE_ENV === 'production' && value.WHATSAPP_PROVIDER === 'log' && !value.ALLOW_FAKE_WHATSAPP) {
      ctx.addIssue({
        code: z.ZodIssueCode.custom,
        path: ['WHATSAPP_PROVIDER'],
        message:
          'is "log", which never sends anything. Set a real provider (cloud, wati, twilio), ' +
          'or set ALLOW_FAKE_WHATSAPP=1 to run without WhatsApp — messages will then be ' +
          'recorded as not sent, and the inbox will say so.',
      });
    }
  });

export type Env = z.infer<typeof envSchema>;

let cached: Env | null = null;

export function loadEnv(source: NodeJS.ProcessEnv = process.env): Env {
  const parsed = envSchema.safeParse(source);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `  - ${i.path.join('.')}: ${i.message}`).join('\n');
    throw new Error(`Invalid environment configuration:\n${issues}`);
  }
  return parsed.data;
}

export function env(): Env {
  if (!cached) cached = loadEnv();
  return cached;
}

/** Test helper — lets a suite swap the config without touching process.env. */
export function setEnvForTesting(next: Env | null): void {
  cached = next;
}

export function isProduction(): boolean {
  return env().NODE_ENV === 'production';
}
