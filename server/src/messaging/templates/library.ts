import type { TemplateDefinition } from './types.js';

/**
 * The day-one template library. Every template exists in English and Arabic.
 * These are the local definitions we submit to Meta; `status` is whatever Meta
 * reports back after review (see templates/sync.ts).
 *
 * Bodies obey Meta's rules: never start or end with a variable, never place two
 * variables next to each other, and always ship examples.
 */

const FOOTER_EN = 'Emir Real Estate — Dubai & Abu Dhabi';
const FOOTER_AR = 'إمير العقارية — دبي وأبوظبي';

export const TEMPLATE_LIBRARY: TemplateDefinition[] = [
  // --- lead_welcome --------------------------------------------------------
  {
    name: 'lead_welcome_en',
    language: 'en',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['4::REPLACE_WITH_UPLOADED_BROCHURE_HANDLE'] } },
      {
        type: 'BODY',
        text:
          'Hello {{1}}, thank you for your interest in {{2}}. My name is {{3}} from {{4}} and I will be looking after your enquiry personally. ' +
          'I have attached the project brochure above. How would you like to continue?',
        example: { body_text: [['Sara', 'Emaar Beachfront', 'Layla Hassan', 'Emir Real Estate']] },
      },
      { type: 'FOOTER', text: FOOTER_EN },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Pricing', payload: 'PRICING' },
          { type: 'QUICK_REPLY', text: 'Location', payload: 'LOCATION' },
          { type: 'QUICK_REPLY', text: 'Call me', payload: 'CALL_ME' },
        ],
      },
    ],
  },
  {
    name: 'lead_welcome_ar',
    language: 'ar',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'DOCUMENT', example: { header_handle: ['4::REPLACE_WITH_UPLOADED_BROCHURE_HANDLE'] } },
      {
        type: 'BODY',
        text:
          'مرحباً {{1}}، شكراً لاهتمامك بمشروع {{2}}. اسمي {{3}} من {{4}} وسأتابع طلبك شخصياً. ' +
          'لقد أرفقت كتيب المشروع أعلاه. كيف تحب أن نكمل؟',
        example: { body_text: [['سارة', 'إعمار بيتشفرونت', 'ليلى حسن', 'إمير العقارية']] },
      },
      { type: 'FOOTER', text: FOOTER_AR },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'الأسعار', payload: 'PRICING' },
          { type: 'QUICK_REPLY', text: 'الموقع', payload: 'LOCATION' },
          { type: 'QUICK_REPLY', text: 'اتصل بي', payload: 'CALL_ME' },
        ],
      },
    ],
  },

  // --- followup_2h ---------------------------------------------------------
  {
    name: 'followup_2h_en',
    language: 'en',
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text:
          'Hi {{1}}, this is {{2}} following up on your enquiry about {{3}}. ' +
          'I have availability today to walk you through the floor plans and payment options. Shall I call you?',
        example: { body_text: [['Sara', 'Layla Hassan', 'Emaar Beachfront']] },
      },
      { type: 'FOOTER', text: FOOTER_EN },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Call me', payload: 'CALL_ME' },
          { type: 'QUICK_REPLY', text: 'Send pricing', payload: 'PRICING' },
        ],
      },
    ],
  },
  {
    name: 'followup_2h_ar',
    language: 'ar',
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text:
          'مرحباً {{1}}، معك {{2}} للمتابعة بخصوص استفسارك عن {{3}}. ' +
          'لدي وقت متاح اليوم لأشرح لك المخططات وخطط السداد. هل أتصل بك؟',
        example: { body_text: [['سارة', 'ليلى حسن', 'إعمار بيتشفرونت']] },
      },
      { type: 'FOOTER', text: FOOTER_AR },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'اتصل بي', payload: 'CALL_ME' },
          { type: 'QUICK_REPLY', text: 'أرسل الأسعار', payload: 'PRICING' },
        ],
      },
    ],
  },

  // --- followup_24h (image header, starting price) -------------------------
  {
    name: 'followup_24h_en',
    language: 'en',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::REPLACE_WITH_UPLOADED_IMAGE_HANDLE'] } },
      {
        type: 'BODY',
        text:
          'Hi {{1}}, units at {{2}} start from AED {{3}} with a developer payment plan. ' +
          'I can hold a unit for you while you review the details. Would you like the full price list?',
        example: { body_text: [['Sara', 'Emaar Beachfront', '1,850,000']] },
      },
      { type: 'FOOTER', text: FOOTER_EN },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Send price list', payload: 'PRICING' },
          { type: 'QUICK_REPLY', text: 'Book a viewing', payload: 'CALL_ME' },
        ],
      },
    ],
  },
  {
    name: 'followup_24h_ar',
    language: 'ar',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::REPLACE_WITH_UPLOADED_IMAGE_HANDLE'] } },
      {
        type: 'BODY',
        text:
          'مرحباً {{1}}، تبدأ أسعار الوحدات في {{2}} من {{3}} درهم مع خطة سداد من المطور. ' +
          'يمكنني حجز وحدة لك ريثما تطّلع على التفاصيل. هل ترغب بقائمة الأسعار الكاملة؟',
        example: { body_text: [['سارة', 'إعمار بيتشفرونت', '1,850,000']] },
      },
      { type: 'FOOTER', text: FOOTER_AR },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'أرسل قائمة الأسعار', payload: 'PRICING' },
          { type: 'QUICK_REPLY', text: 'حجز معاينة', payload: 'CALL_ME' },
        ],
      },
    ],
  },

  // --- followup_3d ---------------------------------------------------------
  {
    name: 'followup_3d_en',
    language: 'en',
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text:
          'Hi {{1}}, I do not want to keep messaging if the timing is not right. ' +
          'Are you still considering {{2}}, or should I close your file for now?',
        example: { body_text: [['Sara', 'Emaar Beachfront']] },
      },
      { type: 'FOOTER', text: FOOTER_EN },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Still interested', payload: 'STILL_INTERESTED' },
          { type: 'QUICK_REPLY', text: 'Not now', payload: 'NOT_NOW' },
          { type: 'QUICK_REPLY', text: 'Stop messages', payload: 'STOP' },
        ],
      },
    ],
  },
  {
    name: 'followup_3d_ar',
    language: 'ar',
    category: 'MARKETING',
    components: [
      {
        type: 'BODY',
        text:
          'مرحباً {{1}}، لا أرغب بإزعاجك إذا لم يكن الوقت مناسباً. ' +
          'هل ما زلت مهتماً بمشروع {{2}}، أم أغلق ملفك حالياً؟',
        example: { body_text: [['سارة', 'إعمار بيتشفرونت']] },
      },
      { type: 'FOOTER', text: FOOTER_AR },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'ما زلت مهتماً', payload: 'STILL_INTERESTED' },
          { type: 'QUICK_REPLY', text: 'ليس الآن', payload: 'NOT_NOW' },
          { type: 'QUICK_REPLY', text: 'إيقاف الرسائل', payload: 'STOP' },
        ],
      },
    ],
  },

  // --- appointment_confirm (UTILITY) ---------------------------------------
  {
    name: 'appointment_confirm_en',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text:
          'Hi {{1}}, your viewing for {{2}} is confirmed on {{3}} at {{4}}. ' +
          'Your agent {{5}} will meet you there. Reply here if anything changes.',
        example: { body_text: [['Sara', 'Emaar Beachfront', 'Tuesday 14 April', '4:00 PM', 'Layla Hassan']] },
      },
      { type: 'FOOTER', text: FOOTER_EN },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Confirm', payload: 'APPT_CONFIRM' },
          { type: 'QUICK_REPLY', text: 'Reschedule', payload: 'APPT_RESCHEDULE' },
        ],
      },
    ],
  },
  {
    name: 'appointment_confirm_ar',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text:
          'مرحباً {{1}}، تم تأكيد موعد معاينة {{2}} يوم {{3}} الساعة {{4}}. ' +
          'سيقابلك المستشار {{5}} في الموقع. يرجى الرد هنا في حال تغيّر أي شيء.',
        example: { body_text: [['سارة', 'إعمار بيتشفرونت', 'الثلاثاء 14 أبريل', '4:00 مساءً', 'ليلى حسن']] },
      },
      { type: 'FOOTER', text: FOOTER_AR },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'تأكيد', payload: 'APPT_CONFIRM' },
          { type: 'QUICK_REPLY', text: 'إعادة جدولة', payload: 'APPT_RESCHEDULE' },
        ],
      },
    ],
  },

  // --- appointment_reminder (UTILITY) --------------------------------------
  {
    name: 'appointment_reminder_en',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'Reminder for {{1}}: your {{2}} viewing is tomorrow at {{3}}. Your agent {{4}} is expecting you.',
        example: { body_text: [['Sara', 'Emaar Beachfront', '4:00 PM', 'Layla Hassan']] },
      },
      { type: 'FOOTER', text: FOOTER_EN },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'See you there', payload: 'APPT_CONFIRM' },
          { type: 'QUICK_REPLY', text: 'Reschedule', payload: 'APPT_RESCHEDULE' },
        ],
      },
    ],
  },
  {
    name: 'appointment_reminder_ar',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'تذكير لـ {{1}}: موعد معاينة {{2}} غداً الساعة {{3}}. المستشار {{4}} بانتظارك.',
        example: { body_text: [['سارة', 'إعمار بيتشفرونت', '4:00 مساءً', 'ليلى حسن']] },
      },
      { type: 'FOOTER', text: FOOTER_AR },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'سأكون هناك', payload: 'APPT_CONFIRM' },
          { type: 'QUICK_REPLY', text: 'إعادة جدولة', payload: 'APPT_RESCHEDULE' },
        ],
      },
    ],
  },

  // --- agent_new_lead_alert (UTILITY, sent to the agent) -------------------
  {
    name: 'agent_new_lead_alert_en',
    language: 'en',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'New lead for {{1}}: {{2}} asking about {{3}} from {{4}}. Open the CRM and respond within 5 minutes.',
        example: { body_text: [['Layla Hassan', 'Sara A.', 'Emaar Beachfront', 'Meta Lead Ads']] },
      },
      { type: 'FOOTER', text: FOOTER_EN },
    ],
  },
  {
    name: 'agent_new_lead_alert_ar',
    language: 'ar',
    category: 'UTILITY',
    components: [
      {
        type: 'BODY',
        text: 'عميل جديد لـ {{1}}: {{2}} يسأل عن {{3}} عبر {{4}}. افتح النظام وتواصل خلال 5 دقائق.',
        example: { body_text: [['ليلى حسن', 'سارة أ.', 'إعمار بيتشفرونت', 'إعلانات ميتا']] },
      },
      { type: 'FOOTER', text: FOOTER_AR },
    ],
  },

  // --- new_launch_alert ----------------------------------------------------
  {
    name: 'new_launch_alert_en',
    language: 'en',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::REPLACE_WITH_UPLOADED_IMAGE_HANDLE'] } },
      {
        type: 'BODY',
        text:
          'Hi {{1}}, a new launch by {{2}} in {{3}} opens for registration this week, starting from AED {{4}}. ' +
          'Early registrations get first pick of units. Would you like the details?',
        example: { body_text: [['Sara', 'Emaar', 'Dubai Creek Harbour', '1,600,000']] },
      },
      { type: 'FOOTER', text: FOOTER_EN },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'Send details', payload: 'PRICING' },
          { type: 'QUICK_REPLY', text: 'Not interested', payload: 'NOT_NOW' },
          { type: 'QUICK_REPLY', text: 'Stop messages', payload: 'STOP' },
        ],
      },
    ],
  },
  {
    name: 'new_launch_alert_ar',
    language: 'ar',
    category: 'MARKETING',
    components: [
      { type: 'HEADER', format: 'IMAGE', example: { header_handle: ['4::REPLACE_WITH_UPLOADED_IMAGE_HANDLE'] } },
      {
        type: 'BODY',
        text:
          'مرحباً {{1}}، يفتح مشروع جديد من {{2}} في {{3}} باب التسجيل هذا الأسبوع بأسعار تبدأ من {{4}} درهم. ' +
          'التسجيل المبكر يمنحك أولوية اختيار الوحدات. هل ترغب بالتفاصيل؟',
        example: { body_text: [['سارة', 'إعمار', 'خور دبي', '1,600,000']] },
      },
      { type: 'FOOTER', text: FOOTER_AR },
      {
        type: 'BUTTONS',
        buttons: [
          { type: 'QUICK_REPLY', text: 'أرسل التفاصيل', payload: 'PRICING' },
          { type: 'QUICK_REPLY', text: 'غير مهتم', payload: 'NOT_NOW' },
          { type: 'QUICK_REPLY', text: 'إيقاف الرسائل', payload: 'STOP' },
        ],
      },
    ],
  },
];

/** `lead_welcome_{lang}` with a safe fallback to English. */
export function templateNameFor(base: string, language: string): string {
  const lang = language === 'ar' ? 'ar' : 'en';
  return `${base}_${lang}`;
}

export function findTemplate(name: string): TemplateDefinition | undefined {
  return TEMPLATE_LIBRARY.find((t) => t.name === name);
}
