/**
 * The test copy refuses to talk to real people.
 *
 * `newcrm.emirdulovic.com` runs the same code as the real CRM against a copy
 * of the real data — which means a copy of every client's real phone number
 * and real email address. The master prompt (§0.1.4) asks for every outgoing
 * channel to be off there, and this is that, enforced rather than promised.
 *
 * Why it is a hard refusal and not "just don't set the keys": the keys are
 * copied between the two sites by a person, at night, in a hosting panel with
 * two tabs open. The failure that sends a test message to a real client is not
 * a missing credential — it is a credential pasted into the wrong site. So the
 * test copy declines even when it is perfectly able to send.
 *
 * It is deliberately noisy in the log and silent to the caller: the code that
 * wanted to send carries on as though the message went nowhere, because it
 * did, and a test site that crashes on every send teaches nothing either.
 */
import { env } from './env.js';
import { logger } from '../lib/logger.js';

export function isTestCopy(): boolean {
  return env().IS_TEST_COPY === true;
}

/**
 * True when the caller must not send. Logs what it stopped, so a developer
 * wondering why nothing arrived finds the answer in the log rather than in
 * the code.
 */
export function refuseOutbound(channel: 'whatsapp' | 'email' | 'push' | 'sms', to: string): boolean {
  if (!isTestCopy()) return false;
  logger.warn('test copy: refused to send to a real person', {
    channel,
    /* Never the whole number or address, in a log that is read over a
       shoulder: enough to recognise the send, not enough to reach anybody. */
    to: to.length > 4 ? `…${to.slice(-4)}` : '…',
  });
  return true;
}
