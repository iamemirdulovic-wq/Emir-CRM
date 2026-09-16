/**
 * The bulk WhatsApp guard.
 *
 * This is the rule the owner signed off on, and it lives on the server so no
 * UI change, no API client and no future screen can get around it:
 *
 *   1. Only contacts with recorded WhatsApp consent, and never one on the DNC
 *      list. A cold bulk send to people who never opted in is the single most
 *      reliable way to get a WhatsApp business number permanently banned.
 *   2. Only templates Meta has approved, because a bulk send is by definition
 *      outside the 24-hour window.
 *   3. Throttled, so the send rate stays inside Meta's messaging limits.
 *   4. The number of contacts that will be skipped for missing consent is
 *      counted and shown before anything is sent.
 *   5. Automatic pause if the quality rating drops or the block rate rises.
 *
 * The per-contact guards (quiet hours, the 3-a-day cap, the bot pause after a
 * human reply) still apply on top of this, because every message still goes
 * through `sendWhatsApp`. This is an additional gate, not a replacement.
 */

/** Meta's quality ratings, as the Cloud API reports them. */
export type QualityRating = 'GREEN' | 'YELLOW' | 'RED' | 'UNKNOWN';

export interface BulkSendPolicy {
  /** Messages per minute. Conservative by default. */
  throttlePerMinute: number;
  /** Pause the campaign at or below this rating. */
  pauseAtQuality: QualityRating;
  /** Pause if this share of sends fails, once enough have been attempted. */
  maxFailureRate: number;
  /** Below this many attempts the failure rate is noise, not a signal. */
  minAttemptsBeforeFailureCheck: number;
}

export const DEFAULT_BULK_POLICY: BulkSendPolicy = {
  throttlePerMinute: 20,
  pauseAtQuality: 'RED',
  maxFailureRate: 0.2,
  minAttemptsBeforeFailureCheck: 25,
};

const QUALITY_ORDER: Record<QualityRating, number> = { RED: 0, YELLOW: 1, GREEN: 2, UNKNOWN: 2 };

export interface CampaignHealth {
  quality: QualityRating;
  attempted: number;
  failed: number;
}

export type PauseDecision = { pause: false } | { pause: true; reason: string };

/**
 * Whether a running campaign should stop.
 *
 * Deliberately blunt: a campaign paused for nothing costs a few minutes of an
 * accountant's time, and one that keeps sending into a falling quality rating
 * costs the company its WhatsApp number.
 */
export function shouldPause(health: CampaignHealth, policy: BulkSendPolicy = DEFAULT_BULK_POLICY): PauseDecision {
  if (QUALITY_ORDER[health.quality] <= QUALITY_ORDER[policy.pauseAtQuality]) {
    return {
      pause: true,
      reason: `WhatsApp quality rating is ${health.quality}. Sending stopped to protect the number.`,
    };
  }

  if (health.attempted >= policy.minAttemptsBeforeFailureCheck) {
    const rate = health.failed / health.attempted;
    if (rate >= policy.maxFailureRate) {
      return {
        pause: true,
        reason:
          `${Math.round(rate * 100)}% of the first ${health.attempted} messages failed. ` +
          'Sending stopped so the cause can be checked.',
      };
    }
  }

  return { pause: false };
}

/** How many to send in this minute's batch. */
export function batchSize(policy: BulkSendPolicy = DEFAULT_BULK_POLICY): number {
  return Math.max(1, Math.min(policy.throttlePerMinute, 200));
}

export interface ConsentCheck {
  contactId: string;
  dnc: boolean;
  whatsappConsent: boolean;
  hasWaId: boolean;
}

export interface EligibilitySplit {
  eligible: string[];
  skipped: { contactId: string; reason: string }[];
}

/**
 * Splits a list into who may be messaged and who may not, with the reason.
 *
 * The reason matters: "412 contacts will be skipped" is a warning, but
 * "412 have no recorded consent, 8 are on the do-not-contact list" is
 * something the owner can act on.
 */
export function splitByEligibility(contacts: ConsentCheck[]): EligibilitySplit {
  const eligible: string[] = [];
  const skipped: { contactId: string; reason: string }[] = [];

  for (const contact of contacts) {
    if (contact.dnc) {
      skipped.push({ contactId: contact.contactId, reason: 'On the do-not-contact list' });
    } else if (!contact.whatsappConsent) {
      skipped.push({ contactId: contact.contactId, reason: 'No recorded WhatsApp consent' });
    } else if (!contact.hasWaId) {
      skipped.push({ contactId: contact.contactId, reason: 'No WhatsApp number' });
    } else {
      eligible.push(contact.contactId);
    }
  }

  return { eligible, skipped };
}

/** The sentence shown before a bulk send is confirmed. */
export function describeSkipped(split: EligibilitySplit): string {
  if (split.skipped.length === 0) return `All ${split.eligible.length} contacts will be messaged.`;

  const byReason = new Map<string, number>();
  for (const entry of split.skipped) byReason.set(entry.reason, (byReason.get(entry.reason) ?? 0) + 1);

  const parts = [...byReason.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([reason, count]) => `${count} ${reason.toLowerCase()}`);

  return `${split.eligible.length} will be messaged. ${split.skipped.length} will be skipped: ${parts.join(', ')}.`;
}
