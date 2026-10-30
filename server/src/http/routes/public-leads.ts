import { Router, type Request, type Response } from 'express';
import { createHash, timingSafeEqual } from 'node:crypto';
import { asyncHandler } from '../middleware/error.js';
import { clientIp } from '../middleware/auth.js';
import { env } from '../../config/env.js';
import { logger, errorContext } from '../../lib/logger.js';
import {
  markEventFailed, markEventIgnored, markEventProcessed, markEventProcessing, recordInboundEvent,
} from '../../ingestion/events.js';
import { ingestLead } from '../../ingestion/ingest.js';
import { processAfterResponse } from '../../lib/after-response.js';
import {
  isSpam, normalizeWebsiteLead, websiteExternalId, websiteFormSchema,
} from '../../ingestion/sources/website.js';

/**
 * The form on homes.me, posting straight from the visitor's browser.
 *
 * This is deliberately a second door, beside the HMAC one in `webhooks.ts`
 * rather than instead of it. That endpoint signs the whole body with a shared
 * secret, which is the right protection for a server talking to a server — and
 * exactly the protection a browser cannot have, because anything the page
 * knows, everybody knows.
 *
 * So the browser gets a key that is meant to be visible, and the protections
 * that actually work against a public endpoint: it is rate limited per address,
 * it carries a honeypot that a person never fills in and a bot always does, and
 * the key can be changed in Settings the day it starts being abused. The worst
 * a leaked key buys is the ability to post junk leads at the same rate anyone
 * else could, which the junk score then marks as junk.
 */
export const publicLeadsRouter = Router();

/** Constant-time compare, so the key cannot be guessed a character at a time. */
function keyMatches(given: string | undefined, expected: string): boolean {
  if (!given) return false;
  const a = createHash('sha256').update(given).digest();
  const b = createHash('sha256').update(expected).digest();
  return timingSafeEqual(a, b);
}

publicLeadsRouter.post(
  '/leads',
  asyncHandler(async (req: Request, res: Response) => {
    const cfg = env();
    const siteKey = cfg.PUBLIC_SITE_KEY;

    if (!siteKey) {
      /* Not configured is not the same as rejected: saying so plainly is what
         lets whoever is wiring up the website know what to do next. */
      res.status(503).json({ error: { code: 'not_configured', message: 'Website intake is not switched on yet.' } });
      return;
    }

    if (!keyMatches(req.get('x-site-key') ?? undefined, siteKey)) {
      logger.warn('rejected a website lead with a bad site key', { ip: clientIp(req) });
      res.status(401).json({ error: { code: 'unauthorized', message: 'This form is not registered.' } });
      return;
    }

    const payload = websiteFormSchema.parse(req.body);
    const ip = clientIp(req);

    const event = await recordInboundEvent({
      source: 'website',
      externalId: websiteExternalId(payload),
      payload: req.body,
      signatureValid: true,
    });

    /*
     * The honeypot: a field hidden from people and left empty by them, which a
     * bot filling the form by its field names fills too. Answered 200 so the
     * bot believes it worked and does not come back to try something cleverer.
     */
    if (isSpam(payload)) {
      await markEventIgnored(event.id, 'honeypot field was filled');
      logger.info('dropped a website lead that filled the honeypot', { ip });
      res.status(200).json({ ok: true });
      return;
    }

    /* Answer the visitor before doing the work. They are waiting on this
       request; the thirty-second reply does not need them to be. */
    res.status(200).json({ ok: true });

    processAfterResponse(res, async () => {
      /* A replayed submission must never make a second lead. */
      if (event.duplicate) return;
      try {
        await markEventProcessing(event.id);
        const lead = await normalizeWebsiteLead(payload, ip, req.get('user-agent') ?? null);
        const result = await ingestLead(lead, { inboundEventId: event.id });
        await markEventProcessed(event.id, { contactId: result.contactId, opportunityId: result.opportunityId });
      } catch (err) {
        logger.error('a website lead could not be processed', errorContext(err));
        await markEventFailed(event.id, err);
      }
    });
  }),
);

/**
 * The form itself, as a script the website drops in.
 *
 * Served from here rather than handed over as a file so that the key, the
 * address and the wording stay in one place: if the key is ever changed, every
 * page carrying this picks up the new one on its next load.
 */
publicLeadsRouter.get(
  '/lead-form.js',
  asyncHandler(async (_req: Request, res: Response) => {
    const cfg = env();
    const base = cfg.APP_URL.replace(/\/+$/, '');
    const key = cfg.PUBLIC_SITE_KEY ?? '';

    res.setHeader('Content-Type', 'application/javascript; charset=utf-8');
    /* Five minutes: long enough that it is not fetched on every page view,
       short enough that changing the key takes effect the same morning. */
    res.setHeader('Cache-Control', 'public, max-age=300');
    res.send(formScript(base, key));
  }),
);

