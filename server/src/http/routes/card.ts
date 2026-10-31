import { Router, type Request, type Response } from 'express';
import { asyncHandler } from '../middleware/error.js';
import { env } from '../../config/env.js';
import { queryOne } from '../../db/client.js';
import { buildVCard, vcardFilename } from '../../profiles/vcard.js';
import { qrSvg } from '../../profiles/qr.js';
import { loadPublicProfile } from '../../profiles/profiles.js';
import { notFoundPage, publicPhone, renderCardHtml } from '../../profiles/card-html.js';
import { companyDetails, displayName } from '../../config/company.js';

/**
 * The business card a client opens.
 *
 * No login, no bundle, no session — the page is HTML from the server, so it
 * works with JavaScript off and arrives fast on one bar of signal at a sales
 * centre.
 *
 * Only a profile somebody has deliberately switched on is served. Everything
 * else is the same 404, deliberately indistinguishable from a card that does
 * not exist: a different message would let anybody test which agents work
 * here by guessing names.
 */
export const cardRouter = Router();

cardRouter.get(
  '/card/:slug',
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await loadPublicProfile(String(req.params.slug));
    if (!profile) return void res.status(404).type('html').send(notFoundPage());

    const base = env().APP_URL.replace(/\/+$/, '');
    res.type('html').send(renderCardHtml(profile, await companyName(), `${base}/card/${profile.slug}`));
  }),
);

/** The vCard itself. One tap on a phone saves the number. */
cardRouter.get(
  '/card/:slug/vcf',
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await loadPublicProfile(String(req.params.slug));
    if (!profile) return void res.status(404).type('text').send('Not found');

    const card = buildVCard({
      fullName: profile.name,
      jobTitle: profile.job_title,
      company: await companyName(),
      phone: publicPhone(profile),
      whatsapp: profile.whatsapp,
      email: profile.public_email || profile.email,
      website: `${env().APP_URL.replace(/\/+$/, '')}/card/${profile.slug}`,
      note: profile.headline,
      photoUrl: profile.photo_url,
    });

    res.setHeader('Content-Type', 'text/vcard; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${vcardFilename(profile.name)}"`);
    res.send(card);
  }),
);

/** The QR on its own, for printing on something. */
cardRouter.get(
  '/card/:slug/qr.svg',
  asyncHandler(async (req: Request, res: Response) => {
    const profile = await loadPublicProfile(String(req.params.slug));
    if (!profile) return void res.status(404).type('text').send('Not found');

    const url = `${env().APP_URL.replace(/\/+$/, '')}/card/${profile.slug}`;
    res.setHeader('Content-Type', 'image/svg+xml; charset=utf-8');
    res.setHeader('Cache-Control', 'public, max-age=3600');
    res.send(qrSvg(url, { size: 600 }));
  }),
);

/**
 * The name on the agent's card, from Settings → Company.
 *
 * This used to read an `app_settings` row called `company` and take `.name`
 * from its JSON. Nothing writes that row — the Company screen stores one
 * setting per field — so the card always fell through to the hard-coded name
 * and silently ignored whatever the owner had typed. Reading the record the
 * screen actually writes is the whole fix.
 */
async function companyName(): Promise<string> {
  return displayName(await companyDetails());
}
