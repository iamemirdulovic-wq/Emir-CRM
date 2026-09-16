import { describe, expect, it } from 'vitest';
import { intentFromButton, intentFromKeywords, resolveIntent } from './intent.js';

describe('intentFromButton', () => {
  it('takes the payload verbatim', () => {
    expect(intentFromButton('PRICING')).toMatchObject({ intent: 'PRICING', source: 'button', confidence: 1 });
    expect(intentFromButton('CALL_ME')?.intent).toBe('CALL_ME');
    expect(intentFromButton('STILL_INTERESTED')?.intent).toBe('STILL_INTERESTED');
  });

  it('normalizes case and separators', () => {
    expect(intentFromButton('call me')?.intent).toBe('CALL_ME');
    expect(intentFromButton('still-interested')?.intent).toBe('STILL_INTERESTED');
  });

  it('ignores a payload it does not recognise', () => {
    expect(intentFromButton('SOMETHING_ELSE')).toBeNull();
    expect(intentFromButton(null)).toBeNull();
    expect(intentFromButton('')).toBeNull();
  });
});

describe('intentFromKeywords: English', () => {
  const cases: Array<[string, string]> = [
    ['What is the price for a 2 bedroom?', 'PRICING'],
    ['How much is the 1BR?', 'PRICING'],
    ['can you send the price list', 'PRICING'],
    ['Where is the location?', 'LOCATION'],
    ['whats the address', 'LOCATION'],
    ['Please send the brochure', 'BROCHURE'],
    ['do you have floor plans', 'BROCHURE'],
    ['What is the payment plan?', 'PAYMENT'],
    ['is there post handover payment', 'PAYMENT'],
    ['Call me please', 'CALL_ME'],
    ['can you call tomorrow', 'CALL_ME'],
    ['STOP', 'STOP'],
    ['please unsubscribe me', 'STOP'],
    ['do not contact me again', 'STOP'],
    ['Not now, maybe later', 'NOT_NOW'],
    ['yes I am interested', 'STILL_INTERESTED'],
    ['Confirmed, see you there', 'APPT_CONFIRM'],
    ['can we reschedule', 'APPT_RESCHEDULE'],
  ];

  for (const [text, expected] of cases) {
    it(`reads "${text}" as ${expected}`, () => {
      expect(intentFromKeywords(text)?.intent).toBe(expected);
    });
  }
});

describe('intentFromKeywords: Arabic', () => {
  const cases: Array<[string, string]> = [
    ['كم السعر؟', 'PRICING'],
    ['ما هي الأسعار', 'PRICING'],
    ['أين يقع المشروع', 'LOCATION'],
    ['أرسل لي الكتيب', 'BROCHURE'],
    ['ما هي خطة السداد', 'PAYMENT'],
    ['اتصل بي من فضلك', 'CALL_ME'],
    ['توقف عن الرسائل', 'STOP'],
    ['ليس الآن', 'NOT_NOW'],
    ['نعم مهتم', 'STILL_INTERESTED'],
  ];

  for (const [text, expected] of cases) {
    it(`reads "${text}" as ${expected}`, () => {
      expect(intentFromKeywords(text)?.intent).toBe(expected);
    });
  }
});

describe('intent precedence', () => {
  it('honours an opt-out even when the message also asks about price', () => {
    expect(intentFromKeywords('stop sending me prices')?.intent).toBe('STOP');
  });

  it('prefers CALL_ME over PRICING when the lead asks to talk', () => {
    expect(intentFromKeywords('call me about the price')?.intent).toBe('CALL_ME');
  });

  it('prefers the brochure over the price when both are named', () => {
    expect(intentFromKeywords('send me the brochure and the price')?.intent).toBe('BROCHURE');
  });

  it('reads a payment question as PAYMENT, not PRICING', () => {
    expect(intentFromKeywords('what is the payment plan and price')?.intent).toBe('PAYMENT');
  });
});

describe('resolveIntent', () => {
  it('lets the button win over the text', () => {
    const result = resolveIntent({ buttonPayload: 'LOCATION', text: 'what is the price' });
    expect(result.intent).toBe('LOCATION');
    expect(result.source).toBe('button');
  });

  it('falls back to keywords when there is no button', () => {
    expect(resolveIntent({ text: 'how much is it' })).toMatchObject({ intent: 'PRICING', source: 'keyword' });
  });

  it('returns UNKNOWN so the caller can ask the AI', () => {
    const result = resolveIntent({ text: 'my cousin visited Dubai last summer' });
    expect(result.intent).toBe('UNKNOWN');
    expect(result.source).toBe('none');
  });

  it('returns UNKNOWN for an empty message', () => {
    expect(resolveIntent({}).intent).toBe('UNKNOWN');
    expect(resolveIntent({ text: '   ' }).intent).toBe('UNKNOWN');
  });

  it('does not mistake ordinary words for an opt-out', () => {
    for (const text of ['I will stop by the sales centre', 'non-stop flights to Dubai']) {
      expect(resolveIntent({ text }).intent, text).not.toBe('STOP');
    }
  });
});
