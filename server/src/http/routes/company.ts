import { mkdir, readdir, readFile, unlink, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Router, type Request, type Response } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../middleware/error.js';
import {
  actorFrom, blockUntilPasswordChanged, requireAdmin, requireAuth, requireManager,
} from '../middleware/auth.js';
import { rateLimit } from '../middleware/rate-limit.js';
import { saveSetting } from '../../config/secrets.js';
import {
  COMPANY_FIELDS, COMPANY_SETTING, MAX_LENGTH, RENAME_WARNING, companyDetails, companyIssues,
  type CompanyField,
} from '../../config/company.js';
import {
  MAX_BOT_PAUSE_HOURS, MAX_PER_24H_CEILING, MESSAGING_DEFAULTS, MIN_BOT_PAUSE_HOURS,
  describeQuiet, isCustomised, messagingRules,
} from '../../config/messaging-rules.js';
import { baseContentType, extensionFor, insideUploadDir, uploadDir, IMAGE_TYPES } from '../../lib/uploads.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { writeAudit } from '../../audit/audit.js';

/**
 * The company, and the limits on automated messaging.
 *
 * Everybody on the team may read it — an agent's email signature and the offer
 * they send both carry it, so "what is our TRN" is a reasonable question for
 * anyone to ask the CRM. Only an owner or an admin may change it, and every
 * change is written to `audit_log` with the old value beside the new one,
 * because "who changed the company's name on the invoices" is exactly the
 * question an audit log exists to answer.
 */
export const companyRouter = Router();

/* The logo is public by design: it is in the footer of every client email and
   at the top of every offer page, both of which are opened by people who have
   no account here. Registered before the auth middleware for that reason. */
companyRouter.get(
  '/logo',
  asyncHandler(async (_req: Request, res: Response) => {
    const file = await findLogo();
    if (!file) throw notFound('No logo has been uploaded.');

    const type = Object.entries(IMAGE_TYPES).find(([, ext]) => ext === path.extname(file))?.[0];
    res.setHeader('Content-Type', type ?? 'application/octet-stream');
    /* The URL carries a version, so this can be cached hard. */
    res.setHeader('Cache-Control', 'public, max-age=31536000, immutable');
    res.setHeader('Content-Disposition', 'inline');
    res.send(await readFile(file));
  }),
);

companyRouter.use(requireAuth, blockUntilPasswordChanged);

companyRouter.get(
  '/',
  asyncHandler(async (_req: Request, res: Response) => {
    const company = await companyDetails();
    const rules = await messagingRules();
    res.json({
      company,
      issues: companyIssues(company),
      renameWarning: RENAME_WARNING,
      messaging: {
        ...rules,
        botPauseHours: Math.round(rules.botPauseMs / 3_600_000),
        describes: describeQuiet(rules),
        customised: isCustomised(rules),
        defaults: {
          ...MESSAGING_DEFAULTS,
          botPauseHours: Math.round(MESSAGING_DEFAULTS.botPauseMs / 3_600_000),
        },
        limits: {
          maxPer24hCeiling: MAX_PER_24H_CEILING,
          botPauseHours: [MIN_BOT_PAUSE_HOURS, MAX_BOT_PAUSE_HOURS],
        },
      },
    });
  }),
);

/* Reading is everybody's business; the shape of what may be written is not. */
const companySchema = z.object(
  Object.fromEntries(
    COMPANY_FIELDS.map((field) => [field, z.string().max(MAX_LENGTH[field] ?? 255).optional()]),
  ) as Record<CompanyField, z.ZodOptional<z.ZodString>>,
).partial();

companyRouter.put(
  '/',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = companySchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('That is not something the company record holds.', parsed.error.issues);

    const before = await companyDetails();
    const actor = actorFrom(req);
    const changed: string[] = [];

    for (const field of COMPANY_FIELDS) {
      const value = parsed.data[field];
      if (value === undefined) continue;
      const trimmed = value.trim();
      if (trimmed === before[field]) continue;
      /* An emptied field falls back to its default rather than storing "". */
      await saveSetting(actor, COMPANY_SETTING[field] as never, trimmed || null);
      changed.push(field);
    }

    const after = await companyDetails();

    /*
     * One audit row for the change as a whole, on top of the per-setting rows
     * `saveSetting` writes. The per-setting rows answer "when did the TRN
     * change"; this one answers "who edited the company record, and what did
     * it look like before and after", which is the question somebody actually
     * asks.
     */
    if (changed.length > 0) {
      await writeAudit({
        actor,
        action: 'company.updated',
        entityType: 'setting',
        entityId: 'company',
        before: Object.fromEntries(changed.map((field) => [field, before[field as CompanyField]])),
        after: Object.fromEntries(changed.map((field) => [field, after[field as CompanyField]])),
      });
    }

    res.json({
      company: after,
      issues: companyIssues(after),
      changed,
      /* Said again on the way out, so a rename through the API is told too. */
      ...(changed.includes('legalName') || changed.includes('tradingName')
        ? { renameWarning: RENAME_WARNING }
        : {}),
    });
  }),
);

