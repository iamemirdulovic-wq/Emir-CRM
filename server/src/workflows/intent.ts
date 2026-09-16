/**
 * Intent resolution for Workflow C.
 *
 * Order matters: a button payload is unambiguous, so it always wins. Keywords
 * come next, in English and Arabic. Only when both fail does the caller pay for
 * an AI classification.
 */

export const INTENTS = [
  'PRICING',
  'LOCATION',
  'BROCHURE',
  'PAYMENT',
  'CALL_ME',
  'STOP',
  'STILL_INTERESTED',
  'NOT_NOW',
  'APPT_CONFIRM',
  'APPT_RESCHEDULE',
  'UNKNOWN',
] as const;
export type Intent = (typeof INTENTS)[number];

export type IntentResult = {
  intent: Intent;
  source: 'button' | 'keyword' | 'ai' | 'none';
  confidence: number;
  /** The keyword or payload that decided it, for the activity trail. */
  matched?: string;
};

/**
 * Keyword patterns per intent, English and Arabic.
 *
 * STOP is checked first and deliberately narrow: an opt-out must be honoured,
 * but wrongly reading one loses a live lead.
 */
const PATTERNS: Array<{ intent: Intent; pattern: RegExp }> = [
  {
    intent: 'STOP',
    /*
     * Deliberately narrow. A missed opt-out is a compliance problem, but a
     * false one silently kills a live lead — "I'll stop by the sales centre"
     * and "non-stop flights to Dubai" both contain the word.
     *
     * So: the whole message is an opt-out word, or the message uses an
     * unambiguous opt-out phrase, or "stop" is followed by a messaging verb.
     */
    pattern: new RegExp(
      [
        // The entire message is a bare opt-out command.
        '^\\s*(stop|unsubscribe|توقف|إلغاء الاشتراك|الغاء الاشتراك)\\s*[.!\u061F?]*\\s*$',
        // Unambiguous phrases, anywhere in the message.
        "\\b(unsubscribe|opt ?out|remove me|do ?not (contact|message|call|text) me|don'?t (contact|message|call|text) me|leave me alone|no more messages)\\b",
        // "stop" plus what to stop doing.
        '\\bstop (sending|messaging|texting|contacting|calling|these|the messages|all messages)\\b',
        // Arabic opt-out phrases.
        '(لا ترسل|لا تتصل|أوقف الرسائل|اوقف الرسائل|توقف عن الرسائل|إلغاء الاشتراك|الغاء الاشتراك)',
      ].join('|'),
      'i',
    ),
  },
  {
    intent: 'CALL_ME',
    pattern:
      /\b(call me|ring me|phone me|give me a call|can you call|please call|speak (to|with) (you|someone)|talk to (you|someone|an agent))\b|(اتصل بي|كلمني|أريد مكالمة|اريد مكالمة|تواصل معي هاتفيا)/i,
  },
  {
    intent: 'BROCHURE',
    pattern:
      /\b(brochure|catalogue|catalog|pdf|floor ?plans?|layouts?|fact ?sheet|send (me )?(the )?(details|documents))\b|(كتيب|بروشور|المخططات|مخطط|كتالوج|الملف)/i,
  },
  {
    intent: 'PAYMENT',
    pattern:
      /\b(payment plan|installment|instalment|down ?payment|mortgage|finance|financing|post ?handover|emi)\b|(خطة السداد|خطة الدفع|تقسيط|الدفعة الأولى|الدفعة الاولى|تمويل|رهن)/i,
  },
  {
    intent: 'PRICING',
    pattern:
      /\b(price|pricing|prices|cost|how much|rate|budget|starting from|price ?list|quotation|quote)\b|(السعر|الأسعار|الاسعار|كم السعر|بكم|التكلفة|قائمة الأسعار)/i,
  },
  {
    intent: 'LOCATION',
    pattern:
      /\b(location|where is|address|map|directions|which area|nearby|situated)\b|(الموقع|أين يقع|اين يقع|العنوان|الخريطة|المنطقة)/i,
  },
  {
    intent: 'APPT_RESCHEDULE',
    pattern: /\b(reschedule|change (the )?(time|appointment|meeting)|another (time|day)|postpone)\b|(إعادة جدولة|اعادة جدولة|تغيير الموعد|تأجيل)/i,
  },
  {
    intent: 'APPT_CONFIRM',
    pattern: /\b(confirm(ed)?|see you there|i will be there|i'?ll be there|works for me)\b|(تأكيد|أؤكد|اؤكد|سأكون هناك|ساكون هناك)/i,
  },
  {
    intent: 'NOT_NOW',
    pattern:
      /\b(not now|later|maybe later|not interested right now|busy|next (month|year)|another time)\b|(ليس الآن|ليس الان|لاحقا|لاحقاً|مشغول|في وقت آخر)/i,
  },
  {
    intent: 'STILL_INTERESTED',
    pattern:
      /\b(still interested|yes,? interested|i(?:'?m| am) interested|keep me|of course|definitely|sure)\b|(ما زلت مهتما|مازلت مهتم|نعم مهتم|بالتأكيد|أكيد|اكيد)/i,
  },
];

/** Template quick replies and interactive buttons carry an explicit payload. */
export function intentFromButton(payload: string | null | undefined): IntentResult | null {
  if (!payload) return null;
  const normalized = payload.trim().toUpperCase().replace(/[\s-]+/g, '_');
  if ((INTENTS as readonly string[]).includes(normalized)) {
    return { intent: normalized as Intent, source: 'button', confidence: 1, matched: payload };
  }
  return null;
}

export function intentFromKeywords(text: string | null | undefined): IntentResult | null {
  if (!text || !text.trim()) return null;
  for (const { intent, pattern } of PATTERNS) {
    const match = pattern.exec(text);
    if (match) {
      return { intent, source: 'keyword', confidence: 0.8, matched: match[0] };
    }
  }
  return null;
}

/**
 * Resolve an intent without calling the AI. Returns UNKNOWN when the caller
 * should ask the classifier.
 */
export function resolveIntent(input: { buttonPayload?: string | null; text?: string | null }): IntentResult {
  return (
    intentFromButton(input.buttonPayload) ??
    intentFromKeywords(input.text) ?? { intent: 'UNKNOWN', source: 'none', confidence: 0 }
  );
}

export function isKnownIntent(value: string): value is Intent {
  return (INTENTS as readonly string[]).includes(value) && value !== 'UNKNOWN';
}
