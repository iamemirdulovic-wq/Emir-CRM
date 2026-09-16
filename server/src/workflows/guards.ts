import {
  BOT_PAUSE_AFTER_HUMAN_MS,
  MAX_AUTOMATED_MESSAGES_PER_24H,
} from '../config/constants.js';
import { isQuietHours, nextAllowedSendTime } from '../lib/time.js';

/**
 * The global guards that run before any automated message:
 *  - the contact is not on the DNC list
 *  - the contact has opted in for that channel
 *  - quiet hours 22:00–08:00 Asia/Dubai (Workflow A's instant reply is exempt)
 *  - at most 3 automated messages per contact per 24 hours
 *  - the bot pauses for 24 hours after an agent sends a manual message
 *
 * Plus the WhatsApp-specific rule: outside the 24-hour customer service window,
 * only an approved template may be sent.
 *
 * Kept pure: the caller loads the context, these functions decide.
 */

export type Channel = 'whatsapp' | 'email' | 'sms';

export type GuardContext = {
  dnc: boolean;
  /** The identifier itself is suppressed, independently of the contact record. */
  suppressed: boolean;
  consent: Record<Channel, boolean>;
  automatedMessagesLast24h: number;
  botPausedUntil: Date | null;
  lastHumanOutboundAt: Date | null;
  /** When the WhatsApp free-form window closes. Null means it is closed. */
  waWindowExpiresAt: Date | null;
  now: Date;
};

export type SendIntent = {
  channel: Channel;
  /** Automated messages face every guard; a human's message faces almost none. */
  automated: boolean;
  /** Whether this send uses an approved WhatsApp template. */
  isTemplate: boolean;
  /**
   * Workflow A's instant reply is the one automated message allowed during
   * quiet hours — a lead who just submitted a form expects an answer.
   */
  bypassQuietHours?: boolean;
};

export type GuardDecision =
  | { allowed: true }
  | { allowed: false; reason: GuardReason; message: string; deferUntil?: Date };

export type GuardReason =
  | 'dnc'
  | 'suppressed'
  | 'no_consent'
  | 'quiet_hours'
  | 'rate_limited'
  | 'bot_paused'
  | 'window_closed_needs_template';

export function evaluateGuards(ctx: GuardContext, intent: SendIntent): GuardDecision {
  // Never send automated messages to DNC contacts. A human may still not
  // message someone who asked us to stop, so this applies to both.
  if (ctx.dnc) {
    return { allowed: false, reason: 'dnc', message: 'Contact is on the do-not-contact list' };
  }
  if (ctx.suppressed) {
    return { allowed: false, reason: 'suppressed', message: 'This number or address has opted out' };
  }

  // The WhatsApp window applies to humans too — it is Meta's rule, not ours.
  if (intent.channel === 'whatsapp' && !intent.isTemplate && !isWindowOpen(ctx)) {
    return {
      allowed: false,
      reason: 'window_closed_needs_template',
      message: 'The 24-hour WhatsApp window is closed; only an approved template can be sent',
    };
  }

  // Everything below is an automation-only restriction.
  if (!intent.automated) return { allowed: true };

  if (!ctx.consent[intent.channel]) {
    return {
      allowed: false,
      reason: 'no_consent',
      message: `Contact has not opted in to ${intent.channel}`,
    };
  }

  if (ctx.botPausedUntil && ctx.botPausedUntil.getTime() > ctx.now.getTime()) {
    return {
      allowed: false,
      reason: 'bot_paused',
      message: 'An agent has taken over this conversation',
      deferUntil: ctx.botPausedUntil,
    };
  }
  // Belt and braces: derive the pause from the last manual message too, in case
  // bot_paused_until was never written.
  if (ctx.lastHumanOutboundAt) {
    const pausedUntil = new Date(ctx.lastHumanOutboundAt.getTime() + BOT_PAUSE_AFTER_HUMAN_MS);
    if (pausedUntil.getTime() > ctx.now.getTime()) {
      return {
        allowed: false,
        reason: 'bot_paused',
        message: 'An agent messaged this contact within the last 24 hours',
        deferUntil: pausedUntil,
      };
    }
  }

  if (ctx.automatedMessagesLast24h >= MAX_AUTOMATED_MESSAGES_PER_24H) {
    return {
      allowed: false,
      reason: 'rate_limited',
      message: `Already sent ${ctx.automatedMessagesLast24h} automated messages in the last 24 hours`,
    };
  }

  if (!intent.bypassQuietHours && isQuietHours(ctx.now)) {
    return {
      allowed: false,
      reason: 'quiet_hours',
      message: 'Quiet hours: no automated messages between 22:00 and 08:00 Asia/Dubai',
      deferUntil: nextAllowedSendTime(ctx.now),
    };
  }

  return { allowed: true };
}

/** Is the WhatsApp free-form window currently open? */
export function isWindowOpen(ctx: Pick<GuardContext, 'waWindowExpiresAt' | 'now'>): boolean {
  return Boolean(ctx.waWindowExpiresAt && ctx.waWindowExpiresAt.getTime() > ctx.now.getTime());
}

/**
 * A blocked send is not always a dead end: quiet hours and an agent takeover
 * both say "later", while DNC and consent say "never".
 */
export function isRetryable(decision: GuardDecision): boolean {
  if (decision.allowed) return false;
  return decision.reason === 'quiet_hours' || decision.reason === 'bot_paused';
}