const messagingSchema = z.object({
  quietStartHour: z.coerce.number().int().min(0).max(23).optional(),
  quietEndHour: z.coerce.number().int().min(0).max(23).optional(),
  maxPer24h: z.coerce.number().int().min(1).max(MAX_PER_24H_CEILING).optional(),
  botPauseHours: z.coerce.number().int().min(MIN_BOT_PAUSE_HOURS).max(MAX_BOT_PAUSE_HOURS).optional(),
});

companyRouter.put(
  '/messaging',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    const parsed = messagingSchema.safeParse(req.body);
    if (!parsed.success) throw badRequest('That is not one of the messaging limits.', parsed.error.issues);

    const before = await messagingRules();
    const actor = actorFrom(req);

    if (parsed.data.quietStartHour !== undefined) {
      await saveSetting(actor, 'MSG_QUIET_START', String(parsed.data.quietStartHour));
    }
    if (parsed.data.quietEndHour !== undefined) {
      await saveSetting(actor, 'MSG_QUIET_END', String(parsed.data.quietEndHour));
    }
    if (parsed.data.maxPer24h !== undefined) {
      await saveSetting(actor, 'MSG_MAX_PER_24H', String(parsed.data.maxPer24h));
    }
    if (parsed.data.botPauseHours !== undefined) {
      await saveSetting(actor, 'MSG_BOT_PAUSE_HOURS', String(parsed.data.botPauseHours));
    }

    /* Read back rather than echoed: the clamps in `rulesFrom` may have moved
       what was asked for, and the screen must show what is actually enforced. */
    const after = await messagingRules();
    await writeAudit({
      actor,
      action: 'company.messaging_limits_changed',
      entityType: 'setting',
      entityId: 'messaging',
      before,
      after,
    });

    res.json({
      ...after,
      botPauseHours: Math.round(after.botPauseMs / 3_600_000),
      describes: describeQuiet(after),
      customised: isCustomised(after),
    });
  }),
);

const logoLimit = rateLimit({
  windowMs: 60_000,
  max: 10,
  message: 'Too many logo uploads in a short time. Please wait a minute.',
});

/** Two megabytes. A logo larger than that is a photograph by mistake. */
const MAX_LOGO_BYTES = 2 * 1024 * 1024;

companyRouter.post(
  '/logo',
  requireAdmin,
  logoLimit,
  asyncHandler(async (req: Request, res: Response) => {
    const contentType = baseContentType(req.get('content-type') ?? '');
    const extension = extensionFor(contentType, IMAGE_TYPES);
    if (!extension || extension === '.pdf') {
      throw badRequest(`${contentType || 'That file'} is not an image. PNG, JPG or WebP.`);
    }

    const chunks: Buffer[] = [];
    let size = 0;
    for await (const chunk of req) {
      size += (chunk as Buffer).length;
      if (size > MAX_LOGO_BYTES) throw badRequest('That logo is larger than 2 MB.');
      chunks.push(chunk as Buffer);
    }
    if (size === 0) throw badRequest('That file is empty.');

    const dir = brandingDir();
    await mkdir(dir, { recursive: true });
    /* One logo, so the old one in another format goes rather than lingering
       as a file nothing points at. */
    await removeLogos();
    await writeFile(path.join(dir, `logo${extension}`), Buffer.concat(chunks));

    /* The version makes the URL change, which is what makes a browser and a
       mail client fetch the new one instead of the cached old one. */
    const url = `/api/company/logo?v=${Date.now()}`;
    const actor = actorFrom(req);
    await saveSetting(actor, 'COMPANY_LOGO_URL', url);
    await writeAudit({
      actor,
      action: 'company.logo_changed',
      entityType: 'setting',
      entityId: 'company',
      after: { bytes: size, contentType },
    });

    res.status(201).json({ logoUrl: url });
  }),
);

companyRouter.delete(
  '/logo',
  requireAdmin,
  asyncHandler(async (req: Request, res: Response) => {
    await removeLogos();
    const actor = actorFrom(req);
    await saveSetting(actor, 'COMPANY_LOGO_URL', null);
    await writeAudit({ actor, action: 'company.logo_removed', entityType: 'setting', entityId: 'company' });
    res.json({ ok: true });
  }),
);

/* Manager+ may see the issue list on the health screen without opening Settings. */
companyRouter.get(
  '/issues',
  requireManager,
  asyncHandler(async (_req: Request, res: Response) => {
    res.json({ issues: companyIssues(await companyDetails()) });
  }),
);

function brandingDir(): string {
  return uploadDir('branding');
}

/** The one logo on disk, whatever extension it has. */
async function findLogo(): Promise<string | null> {
  const dir = brandingDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return null;
  }
  const match = names.find((name) => /^logo\.(png|jpg|webp|gif)$/.test(name));
  if (!match) return null;
  const file = path.join(dir, match);
  /* The names are matched against a pattern above, so this cannot escape —
     checked anyway, because the next person to edit that pattern is not
     reading this comment. */
  return insideUploadDir(file) ? file : null;
}

async function removeLogos(): Promise<void> {
  const dir = brandingDir();
  let names: string[];
  try {
    names = await readdir(dir);
  } catch {
    return;
  }
  for (const name of names) {
    if (!/^logo\.(png|jpg|webp|gif)$/.test(name)) continue;
    const file = path.join(dir, name);
    if (insideUploadDir(file)) await unlink(file).catch(() => undefined);
  }
}