function formScript(base: string, key: string): string {
  return `/* Emigeo Homes lead form. Drop this on a page:
     <div id="emigeo-lead-form"></div>
     <script src="${base}/embed/lead-form.js" async></script> */
(function () {
  var mount = document.getElementById('emigeo-lead-form');
  if (!mount || mount.dataset.ready) return;
  mount.dataset.ready = '1';

  mount.innerHTML = [
    '<form class="emigeo-form" novalidate>',
    '  <label>Your name<input name="full_name" autocomplete="name" required></label>',
    '  <label>Mobile<input name="phone" type="tel" autocomplete="tel" placeholder="+971 50 123 4567" required></label>',
    '  <label>Email<input name="email" type="email" autocomplete="email"></label>',
    '  <label>Which project?<input name="project" autocomplete="off"></label>',
    '  <label>Anything else?<textarea name="message" rows="3"></textarea></label>',
    // Hidden from people, irresistible to a bot filling fields by name.
    '  <div class="emigeo-trap" aria-hidden="true"><label>Company website<input name="company_website" tabindex="-1" autocomplete="off"></label></div>',
    '  <label class="emigeo-consent"><input type="checkbox" name="consent" checked> Yes, Emigeo Homes may contact me about this enquiry on WhatsApp or email.</label>',
    '  <button type="submit">Request a call</button>',
    '  <p class="emigeo-note" role="status"></p>',
    '</form>',
  ].join('');

  var style = document.createElement('style');
  style.textContent = [
    '.emigeo-form{display:flex;flex-direction:column;gap:12px;max-width:440px;font:15px/1.5 system-ui,-apple-system,Segoe UI,sans-serif}',
    '.emigeo-form label{display:flex;flex-direction:column;gap:5px;font-weight:600;color:#0E1B2C}',
    '.emigeo-form input,.emigeo-form textarea{font:inherit;font-weight:400;padding:11px 13px;border:1px solid rgba(20,40,70,.18);border-radius:12px;background:#fff}',
    '.emigeo-form input:focus,.emigeo-form textarea:focus{outline:2px solid #00AFC8;outline-offset:1px;border-color:transparent}',
    '.emigeo-form button{font:inherit;font-weight:700;padding:13px;border:0;border-radius:12px;background:#00AFC8;color:#fff;cursor:pointer}',
    '.emigeo-form button:disabled{opacity:.6;cursor:progress}',
    '.emigeo-consent{flex-direction:row!important;align-items:flex-start;gap:9px;font-weight:400;font-size:13.5px;color:#4A5B70}',
    '.emigeo-consent input{flex:none;margin-top:2px}',
    '.emigeo-note{margin:0;font-size:14px;color:#0E7C86;min-height:1.5em}',
    '.emigeo-trap{position:absolute;left:-9999px;width:1px;height:1px;overflow:hidden}',
  ].join('');
  mount.appendChild(style);

  var form = mount.querySelector('form');
  var note = mount.querySelector('.emigeo-note');
  var button = mount.querySelector('button');

  function param(name) {
    try { return new URLSearchParams(location.search).get(name) || undefined; } catch (e) { return undefined; }
  }

  form.addEventListener('submit', function (event) {
    event.preventDefault();
    var data = Object.fromEntries(new FormData(form).entries());
    if (!data.full_name || !data.phone) {
      note.textContent = 'Please leave your name and mobile number.';
      return;
    }

    data.consent = form.querySelector('[name=consent]').checked;
    data.page_url = location.href;
    data.referrer = document.referrer || undefined;
    // Carried through so the CRM can tell which ad or post sent them.
    data.utm_source = param('utm_source');
    data.utm_medium = param('utm_medium');
    data.utm_campaign = param('utm_campaign');
    data.utm_content = param('utm_content');
    data.gclid = param('gclid');

    button.disabled = true;
    note.textContent = 'Sending…';

    fetch('${base}/api/public/leads', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Site-Key': '${key}' },
      body: JSON.stringify(data),
    })
      .then(function (response) {
        if (!response.ok) throw new Error(String(response.status));
        form.reset();
        note.textContent = 'Thank you! An Emigeo Homes advisor will call you within minutes.';
      })
      .catch(function () {
        // Never show a status code to a buyer; give them another way through.
        note.textContent = 'Sorry — that did not send. Please WhatsApp us instead.';
      })
      .finally(function () { button.disabled = false; });
  });
})();
`;
}
